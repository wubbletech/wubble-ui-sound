import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repositoryRoot, "packages/cli/src/index.js");
const sourceDirectory = path.join(repositoryRoot, "examples/vanilla/public/wubble/signal");
const complexFixture = path.join(repositoryRoot, "examples/complex-audit-fixture");

async function runCli(...args) {
  return executeFile(process.execPath, [cliPath, ...args], { cwd: repositoryRoot });
}

async function failureOf(promise) {
  try {
    await promise;
    assert.fail("Expected command to fail.");
  } catch (error) {
    return error;
  }
}

test("CLI validates and inspects the local sample pack", async () => {
  const manifestPath = path.join(sourceDirectory, "manifest.json");
  const validation = await runCli("validate", manifestPath);
  assert.match(validation.stdout, /Valid pack: signal r1/);
  assert.match(validation.stdout, /16 events, 16 assets/);

  const inspection = await runCli("inspect", manifestPath);
  assert.match(inspection.stdout, /Budget:/);
  assert.match(inspection.stdout, /tap: WAV/);
});

test("CLI audits semantic product moments without changing the project", async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "wubble-feedback-audit-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  const source = path.join(project, "src", "app.jsx");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, `"use client";
    export function Profile() {
      async function handleSaveProfile() { await saveProfile(); }
      function handleDeleteWorkspace() { destroyWorkspace(); }
      return <><button onClick={handleSaveProfile}>Save profile</button><button onClick={handleDeleteWorkspace}>Delete workspace</button><button>Help</button></>;
    }
    toast.success("Saved");
    router.push("/settings");
  `, "utf8");
  await writeFile(path.join(project, "src", "large.ts"), "x".repeat(1024 * 1024 + 1), "utf8");

  const before = await readFile(source, "utf8");
  const audit = await runCli("audit", project);
  assert.match(audit.stdout, /Wubble UI Sounds Audit \(read-only\)/);
  assert.match(audit.stdout, /Async action outcome/);
  assert.match(audit.stdout, /Destructive action committed/);
  assert.match(audit.stdout, /Visible success notification/);
  assert.match(audit.stdout, /Navigation transition/);
  assert.match(audit.stdout, /Nothing was changed/);
  assert.equal(await readFile(source, "utf8"), before);

  const json = await runCli("audit", project, "--format", "json");
  const report = JSON.parse(json.stdout);
  assert.equal(report.mode, "read-only");
  assert.equal(report.summary.highConfidence, 3);
  assert.equal(report.summary.mediumConfidence, 1);
  assert.equal(report.summary.skippedLargeFiles, 1);
  const asyncOutcome = report.candidates.find((candidate) => candidate.events.includes("processing"));
  assert.deepEqual(asyncOutcome.events, ["processing", "success", "error"]);
  assert.deepEqual(asyncOutcome.anchor, { type: "named-handler", name: "handleSaveProfile", async: true, body: "BlockStatement" });

  const auditPath = path.join(project, "audit.json");
  await writeFile(auditPath, json.stdout, "utf8");
  const selected = report.candidates.filter((candidate) => candidate.events.includes("processing") || candidate.events.includes("deleteConfirm"));
  const approvalPath = path.join(project, "review", "approved.json");
  const approval = await runCli("approve", "--plan", auditPath, "--select", selected.map((candidate) => candidate.id).join(","), "--output", approvalPath);
  assert.match(approval.stdout, /Recorded approval for 2 recommendations; 2 rejected/);
  assert.match(approval.stdout, /Application source files were not changed/);
  const record = JSON.parse(await readFile(approvalPath, "utf8"));
  assert.equal(record.kind, "wubble-ui-sounds-approval");
  assert.deepEqual(record.approved.map((candidate) => candidate.id), selected.map((candidate) => candidate.id));
  assert.equal(await readFile(source, "utf8"), before);
  await assert.rejects(runCli("approve", "--plan", auditPath, "--select", "not-real", "--output", approvalPath, "--force"), /does not contain: not-real/);

  const previewPath = path.join(project, "review", "feedback-patch-preview.json");
  const preview = await runCli("preview-apply", "--approval", approvalPath, "--output", previewPath);
  assert.match(preview.stdout, /1 safe handler patch across 1 file; 1 require manual review/);
  assert.match(preview.stdout, /import \{ feedback \} from/);
  assert.match(preview.stdout, /Application source files were not changed/);
  const previewRecord = JSON.parse(await readFile(previewPath, "utf8"));
  assert.equal(previewRecord.kind, "wubble-ui-sounds-patch-preview");
  assert.equal(previewRecord.generatedEdits.length, 1);
  assert.equal(previewRecord.manualReview.length, 1);
  const replacement = previewRecord.generatedEdits[0].edits[1].replacement;
  assert.match(replacement, /feedback\.processing\(\)/);
  assert.match(replacement, /feedback\.success\(\)/);
  assert.match(replacement, /feedback\.error\(\)/);
  assert.equal(await readFile(source, "utf8"), before);

  const integration = path.join(project, "src", "lib", "wubble-ui-sounds.js");
  await mkdir(path.dirname(integration), { recursive: true });
  await writeFile(integration, "export const feedback = {};\n", "utf8");
  const previewHash = createHash("sha256").update(await readFile(previewPath, "utf8")).digest("hex");
  const applicationPath = path.join(project, "review", "applied-feedback-patch.json");
  const applyPlan = await runCli("apply", "--preview", previewPath, "--confirm", previewHash, "--output", applicationPath, "--dry-run");
  assert.match(applyPlan.stdout, /Planned 1 reviewed source patch/);
  assert.equal(await readFile(source, "utf8"), before);
  await assert.rejects(runCli("apply", "--preview", previewPath, "--confirm", "not-a-hash", "--output", applicationPath), /requires --confirm with the exact SHA-256/);

  const applied = await runCli("apply", "--preview", previewPath, "--confirm", previewHash, "--output", applicationPath);
  assert.match(applied.stdout, /Applied 1 reviewed source patch/);
  const changed = await readFile(source, "utf8");
  assert.match(changed, /import \{ feedback \} from/);
  assert.match(changed, /feedback\.processing\(\)/);
  const applicationRecord = JSON.parse(await readFile(applicationPath, "utf8"));
  assert.equal(applicationRecord.state, "applied");
  assert.equal(applicationRecord.files.length, 1);
  assert.equal(await readFile(applicationRecord.files[0].snapshot, "utf8"), before);

  const rollbackPlan = await runCli("rollback-changes", "--record", applicationPath, "--dry-run");
  assert.match(rollbackPlan.stdout, /Planned rollback 1 UI sounds source patch/);
  assert.equal(await readFile(source, "utf8"), changed);
  await writeFile(source, `${changed}\n// Later developer work\n`, "utf8");
  await assert.rejects(runCli("rollback-changes", "--record", applicationPath), /Refusing rollback because the applied source changed/);
  await writeFile(source, changed, "utf8");
  const rollback = await runCli("rollback-changes", "--record", applicationPath);
  assert.match(rollback.stdout, /Rolled back 1 UI sounds source patch/);
  assert.equal(await readFile(source, "utf8"), before);
});

