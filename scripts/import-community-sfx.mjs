import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const personalityNames = [
  "minimal", "soft", "glass", "arcade", "mechanical", "organic",
  "dreamy", "scifi", "rubber", "cinematic", "studio", "zen"
];

const semanticCueMap = Object.freeze({
  tap: "press", toggleOn: "toggle-on", toggleOff: "toggle-off", select: "select",
  open: "open", close: "close", navigate: "forward", success: "success",
  error: "error", warning: "warning", notify: "notification", send: "send",
  receive: "receive", processing: "processing", complete: "complete", deleteConfirm: "delete"
});

const sourceRoot = argumentValue("--source");
if (!sourceRoot) {
  console.error("Usage: node scripts/import-community-sfx.mjs --source <uisfx-repository-root>");
  process.exitCode = 1;
} else {
  await importCatalog(path.resolve(sourceRoot));
}

async function importCatalog(root) {
  const upstreamPackage = path.join(root, "packages", "uisfx");
  const upstreamManifest = JSON.parse(await readFile(path.join(upstreamPackage, "manifest.json"), "utf8"));
  const target = path.join(process.cwd(), "packages", "community-sfx");

  await mkdir(path.join(target, "catalog"), { recursive: true });
  await cp(path.join(upstreamPackage, "sounds"), path.join(target, "catalog", "sounds"), { recursive: true, force: true });
  await copyFile(path.join(upstreamPackage, "manifest.json"), path.join(target, "catalog", "uisfx.manifest.json"));
  await copyFile(path.join(upstreamPackage, "LICENSE-AUDIO"), path.join(target, "LICENSE-AUDIO"));

  const assets = new Map(upstreamManifest.assets.map((asset) => [`${asset.pack}/${asset.cue}`, asset]));
  for (const personality of personalityNames) {
    const events = {};

    for (const [event, cue] of Object.entries(semanticCueMap)) {
      const source = assets.get(`${personality}/${cue}`);
      if (!source) throw new Error(`Upstream catalog is missing ${personality}/${cue}.`);
      events[event] = {
        file: `catalog/${source.files.mp3.path}`,
        durationMs: Math.round(source.duration * 1000),
        sha256: await sha256(path.join(target, "catalog", source.files.mp3.path)),
        gain: source.defaultVolume,
        sources: [{
          file: `catalog/${source.files.ogg.path}`,
          mimeType: "audio/ogg; codecs=opus",
          durationMs: Math.round(source.duration * 1000),
          sha256: await sha256(path.join(target, "catalog", source.files.ogg.path))
        }]
      };
    }

    const manifest = {
      schemaVersion: 1,
      pack: { id: `wubble-community-${personality}`, revision: 1, budgetKb: 240 },
      defaults: { gain: 0.55, maxConcurrentSounds: 1 },
      provenance: { upstream: "UI SFX", sourceCommit: "2001f3dac2d1cf86ad99cbad5cef222c3a8b9082", audioLicense: "CC0-1.0" },
      events
    };
    await writeFile(path.join(target, `${personality}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  console.log(`Imported ${upstreamManifest.summary.assets} catalog assets and ${personalityNames.length} Wubble-compatible community packs.`);
}

/** @param {string} file */
async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** @param {string} name */
function argumentValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
