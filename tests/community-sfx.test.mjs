import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateManifest } from "../packages/manifest/src/index.js";
import { COMMUNITY_PERSONALITIES, communityManifestUrl } from "../packages/community-sfx/index.js";

const packageRoot = path.resolve(import.meta.dirname, "..", "packages", "community-sfx");

test("the CC0 community catalog keeps its license and source provenance", async () => {
  const license = await readFile(path.join(packageRoot, "LICENSE-AUDIO"), "utf8");
  const notice = await readFile(path.join(packageRoot, "UPSTREAM-NOTICE.md"), "utf8");
  const catalogManifest = JSON.parse(await readFile(path.join(packageRoot, "catalog", "uisfx.manifest.json"), "utf8"));
  assert.match(license, /CC0 1\.0/i);
  assert.match(notice, /2001f3dac2d1cf86ad99cbad5cef222c3a8b9082/);
  assert.equal(catalogManifest.license.audio, "CC0-1.0");
  assert.equal(catalogManifest.summary.assets, 936);
});

test("every community personality is a valid 16-cue local Wubble pack", async () => {
  assert.equal(COMMUNITY_PERSONALITIES.length, 12);
  for (const personality of COMMUNITY_PERSONALITIES) {
    const manifestPath = communityManifestUrl(personality).pathname;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const result = validateManifest(manifest);
    assert.deepEqual(result.errors, [], `${personality}: ${result.errors.join("; ")}`);
    assert.equal(Object.keys(manifest.events).length, 16);
    assert.equal(manifest.pack.id, `wubble-community-${personality}`);
    for (const event of Object.values(manifest.events)) {
      await access(path.join(path.dirname(manifestPath), event.file));
      await access(path.join(path.dirname(manifestPath), event.sources[0].file));
    }
  }
});

test("the optional catalog includes every declared upstream audio file", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "catalog", "uisfx.manifest.json"), "utf8"));
  const files = manifest.assets.flatMap((asset) => [asset.files.mp3.path, asset.files.ogg.path]);
  assert.equal(files.length, 1872);
  for (const file of files) {
    const result = await stat(path.join(packageRoot, "catalog", file));
    assert.ok(result.size > 0, file);
  }
});