test("CLI setup exports the included local Wubble audio", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-setup-"));
  context.after(() => rm(target, { recursive: true, force: true }));

  const setup = await runCli("setup", target);
  assert.match(setup.stdout, /Exported Wubble local audio/);
  assert.match(setup.stdout, /Delivery set: default direction, revision 1/);
  assert.match(await readFile(path.join(target, "src", "lib", "wubble-ui-sounds.js"), "utf8"), /from "@wubbleai\/ui-sounds"/);
  assert.match(await readFile(path.join(target, "wubble.ui-sounds.yml"), "utf8"), /pack: wubble-core/);

  const styledTarget = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-style-"));
  context.after(() => rm(styledTarget, { recursive: true, force: true }));
  const styled = await runCli("setup", styledTarget, "--style", "minimal");
  assert.match(styled.stdout, /Delivery set: minimal direction, revision 1/);
  assert.match(await readFile(path.join(styledTarget, "wubble.ui-sounds.yml"), "utf8"), /pack: wubble-community-minimal/);
});

test("CLI start is the review-first first run", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-start-"));
  context.after(() => rm(target, { recursive: true, force: true }));
  const source = path.join(target, "src", "save-profile.jsx");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, `export function SaveProfile() {
  async function handleSaveProfile() {
    await saveProfile();
  }
  return <button onClick={handleSaveProfile}>Save profile</button>;
}
`, "utf8");
  const before = await readFile(source, "utf8");

  const started = await runCli("start", target, "--select", "all");
  assert.match(started.stdout, /Wubble UI Sounds: local scan complete/);
  assert.match(started.stdout, /Exported compact local audio/);
  assert.match(started.stdout, /Next: review the patch/);
  assert.equal(await readFile(source, "utf8"), before);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds", "recommended.patch"), "utf8"), /feedback\.processing/);

  const help = await runCli("start", "--help");
  assert.match(help.stdout, /The recommended first run/);
  const directions = await runCli("directions");
  assert.match(directions.stdout, /Included Wubble sound directions/);
  assert.match(directions.stdout, /minimal, soft, glass/);
});

