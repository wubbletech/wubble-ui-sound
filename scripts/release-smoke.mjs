import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const root = process.cwd();
const packages = ["@wubble/manifest", "@wubble/sounds", "@wubble/react", "@wubble/react-native", "@wubble/ui-sounds", "@wubble/core-pack", "@wubble/community-sfx"];
const workspaceVersions = new Map(await Promise.all(packages.map(async (name) => {
  const directory = packageDirectory(name);
  const value = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
  return [name, value.version];
})));
const scratch = await mkdtemp(path.join(os.tmpdir(), "wubble-release-smoke-"));

try {
  const artifacts = await packArtifacts(path.join(scratch, "artifacts"));
  await smokeVanilla(path.join(scratch, "vanilla"), artifacts);
  await smokeNext(path.join(scratch, "next"), artifacts);
  console.log(`Release smoke passed for ${[...workspaceVersions.values()][0]} using ${artifacts.size} packed artifacts.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

/** @param {string} destination */
async function packArtifacts(destination) {
  await mkdir(destination, { recursive: true });
  const artifacts = new Map();
  for (const name of packages) {
    const { stdout } = await runFile("npm", ["pack", "--workspace", name, "--json", "--pack-destination", destination], { cwd: root });
    const packed = JSON.parse(stdout);
    assert.equal(packed.length, 1, `Expected one artifact for ${name}.`);
    artifacts.set(name, path.join(destination, packed[0].filename));
  }
  return artifacts;
}

/** @param {string} directory @param {Map<string, string>} artifacts */
async function smokeVanilla(directory, artifacts) {
  await writeProjectPackage(directory, "wubble-vanilla-smoke", {
    "@wubble/manifest": artifactSpec(artifacts, "@wubble/manifest"),
    "@wubble/sounds": artifactSpec(artifacts, "@wubble/sounds"),
    "@wubble/react-native": artifactSpec(artifacts, "@wubble/react-native"),
    "@wubble/ui-sounds": artifactSpec(artifacts, "@wubble/ui-sounds"),
    "@wubble/core-pack": artifactSpec(artifacts, "@wubble/core-pack"),
    "@wubble/community-sfx": artifactSpec(artifacts, "@wubble/community-sfx")
  });
  await npmInstall(directory);
  await writeFile(path.join(directory, "smoke.mjs"), `
import assert from "node:assert/strict";
import { validateManifest } from "@wubble/manifest";
import { createFeedbackClient } from "@wubble/sounds";
import { createFeedbackClient as createUiSoundsClient } from "@wubble/ui-sounds";
import { createNativeFeedbackClient } from "@wubble/react-native";

const manifest = { schemaVersion: 1, pack: { id: "smoke", revision: 1 }, events: { tap: { file: "tap.wav", durationMs: 80, sha256: "fixture" } } };
assert.deepEqual(validateManifest(manifest), { valid: true, errors: [] });
assert.deepEqual(await createFeedbackClient(manifest).tap(), { played: false, reason: "disabled" });
assert.deepEqual(await createUiSoundsClient(manifest).tap(), { played: false, reason: "disabled" });
assert.deepEqual(await createNativeFeedbackClient(manifest, { assets: () => "tap", audio: { play: async () => ({ stop() {}, finished: Promise.resolve() }) } }).tap(), { played: false, reason: "disabled" });
`, "utf8");
  await runFile(process.execPath, ["smoke.mjs"], { cwd: directory });
  await runFile(path.join(directory, "node_modules/.bin/wubble-ui-sounds"), ["help"], { cwd: directory });
  await runFile(path.join(directory, "node_modules/.bin/wubble-ui-sounds"), ["setup", directory, "--dry-run"], { cwd: directory });
  await runFile(path.join(directory, "node_modules/.bin/wubble-ui-sounds"), ["validate", "node_modules/@wubble/core-pack/pack/manifest.json"], { cwd: directory });
  await runFile(path.join(directory, "node_modules/.bin/wubble-ui-sounds"), ["validate", "node_modules/@wubble/community-sfx/minimal.manifest.json"], { cwd: directory });
}

/** @param {string} directory @param {Map<string, string>} artifacts */
async function smokeNext(directory, artifacts) {
  await writeProjectPackage(directory, "wubble-next-smoke", {
    "@wubble/manifest": artifactSpec(artifacts, "@wubble/manifest"),
    "@wubble/sounds": artifactSpec(artifacts, "@wubble/sounds"),
    "@wubble/react": artifactSpec(artifacts, "@wubble/react"),
    next: "16.3.0",
    react: "19.0.0",
    "react-dom": "19.0.0"
  }, { build: "next build" });
  await npmInstall(directory);
  await mkdir(path.join(directory, "app"), { recursive: true });
  await writeFile(path.join(directory, "app/page.js"), `import { FeedbackExample } from "./feedback-example";\nexport default function Page() { return <FeedbackExample />; }\n`, "utf8");
  await writeFile(path.join(directory, "app/feedback-example.js"), `"use client";\nimport { FeedbackProvider, FeedbackButton } from "@wubble/react";\nconst manifest = { schemaVersion: 1, pack: { id: "smoke", revision: 1 }, events: { tap: { file: "tap.wav", durationMs: 80, sha256: "fixture" } } };\nexport function FeedbackExample() { return <FeedbackProvider manifest={manifest}><FeedbackButton event="tap">Save</FeedbackButton></FeedbackProvider>; }\n`, "utf8");
  await runFile("npm", ["run", "build"], { cwd: directory, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
}

/** @param {string} directory @param {string} name @param {Record<string, string>} dependencies @param {Record<string, string>} [scripts] */
async function writeProjectPackage(directory, name, dependencies, scripts = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify({ name, private: true, type: "module", scripts, dependencies }, null, 2)}\n`, "utf8");
}

/** @param {string} directory */
async function npmInstall(directory) {
  await runFile("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], { cwd: directory });
}

/** @param {Map<string, string>} artifacts @param {string} name */
function artifactSpec(artifacts, name) {
  return `file:${artifacts.get(name)}`;
}

/** @param {string} name */
function packageDirectory(name) {
  return name === "@wubble/manifest" ? "packages/manifest"
    : name === "@wubble/sounds" ? "packages/sounds"
      : name === "@wubble/react" ? "packages/react"
      : name === "@wubble/react-native" ? "packages/react-native"
          : name === "@wubble/ui-sounds" ? "packages/cli"
            : name === "@wubble/core-pack" ? "packages/core-pack"
              : "packages/community-sfx";
}
