import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { ManifestCompatibilityError, migrateManifest, validateManifest } from "../packages/manifest/src/index.js";

const manifestPath = new URL("../examples/vanilla/public/wubble/signal/manifest.json", import.meta.url);

test("the sample manifest validates", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(validateManifest(manifest), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(manifest.events), [
    "tap",
    "toggleOn",
    "toggleOff",
    "select",
    "open",
    "close",
    "navigate",
    "success",
    "error",
    "warning",
    "notify",
    "send",
    "receive",
    "processing",
    "complete",
    "deleteConfirm"
  ]);
});

test("manifest compatibility accepts the current contract and rejects unregistered versions", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(migrateManifest(manifest), {
    manifest,
    fromSchemaVersion: 1,
    toSchemaVersion: 1,
    migrated: false
  });

  assert.throws(
    () => migrateManifest({ ...manifest, schemaVersion: 2 }),
    (error) => error instanceof ManifestCompatibilityError && /newer than this SDK supports/.test(error.message)
  );
  assert.throws(
    () => migrateManifest({ ...manifest, schemaVersion: 0 }),
    (error) => error instanceof ManifestCompatibilityError && /requires a migration/.test(error.message)
  );
});

test("the sample pack stays within its declared budget", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const assetDirectory = new URL("../examples/vanilla/public/wubble/signal/", import.meta.url);
  const sizes = await Promise.all(
    Object.values(manifest.events).map(async (asset) => (await stat(new URL(asset.file, assetDirectory))).size)
  );
  const totalBytes = sizes.reduce((total, size) => total + size, 0);
  assert.ok(totalBytes < 120 * 1024, `Expected < 120 KB, received ${totalBytes} bytes.`);
});

test("unsafe asset paths are rejected", () => {
  const manifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    events: {
      tap: { file: "../tap.wav", durationMs: 120, sha256: "hash" }
    }
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /safe relative asset path/);
});

test("remote-looking asset paths are rejected", () => {
  const manifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    events: {
      tap: { file: "https://example.test/tap.wav", durationMs: 120, sha256: "hash" }
    }
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /safe relative asset path/);
});

test("event policies and variants must use supported values and unique local files", () => {
  const manifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    events: {
      tap: {
        file: "tap.wav",
        durationMs: 120,
        sha256: "hash",
        policy: { priority: "urgent", cooldownMs: -1 },
        variants: [{ file: "tap.wav", durationMs: 120, sha256: "duplicate" }]
      }
    }
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /priority must be low, normal, or high/);
  assert.match(result.errors.join(" "), /cooldownMs must be an integer/);
  assert.match(result.errors.join(" "), /must differ from the primary asset/);
});

test("codec sources require local files, supported MIME types, and distinct filenames", () => {
  const manifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    events: {
      tap: {
        file: "tap.mp3",
        durationMs: 120,
        sha256: "primary",
        sources: [{ file: "tap.webm", mimeType: "audio/webm; codecs=opus", durationMs: 120, sha256: "opus" }]
      }
    }
  };
  assert.deepEqual(validateManifest(manifest), { valid: true, errors: [] });

  manifest.events.tap.sources[0].mimeType = "audio/flac";
  manifest.events.tap.sources.push({ file: "tap.mp3", mimeType: "audio/mpeg", durationMs: 120, sha256: "duplicate" });
  const result = validateManifest(manifest);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /supported local audio MIME type/);
  assert.match(result.errors.join(" "), /must differ from the primary asset/);
});