test("CLI add lets a developer review and explicitly apply an async outcome patch", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-add-"));
  context.after(() => rm(target, { recursive: true, force: true }));
  const source = path.join(target, "src", "components", "save-button.jsx");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, `export function SaveButton() {
  async function handleSaveProfile() {
    await saveProfile();
  }
  return <button onClick={handleSaveProfile}>Save profile</button>;
}
`, "utf8");
  const before = await readFile(source, "utf8");

  const reviewed = await runCli("add", target, "--select", "all", "--setup");
  assert.match(reviewed.stdout, /local scan complete/);
  assert.match(reviewed.stdout, /Scanned 1 source file.*Found 1 feedback moment; 1 sound recommendation selected/);
  assert.match(reviewed.stdout, /Exported compact local audio/);
  assert.match(reviewed.stdout, /Saved sound plan:/);
  assert.match(reviewed.stdout, /1 safe handler patch across 1 file/);
  assert.match(reviewed.stdout, /PR-ready patch:/);
  assert.match(reviewed.stdout, /Review confirmation SHA-256:/);
  assert.match(reviewed.stdout, /feedback\.processing\(\)/);
  assert.equal(await readFile(source, "utf8"), before);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds", "sound-plan.md"), "utf8"), /## Save and submit/);
  const reviewPatch = await readFile(path.join(target, ".wubble-ui-sounds", "recommended.patch"), "utf8");
  assert.match(reviewPatch, /diff --git a\/src\/components\/save-button\.jsx b\/src\/components\/save-button\.jsx/);
  assert.match(reviewPatch, /\+    void feedback\.processing\(\);/);
  await executeFile("git", ["init", "--quiet"], { cwd: target });
  await executeFile("git", ["apply", "--check", path.join(target, ".wubble-ui-sounds", "recommended.patch")], { cwd: target });
  assert.match(await readFile(path.join(target, "src", "lib", "wubble-ui-sounds.js"), "utf8"), /createFeedbackClient/);

  const applied = await runCli("add", target, "--select", "all", "--apply", "--yes", "--force");
  assert.match(applied.stdout, /Applied reviewed source changes/);
  assert.match(await readFile(source, "utf8"), /feedback\.success\(\)/);
});

test("CLI add gives non-sound recommendations a deliberate plan instead of generating noisy patches", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-plan-"));
  context.after(() => rm(target, { recursive: true, force: true }));
  const source = path.join(target, "src", "settings.jsx");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, `"use client";
    function handleToggleNotifications() { setNotifications(true); }
    toast.success("Saved");
    router.push("/settings");
  `, "utf8");

  const planned = await runCli("add", target, "--select", "none");
  assert.match(planned.stdout, /Binary setting transition -> haptic/);
  assert.match(planned.stdout, /Visible success notification -> visual-only/);
  assert.match(planned.stdout, /Navigation transition -> none/);
  const plan = await readFile(path.join(target, ".wubble-ui-sounds", "sound-plan.md"), "utf8");
  assert.match(plan, /## Settings/);
  assert.match(plan, /A brief native haptic/);
  assert.match(plan, /## Visible outcomes/);
  assert.match(plan, /## Navigation and surfaces/);
});

test("complex product audit stays unique, skips local Wubble integration, and preserves manual review boundaries", async () => {
  const audit = await runCli("audit", complexFixture, "--scope", "app", "--format", "json");
  const report = JSON.parse(audit.stdout);
  assert.equal(report.framework, "React or Next.js");
  assert.equal(report.summary.recommended, 14);
  assert.equal(report.summary.skippedExistingFeedbackFiles, 1);
  assert.equal(new Set(report.candidates.map((candidate) => candidate.id)).size, report.candidates.length);
  assert.equal(report.candidates.filter((candidate) => candidate.location === "app/account/profile-form.tsx:16").length, 0);
  assert.ok(report.candidates.some((candidate) => candidate.id === "F004-send-2" && candidate.location === "app/inbox/message-composer.tsx:4"));
  assert.ok(report.candidates.some((candidate) => candidate.recommendation.mode === "haptic" && candidate.location === "app/settings/notification-settings.tsx:4"));
  assert.ok(report.candidates.some((candidate) => candidate.recommendation.mode === "visual-only" && candidate.location === "app/workspace/workspace-actions.tsx:14"));
  assert.ok(report.candidates.some((candidate) => candidate.recommendation.mode === "none" && candidate.location === "app/workspace/workspace-actions.tsx:18"));
  assert.ok(report.candidates.some((candidate) => candidate.location === "app/workspace/actions.ts:3" && candidate.events.join(",") === "processing,success,error" && candidate.implementation.mode === "manual-review"));
});

test("complex product review merges multiple safe handlers in one file into one Git-valid patch", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-complex-"));
  context.after(() => rm(target, { recursive: true, force: true }));
  await cp(complexFixture, target, { recursive: true });

  const reviewed = await runCli("add", target, "--scope", "app", "--select", "all", "--setup");
  assert.match(reviewed.stdout, /Found 14 feedback moments; 11 sound recommendations selected/);
  assert.match(reviewed.stdout, /4 safe handler patches across 3 files; 7 need manual review/);
  assert.match(reviewed.stdout, /Implementation: Server or non-client code/);
  const preview = JSON.parse(await readFile(path.join(target, ".wubble-ui-sounds", "patch-preview.json"), "utf8"));
  assert.equal(preview.generatedEdits.length, 3);
  const profileEdit = preview.generatedEdits.find((entry) => entry.file.endsWith("app/account/profile-form.tsx"));
  assert.equal(profileEdit.edits.filter((edit) => edit.purpose.startsWith("Import")).length, 1);
  assert.equal(profileEdit.edits.filter((edit) => edit.purpose.startsWith("Play processing")).length, 2);
  assert.ok(preview.manualReview.some((entry) => entry.location === "app/workspace/actions.ts:3" && /not an explicit client module/.test(entry.reason)));
  await executeFile("git", ["init", "--quiet"], { cwd: target });
  await executeFile("git", ["apply", "--check", path.join(target, ".wubble-ui-sounds", "recommended.patch")], { cwd: target });
  await runCli("add", target, "--scope", "app", "--select", "all", "--apply", "--yes", "--force");
  const profile = await readFile(path.join(target, "app", "account", "profile-form.tsx"), "utf8");
  assert.equal((profile.match(/import \{ feedback \}/g) ?? []).length, 1);
  assert.equal((profile.match(/feedback\.success\(\)/g) ?? []).length, 2);
});

test("CLI exports safely and refuses to overwrite customer changes", async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-feedback-"));
  context.after(() => rm(target, { recursive: true, force: true }));

  const existingPage = path.join(target, "src/app/page.js");
  await mkdir(path.dirname(existingPage), { recursive: true });
  await writeFile(existingPage, "export default function Page() { return null; }\n", "utf8");

  const exportPlan = await runCli("export", "--source", sourceDirectory, "--target", target, "--dry-run");
  assert.match(exportPlan.stdout, /Planned export Wubble local audio/);
  assert.match(exportPlan.stdout, /Delivery set: default direction, revision 1/);
  await assert.rejects(readFile(path.join(target, "wubble.ui-sounds.yml"), "utf8"));

  const firstExport = await runCli("export", "--source", sourceDirectory, "--target", target);
  assert.match(firstExport.stdout, /Exported Wubble local audio/);
  assert.match(firstExport.stdout, /Delivery set: default direction, revision 1/);

  const integrationPath = path.join(target, "src/lib/wubble-ui-sounds.js");
  const configPath = path.join(target, "wubble.ui-sounds.yml");
  const manifestPath = path.join(target, "public/wubble/signal/manifest.json");
  const integration = await readFile(integrationPath, "utf8");
  assert.match(integration, /createFeedbackClient/);
  assert.match(integration, /feedbackManifest/);
  assert.doesNotMatch(integration, /https?:\/\/|token|secret|apiKey/i);
  assert.match(await readFile(configPath, "utf8"), /pack: signal/);
  assert.match(await readFile(manifestPath, "utf8"), /"schemaVersion": 1/);
  assert.match(await readFile(existingPage, "utf8"), /export default function Page/);
  const exportedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.match(exportedManifest.events.tap.file, /^tap\.[a-f\d]{12}\.wav$/);
  assert.match(
    await readFile(path.join(target, "public/wubble/signal", exportedManifest.events.tap.file), "ascii"),
    /RIFF/
  );

  const exportedValidation = await runCli("validate", manifestPath);
  assert.match(exportedValidation.stdout, /Valid pack: signal r1/);

  const secondExport = await runCli("export", "--source", sourceDirectory, "--target", target);
  assert.match(secondExport.stdout, /= .*wubble-ui-sounds\.js/);

  await writeFile(integrationPath, "// customer customization\n", "utf8");
  await assert.rejects(
    runCli("export", "--source", sourceDirectory, "--target", target),
    /would overwrite changed files/
  );

  await runCli("export", "--source", sourceDirectory, "--target", target, "--force");
  assert.match(await readFile(integrationPath, "utf8"), /Generated by Wubble UI Sounds/);
});

test("CLI validates and exports declared event variants", async (context) => {
  const packDirectory = await mkdtemp(path.join(os.tmpdir(), "wubble-variant-pack-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-variant-export-"));
  context.after(() => Promise.all([rm(packDirectory, { recursive: true, force: true }), rm(target, { recursive: true, force: true })]));
  await cp(sourceDirectory, packDirectory, { recursive: true });

  const manifestPath = path.join(packDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await cp(path.join(packDirectory, "tap.wav"), path.join(packDirectory, "tap-alt.wav"));
  manifest.events.tap.variants = [{
    file: "tap-alt.wav",
    durationMs: manifest.events.tap.durationMs,
    sha256: manifest.events.tap.sha256,
    gain: manifest.events.tap.gain
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const validation = await runCli("validate", manifestPath);
  assert.match(validation.stdout, /Valid pack: signal r1/);
  await runCli("export", "--source", packDirectory, "--target", target);

  const exportedManifest = JSON.parse(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"));
  const variant = exportedManifest.events.tap.variants[0];
  assert.match(variant.file, /^tap-alt\.[a-f\d]{12}\.wav$/);
  assert.match(await readFile(path.join(target, "public/wubble/signal", variant.file), "ascii"), /RIFF/);
});

test("CLI exports all declared local codec sources", async (context) => {
  const packDirectory = await mkdtemp(path.join(os.tmpdir(), "wubble-codec-pack-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-codec-export-"));
  context.after(() => Promise.all([rm(packDirectory, { recursive: true, force: true }), rm(target, { recursive: true, force: true })]));
  await cp(sourceDirectory, packDirectory, { recursive: true });

  const manifestPath = path.join(packDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await cp(path.join(packDirectory, "tap.wav"), path.join(packDirectory, "tap.webm"));
  manifest.events.tap.sources = [{
    file: "tap.webm",
    mimeType: "audio/webm; codecs=opus",
    durationMs: manifest.events.tap.durationMs,
    sha256: manifest.events.tap.sha256
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await runCli("export", "--source", packDirectory, "--target", target);
  const exportedManifest = JSON.parse(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"));
  const source = exportedManifest.events.tap.sources[0];
  assert.match(source.file, /^tap\.[a-f\d]{12}\.webm$/);
  assert.ok(await readFile(path.join(target, "public/wubble/signal", source.file)));
});

test("CLI exports a React Native pack with a Metro-safe local asset map", async (context) => {
  const packDirectory = await mkdtemp(path.join(os.tmpdir(), "wubble-native-pack-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-native-target-"));
  context.after(() => Promise.all([rm(packDirectory, { recursive: true, force: true }), rm(target, { recursive: true, force: true })]));
  await cp(sourceDirectory, packDirectory, { recursive: true });

  const manifestPath = path.join(packDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await cp(path.join(packDirectory, "tap.wav"), path.join(packDirectory, "tap.m4a"));
  manifest.events.tap.sources = [{
    file: "tap.m4a",
    mimeType: "audio/mp4; codecs=mp4a.40.2",
    durationMs: manifest.events.tap.durationMs,
    sha256: manifest.events.tap.sha256
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const exportResult = await runCli("export", "--source", packDirectory, "--target", target, "--platform", "react-native");
  assert.match(exportResult.stdout, /Exported Wubble local audio/);
  assert.match(exportResult.stdout, /Delivery set: default direction, revision 1/);
  const nativeManifestPath = path.join(target, "src/assets/wubble/signal/manifest.json");
  const nativeManifest = JSON.parse(await readFile(nativeManifestPath, "utf8"));
  assert.match(nativeManifest.events.tap.file, /^tap\.[a-f\d]{12}\.m4a$/);
  assert.equal(nativeManifest.events.tap.sources, undefined);
  assert.ok(await readFile(path.join(target, "src/assets/wubble/signal", nativeManifest.events.tap.file)));
  const integration = await readFile(path.join(target, "src/lib/wubble-ui-sounds.native.js"), "utf8");
  assert.match(integration, /createNativeFeedbackClient/);
  assert.match(integration, /require\("\.\.\/assets\/wubble\/signal\/tap\.[a-f\d]{12}\.m4a"\)/);
  assert.match(await readFile(path.join(target, "wubble.ui-sounds.native.yml"), "utf8"), /platform: react-native/);
  await assert.rejects(readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"));

  manifest.pack.revision = 2;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await runCli("upgrade", "--source", packDirectory, "--target", target, "--platform", "react-native");
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/react-native/state.json"), "utf8"), /"revision": 2/);
  await runCli("rollback", "--target", target, "--pack", "signal", "--revision", "1", "--platform", "react-native");
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/react-native/state.json"), "utf8"), /"revision": 1/);
});

test("CLI verifies and installs a signed release archive", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wubble-archive-install-"));
  const target = path.join(root, "customer-app");
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
  const archivePath = path.join(root, "signal.wubblepack");
  const publicKeyPath = path.join(root, "wubble-release.pem");
  const trustedKeysPath = path.join(root, "wubble-trusted-keys.json");
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey.export({ format: "pem", type: "pkcs8" });
  const publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" });
  await writeFile(publicKeyPath, publicKeyPem);
  await writeFile(trustedKeysPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: { "release-2026-08": { status: "active", publicKey: publicKeyPem } }
  }, null, 2)}\n`);
  await writeFile(archivePath, await createSignedArchive({ manifest, sourceDirectory, privateKeyPem }));

  const verification = await runCli("verify-archive", "--archive", archivePath, "--public-key", publicKeyPath);
  assert.match(verification.stdout, /Verified signal r1 with key release-2026-08: 16 assets/);

  const registryVerification = await runCli("verify-archive", "--archive", archivePath, "--trusted-keys", trustedKeysPath);
  assert.match(registryVerification.stdout, /Verified signal r1 with key release-2026-08: 16 assets/);

  await writeFile(trustedKeysPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: { "release-2026-08": { status: "retired", publicKey: publicKeyPem } }
  }, null, 2)}\n`);
  const retiredVerification = await runCli("verify-archive", "--archive", archivePath, "--trusted-keys", trustedKeysPath);
  assert.match(retiredVerification.stdout, /Verified signal r1 with key release-2026-08: 16 assets/);
  await writeFile(trustedKeysPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: { "release-2026-08": { status: "active", publicKey: publicKeyPem } }
  }, null, 2)}\n`);

  const installation = await runCli("install", "--archive", archivePath, "--trusted-keys", trustedKeysPath, "--target", target);
  assert.match(installation.stdout, /Exported Wubble local audio/);
  assert.match(installation.stdout, /Delivery set: default direction, revision 1/);
  assert.match(installation.stdout, /Verified archive: [a-f\d]{64} \(release-2026-08\)/);
  assert.match(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"), /"schemaVersion": 1/);

  const wrongKeyPath = path.join(root, "wrong.pem");
  await writeFile(wrongKeyPath, generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }));
  const wrongKey = await failureOf(runCli("verify-archive", "--archive", archivePath, "--public-key", wrongKeyPath));
  assert.match(wrongKey.stderr, /signature is invalid/);

  const unsupportedManifest = structuredClone(manifest);
  unsupportedManifest.schemaVersion = 2;
  const unsupportedArchive = path.join(root, "signal-unsupported.wubblepack");
  await writeFile(unsupportedArchive, await createSignedArchive({ manifest: unsupportedManifest, sourceDirectory, privateKeyPem }));
  const unsupportedSchema = await failureOf(runCli("verify-archive", "--archive", unsupportedArchive, "--trusted-keys", trustedKeysPath));
  assert.match(unsupportedSchema.stderr, /newer than this SDK supports/);

  const revisionTwo = structuredClone(manifest);
  revisionTwo.pack.revision = 2;
  const revisionTwoArchive = path.join(root, "signal-r2.wubblepack");
  await writeFile(revisionTwoArchive, await createSignedArchive({ manifest: revisionTwo, sourceDirectory, privateKeyPem }));
  const upgrade = await runCli("upgrade", "--archive", revisionTwoArchive, "--trusted-keys", trustedKeysPath, "--target", target);
  assert.match(upgrade.stdout, /Upgraded signal r1 -> r2/);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/state.json"), "utf8"), /"revision": 2/);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/snapshots/r1/state.json"), "utf8"), /"revision": 1/);

  const rollback = await runCli("rollback", "--target", target, "--pack", "signal", "--revision", "1");
  assert.match(rollback.stdout, /Rolled back signal r2 -> r1/);
  assert.match(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"), /"revision": 1/);

  const revokedKeysPath = path.join(root, "wubble-revoked-keys.json");
  await writeFile(revokedKeysPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: { "release-2026-08": { status: "revoked", publicKey: publicKeyPem } }
  }, null, 2)}\n`);
  const revokedKey = await failureOf(runCli("verify-archive", "--archive", archivePath, "--trusted-keys", revokedKeysPath));
  assert.match(revokedKey.stderr, /release-2026-08 is revoked/);
});

test("CLI upgrades a managed install, protects customer changes, and rolls back", async (context) => {
  const packDirectory = await mkdtemp(path.join(os.tmpdir(), "wubble-upgrade-pack-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "wubble-upgrade-target-"));
  context.after(() => Promise.all([rm(packDirectory, { recursive: true, force: true }), rm(target, { recursive: true, force: true })]));
  await cp(sourceDirectory, packDirectory, { recursive: true });

  await runCli("export", "--source", sourceDirectory, "--target", target);
  const statePath = path.join(target, ".wubble-ui-sounds/signal/state.json");
  assert.match(await readFile(statePath, "utf8"), /"revision": 1/);

  const manifestPath = path.join(packDirectory, "manifest.json");
  const upgradeManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  upgradeManifest.pack.revision = 2;
  await writeFile(manifestPath, `${JSON.stringify(upgradeManifest, null, 2)}\n`, "utf8");

  const plan = await runCli("upgrade", "--source", packDirectory, "--target", target, "--dry-run");
  assert.match(plan.stdout, /Planned upgrade signal r1 -> r2/);
  await assert.rejects(readFile(path.join(target, ".wubble-ui-sounds/signal/snapshots/r1/state.json"), "utf8"));

  const upgrade = await runCli("upgrade", "--source", packDirectory, "--target", target);
  assert.match(upgrade.stdout, /Upgraded signal r1 -> r2/);
  assert.match(await readFile(statePath, "utf8"), /"revision": 2/);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/snapshots/r1/state.json"), "utf8"), /"revision": 1/);
  assert.match(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"), /"revision": 2/);

  const integrationPath = path.join(target, "src/lib/wubble-ui-sounds.js");
  const expectedIntegration = await readFile(integrationPath, "utf8");
  await writeFile(integrationPath, "// customer customization\n", "utf8");
  const protectedRollback = await failureOf(runCli("rollback", "--target", target, "--pack", "signal", "--revision", "1"));
  assert.match(protectedRollback.stderr, /managed files were changed or removed/);

  await writeFile(integrationPath, expectedIntegration, "utf8");
  const rollback = await runCli("rollback", "--target", target, "--pack", "signal", "--revision", "1");
  assert.match(rollback.stdout, /Rolled back signal r2 -> r1/);
  assert.match(await readFile(statePath, "utf8"), /"revision": 1/);
  assert.match(await readFile(path.join(target, "public/wubble/signal/manifest.json"), "utf8"), /"revision": 1/);
  assert.match(await readFile(path.join(target, ".wubble-ui-sounds/signal/snapshots/r2/state.json"), "utf8"), /"revision": 2/);
});

async function createSignedArchive({ manifest, sourceDirectory, privateKeyPem }) {
  const files = collectManifestFiles(manifest);
  const assets = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(path.join(sourceDirectory, file));
    return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") };
  }));
  const unsigned = {
    format: "wubble-pack",
    schemaVersion: 1,
    pack: manifest.pack,
    createdAt: "2026-08-09T00:00:00.000Z",
    signature: { algorithm: "ed25519", keyId: "release-2026-08" },
    manifest,
    records: { audit: { packId: manifest.pack.id }, qualityReport: { schemaVersion: 1 } },
    assets
  };
  const signature = sign(null, Buffer.from(canonicalize(unsigned)), privateKeyPem).toString("base64");
  return gzipSync(Buffer.from(JSON.stringify({ ...unsigned, signature: { ...unsigned.signature, value: signature } })));
}

function collectManifestFiles(manifest) {
  const files = new Set();
  const add = (asset) => {
    files.add(asset.file);
    for (const source of asset.sources ?? []) add(source);
    for (const variant of asset.variants ?? []) add(variant);
  };
  for (const asset of Object.values(manifest.events)) add(asset);
  return [...files].sort();
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

test("CLI catches malformed manifests, missing assets, and budget failures", async (context) => {
  const packDirectory = await mkdtemp(path.join(os.tmpdir(), "wubble-invalid-pack-"));
  context.after(() => rm(packDirectory, { recursive: true, force: true }));
  await cp(sourceDirectory, packDirectory, { recursive: true });
  const manifestPath = path.join(packDirectory, "manifest.json");

  const missingAssetManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  missingAssetManifest.events.tap.file = "missing.wav";
  await writeFile(manifestPath, `${JSON.stringify(missingAssetManifest)}\n`, "utf8");
  const missingAssetFailure = await failureOf(runCli("validate", manifestPath));
  assert.match(missingAssetFailure.stderr, /Referenced asset file does not exist/);

  await writeFile(manifestPath, "{ not valid json", "utf8");
  const malformedFailure = await failureOf(runCli("validate", manifestPath));
  assert.match(malformedFailure.stderr, /Unable to read manifest/);

  await cp(sourceDirectory, packDirectory, { recursive: true, force: true });
  const budgetFailure = await failureOf(runCli("validate", manifestPath, "--budget-kb", "1"));
  assert.match(budgetFailure.stderr, /exceeds the 1 KB budget/);
});
