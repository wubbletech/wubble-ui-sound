#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { approveAuditPlan } from "./approval.js";
import { addUiSounds } from "./add.js";
import { auditProject, formatAudit } from "./audit.js";
import { createPatchPreview } from "./patch-preview.js";
import { applyPatchPreview, rollbackFeedbackPatch } from "./patch-apply.js";
import { exportPack, inspectPack, installPackArchive, rollbackPack, upgradePack, upgradePackArchive, validatePack } from "./pack.js";
import { verifyPackArchive } from "./archive.js";

const require = createRequire(import.meta.url);
const SOUND_DIRECTIONS = ["minimal", "soft", "glass", "arcade", "mechanical", "organic", "dreamy", "scifi", "rubber", "cinematic", "studio", "zen"];

const HELP = `Wubble UI Sounds

Quick start:
  wubble-ui-sounds start .

Usage:
  wubble-ui-sounds start [app-directory] [--scope <path,...>] [--cache] [--style <direction>] [--select <all|none|ids>] [--patch <file>] [--apply] [--yes] [--force] [--dry-run]
  wubble-ui-sounds directions
  wubble-ui-sounds setup [app-directory] [--platform web|react-native] [--style <direction>] [--budget-kb <number>] [--dry-run] [--force]
  wubble-ui-sounds add [app-directory] [--scope <path,...>] [--cache] [--setup] [--style <direction>] [--patch <file>] [--apply] [--select <all|none|ids>] [--yes] [--force] [--dry-run]
  wubble-ui-sounds validate <manifest> [--budget-kb <number>]
  wubble-ui-sounds inspect <manifest> [--budget-kb <number>]
  wubble-ui-sounds audit [project-directory] [--scope <path,...>] [--cache] [--format text|json]
  wubble-ui-sounds approve --plan <audit.json> --select <all|none|candidate-id,...> [--output <approval.json>] [--dry-run] [--force]
  wubble-ui-sounds preview-apply --approval <approval.json> [--output <preview.json>] [--dry-run] [--force]
  wubble-ui-sounds apply --preview <preview.json> --confirm <preview-sha256> [--output <application.json>] [--dry-run]
  wubble-ui-sounds rollback-changes --record <application.json> [--dry-run]
  wubble-ui-sounds export --source <pack-directory-or-manifest> --target <app-directory> [--platform web|react-native] [--budget-kb <number>] [--dry-run] [--force]
  wubble-ui-sounds upgrade (--source <pack-directory-or-manifest> | --archive <pack.wubblepack>) --target <app-directory> [--public-key <trusted-public-key.pem> | --trusted-keys <trusted-keys.json>] [--platform web|react-native] [--budget-kb <number>] [--dry-run]
  wubble-ui-sounds rollback --target <app-directory> --pack <pack-id> --revision <number> [--platform web|react-native] [--dry-run]
  wubble-ui-sounds verify-archive --archive <pack.wubblepack> (--public-key <trusted-public-key.pem> | --trusted-keys <trusted-keys.json>)
  wubble-ui-sounds install --archive <pack.wubblepack> (--public-key <trusted-public-key.pem> | --trusted-keys <trusted-keys.json>) --target <app-directory> [--platform web|react-native] [--budget-kb <number>] [--dry-run] [--force]

Commands:
  start     The recommended first run: scan an app, review recommendations, export local audio, and prepare a patch.
  directions  List the included sound directions for teams that want to tune the local delivery set.
  setup     Export Wubble's compact local audio set into an application.
  add       The configurable form of start for established workflows and automation.
  validate  Verify the manifest, local paths, files, hashes, WAV duration metadata, and pack budget.
  inspect   Print a concise inventory of the pack and its asset budget.
  audit     Read a codebase and propose reviewable feedback moments. It never changes application files.
  approve   Record explicitly approved audit recommendations. It never changes application files.
  preview-apply  Create a hash-bound patch preview from approved recommendations. It never changes application files.
  apply     Apply a reviewed preview only when its exact hash and every source file still match.
  rollback-changes  Restore the local source snapshot created by apply.
  export    Plan or copy a valid local pack into a web or React Native application.
  upgrade   Preview or apply a newer managed pack revision, with a local rollback snapshot.
  rollback  Restore a verified local snapshot of an earlier managed pack revision.
  verify-archive  Verify a signed release artifact and every included asset.
  install   Verify a signed release artifact, then export it into an application.
`;

async function main(argv) {
  const [command, ...argumentsList] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }
  if (command === "help") {
    const topic = argv[1];
    console.log(topic ? commandHelp(topic) : HELP);
    return 0;
  }
  if (argumentsList.length === 1 && (argumentsList[0] === "--help" || argumentsList[0] === "-h")) {
    console.log(commandHelp(command));
    return 0;
  }

  const options = parseOptions(argumentsList);
  if (options.error) {
    console.error(`Error: ${options.error}\n`);
    console.error(HELP);
    return 1;
  }

  try {
    if (command === "validate") {
      const manifestPath = options.positionals[0];
      if (!manifestPath) {
        throw new Error("validate requires a manifest path.");
      }
      const report = await validatePack(path.resolve(manifestPath), options.budgetKb);
      printValidationReport(report);
      return report.valid ? 0 : 1;
    }

    if (command === "inspect") {
      const manifestPath = options.positionals[0];
      if (!manifestPath) {
        throw new Error("inspect requires a manifest path.");
      }
      const report = await inspectPack(path.resolve(manifestPath), options.budgetKb);
      printInspection(report);
      return report.valid ? 0 : 1;
    }

    if (command === "audit") {
      const directory = options.positionals[0] ?? process.cwd();
      const report = await auditProject(directory, { scopes: options.scopes, cache: options.cache });
      console.log(options.format === "json" ? JSON.stringify(report, null, 2) : formatAudit(report));
      return 0;
    }

    if (command === "start" || command === "add") {
      const target = options.positionals[0] ?? process.cwd();
      const result = await addUiSounds({ target, scopes: options.scopes, cache: options.cache, select: options.select, setup: command === "start" || options.setup, patch: options.patch, platform: options.platform, style: options.style, apply: options.apply, yes: options.yes, force: options.force, dryRun: options.dryRun });
      printAdd(result);
      return 0;
    }

    if (command === "directions") {
      printDirections();
      return 0;
    }

    if (command === "setup") {
      const target = options.positionals[0] ?? process.cwd();
      const source = resolveIncludedSource(options.style);
      const result = await exportPack({
        source,
        target: path.resolve(target),
        budgetKb: options.budgetKb,
        platform: options.platform,
        force: options.force,
        dryRun: options.dryRun
      });
      printExport(result);
      return 0;
    }

    if (command === "approve") {
      if (!options.plan || !options.select) throw new Error("approve requires --plan and --select.");
      const result = await approveAuditPlan({
        plan: options.plan,
        select: options.select,
        output: options.output,
        force: options.force,
        dryRun: options.dryRun
      });
      printApproval(result);
      return 0;
    }

    if (command === "preview-apply") {
      if (!options.approval) throw new Error("preview-apply requires --approval.");
      const result = await createPatchPreview({
        approval: options.approval,
        output: options.output,
        force: options.force,
        dryRun: options.dryRun
      });
      printPatchPreview(result);
      return 0;
    }

    if (command === "apply") {
      if (!options.preview || !options.confirm) throw new Error("apply requires --preview and --confirm.");
      const result = await applyPatchPreview({
        preview: options.preview,
        confirm: options.confirm,
        output: options.output,
        dryRun: options.dryRun
      });
      printPatchApplication(result);
      return 0;
    }

    if (command === "rollback-changes") {
      if (!options.record) throw new Error("rollback-changes requires --record.");
      const result = await rollbackFeedbackPatch({ record: options.record, dryRun: options.dryRun });
      printFeedbackRollback(result);
      return 0;
    }

    if (command === "export") {
      if (!options.source || !options.target) {
        throw new Error("export requires --source and --target.");
      }
      const result = await exportPack({
        source: path.resolve(options.source),
        target: path.resolve(options.target),
        budgetKb: options.budgetKb,
        platform: options.platform,
        force: options.force,
        dryRun: options.dryRun
      });
      printExport(result);
      return 0;
    }

    if (command === "upgrade") {
      if (!options.target || (!options.source && !options.archive) || (options.source && options.archive)) {
        throw new Error("upgrade requires --target and exactly one of --source or --archive.");
      }
      const result = options.archive
        ? await upgradePackArchive({
          archive: path.resolve(options.archive),
          ...archiveTrustPaths(options),
          target: path.resolve(options.target),
          budgetKb: options.budgetKb,
          platform: options.platform,
          dryRun: options.dryRun
        })
        : await upgradePack({
          source: path.resolve(options.source),
          target: path.resolve(options.target),
          budgetKb: options.budgetKb,
          platform: options.platform,
          dryRun: options.dryRun
        });
      printRevisionChange("upgrade", result);
      return 0;
    }

    if (command === "rollback") {
      if (!options.target || !options.pack || !options.revision) {
        throw new Error("rollback requires --target, --pack, and --revision.");
      }
      const result = await rollbackPack({
        target: path.resolve(options.target),
        packId: options.pack,
        revision: options.revision,
        platform: options.platform,
        dryRun: options.dryRun
      });
      printRevisionChange("rollback", result);
      return 0;
    }

    if (command === "verify-archive") {
      if (!options.archive) throw new Error("verify-archive requires --archive.");
      const result = verifyPackArchive({ archiveBytes: await readFile(path.resolve(options.archive)), ...(await readArchiveTrust(options)) });
      console.log(`Verified ${result.manifest.pack.id} r${result.manifest.pack.revision} with key ${result.archive.signature.keyId}: ${result.files.length} assets.`);
      return 0;
    }

    if (command === "install") {
      if (!options.archive || !options.target) throw new Error("install requires --archive and --target.");
      const result = await installPackArchive({
        archive: path.resolve(options.archive),
        ...archiveTrustPaths(options),
        target: path.resolve(options.target),
        budgetKb: options.budgetKb,
        platform: options.platform,
        force: options.force,
        dryRun: options.dryRun
      });
      printExport(result);
      console.log(`Verified archive: ${result.archive.sha256} (${result.archive.keyId})`);
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseOptions(argumentsList) {
  const options = { positionals: [], source: undefined, target: undefined, pack: undefined, revision: undefined, platform: undefined, style: undefined, archive: undefined, publicKey: undefined, trustedKeys: undefined, budgetKb: undefined, format: "text", plan: undefined, approval: undefined, preview: undefined, confirm: undefined, record: undefined, select: undefined, output: undefined, patch: undefined, scopes: undefined, cache: false, setup: false, apply: false, yes: false, force: false, dryRun: false };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--source" || argument === "--target" || argument === "--pack" || argument === "--revision" || argument === "--platform" || argument === "--style" || argument === "--archive" || argument === "--public-key" || argument === "--trusted-keys" || argument === "--budget-kb" || argument === "--plan" || argument === "--approval" || argument === "--preview" || argument === "--confirm" || argument === "--record" || argument === "--select" || argument === "--output" || argument === "--patch" || argument === "--scope") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        return { error: `${argument} requires a value.` };
      }
      index += 1;
      if (argument === "--source") options.source = value;
      if (argument === "--target") options.target = value;
      if (argument === "--plan") options.plan = value;
      if (argument === "--approval") options.approval = value;
      if (argument === "--preview") options.preview = value;
      if (argument === "--confirm") options.confirm = value;
      if (argument === "--record") options.record = value;
      if (argument === "--select") options.select = value;
      if (argument === "--output") options.output = value;
      if (argument === "--patch") options.patch = value;
      if (argument === "--style") {
        if (!SOUND_DIRECTIONS.includes(value)) return { error: `--style must be one of: ${SOUND_DIRECTIONS.join(", ")}.` };
        options.style = value;
      }
      if (argument === "--scope") options.scopes = value.split(",").map((scope) => scope.trim()).filter(Boolean);
      if (argument === "--pack") options.pack = value;
      if (argument === "--archive") options.archive = value;
      if (argument === "--public-key") options.publicKey = value;
      if (argument === "--trusted-keys") options.trustedKeys = value;
      if (argument === "--platform") {
        if (value !== "web" && value !== "react-native") return { error: "--platform must be web or react-native." };
        options.platform = value;
      }
      if (argument === "--revision") {
        const revision = Number(value);
        if (!Number.isInteger(revision) || revision < 1) return { error: "--revision must be a positive integer." };
        options.revision = revision;
      }
      if (argument === "--budget-kb") {
        const budgetKb = Number(value);
        if (!Number.isFinite(budgetKb) || budgetKb <= 0) {
          return { error: "--budget-kb must be a positive number." };
        }
        options.budgetKb = budgetKb;
      }
      continue;
    }

    if (argument === "--force") {
      options.force = true;
      continue;
    }

    if (argument === "--cache") {
      options.cache = true;
      continue;
    }

    if (argument === "--setup") {
      options.setup = true;
      continue;
    }

    if (argument === "--apply") {
      options.apply = true;
      continue;
    }

    if (argument === "--yes") {
      options.yes = true;
      continue;
    }

    if (argument === "--format") {
      const value = argumentsList[index + 1];
      if (value !== "text" && value !== "json") return { error: "--format must be text or json." };
      options.format = value;
      index += 1;
      continue;
    }

    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (argument.startsWith("--")) {
      return { error: `Unknown option: ${argument}` };
    }

    options.positionals.push(argument);
  }

  return options;
}

/** @param {{ publicKey?: string, trustedKeys?: string }} options */
function archiveTrustPaths(options) {
  if (options.publicKey && options.trustedKeys) throw new Error("Provide either --public-key or --trusted-keys, not both.");
  if (options.publicKey) return { publicKey: path.resolve(options.publicKey) };
  if (options.trustedKeys) return { trustedKeys: path.resolve(options.trustedKeys) };
  throw new Error("A signed archive operation requires --public-key or --trusted-keys.");
}

/** @param {{ publicKey?: string, trustedKeys?: string }} options */
async function readArchiveTrust(options) {
  const paths = archiveTrustPaths(options);
  if (paths.publicKey) return { publicKeyPem: await readFile(paths.publicKey) };
  try {
    return { trustedKeys: JSON.parse(await readFile(paths.trustedKeys, "utf8")) };
  } catch {
    throw new Error("Trusted key registry must be valid JSON.");
  }
}

function printValidationReport(report) {
  if (!report.valid) {
    console.error(`Invalid pack: ${report.manifestPath}`);
    for (const error of report.errors) console.error(`- ${error}`);
    return;
  }

  console.log(`Valid pack: ${report.manifest.pack.id} r${report.manifest.pack.revision}`);
  console.log(`${report.eventCount} events, ${report.assetCount} assets, ${formatBytes(report.totalBytes)} / ${report.budgetKb} KB`);
}

function printInspection(report) {
  if (!report.valid) {
    printValidationReport(report);
    return;
  }

  console.log(`Pack: ${report.manifest.pack.id} r${report.manifest.pack.revision}`);
  console.log(`Budget: ${formatBytes(report.totalBytes)} / ${report.budgetKb} KB (${report.budgetUsagePercent.toFixed(1)}%)`);
  for (const event of report.events) {
    console.log(`- ${event.name}: ${event.format.toUpperCase()}, ${event.durationMs} ms, ${formatBytes(event.bytes)}`);
  }
}

function printExport(result) {
  console.log(`${result.dryRun ? "Planned export" : "Exported"} Wubble local audio to ${result.target}`);
  console.log(`Delivery set: ${formatDirection(result.packId)} direction, revision ${result.revision}.`);
  for (const file of result.planned) console.log(`> ${file}`);
  if (result.dryRun) return;
  for (const file of result.written) console.log(`+ ${file}`);
  for (const file of result.unchanged) console.log(`= ${file}`);
  console.log(result.platform === "react-native"
    ? "Install @wubbleai/react-native in the target app, then import src/lib/wubble-ui-sounds.native.js."
    : "Import @wubbleai/ui-sounds in the target app, then import src/lib/wubble-ui-sounds.js.");
}

/** @param {{ approved: Array<any>, rejected: Array<any>, output: string, dryRun: boolean }} result */
function printApproval(result) {
  console.log(`${result.dryRun ? "Planned" : "Recorded"} approval for ${result.approved.length} recommendations; ${result.rejected.length} rejected.`);
  for (const candidate of result.approved) console.log(`+ ${candidate.id}: ${candidate.label} (${candidate.events.join(" -> ")})`);
  if (result.dryRun) {
    console.log(`Would write ${result.output}`);
  } else {
    console.log(`Saved approval record: ${result.output}`);
  }
  console.log("Application source files were not changed.");
}

/** @param {{ preview: { generatedEdits: Array<any>, manualReview: Array<any> }, output: string, sha256: string, dryRun: boolean }} result */
function printPatchPreview(result) {
  const generatedFiles = new Set(result.preview.generatedEdits.map((edit) => edit.file));
  const safeHandlers = countSafeHandlers(result.preview.generatedEdits);
  console.log(`${result.dryRun ? "Planned" : "Saved"} patch preview: ${safeHandlers} safe handler patch${safeHandlers === 1 ? "" : "es"} across ${generatedFiles.size} file${generatedFiles.size === 1 ? "" : "s"}; ${result.preview.manualReview.length} require manual review.`);
  for (const edit of result.preview.generatedEdits) {
    console.log(`\n${edit.location}`);
    for (const change of edit.edits) {
      for (const line of change.original.split("\n")) if (line) console.log(`- ${line}`);
      for (const line of change.replacement.split("\n")) if (line) console.log(`+ ${line}`);
    }
  }
  for (const candidate of result.preview.manualReview) console.log(`! ${candidate.candidateId}: ${candidate.reason}`);
  console.log(result.dryRun ? `Would write ${result.output}` : `Saved patch preview: ${result.output}`);
  console.log(`Review confirmation SHA-256: ${result.sha256}`);
  console.log("Application source files were not changed.");
}

/** @param {{ application: { files: Array<any>, snapshotDirectory: string }, dryRun: boolean }} result */
function printPatchApplication(result) {
  console.log(`${result.dryRun ? "Planned" : "Applied"} ${result.application.files.length} reviewed source patch${result.application.files.length === 1 ? "" : "es"}.`);
  for (const file of result.application.files) console.log(`${result.dryRun ? ">" : "+"} ${file.file}`);
  console.log(`Rollback snapshot: ${result.application.snapshotDirectory}`);
  console.log(result.dryRun ? "Application source files were not changed." : "A local rollback record was written before source files changed.");
}

/** @param {{ files: string[], dryRun: boolean }} result */
function printFeedbackRollback(result) {
  console.log(`${result.dryRun ? "Planned rollback" : "Rolled back"} ${result.files.length} UI sounds source patch${result.files.length === 1 ? "" : "es"}.`);
  for (const file of result.files) console.log(`${result.dryRun ? ">" : "-"} ${file}`);
}

/** @param {{ report: any, selected: Array<any>, auditPath: string, planPath: string, setup: any, preview?: any, patchPath?: string, application?: any, dryRun: boolean }} result */
function printAdd(result) {
  console.log("Wubble UI Sounds: local scan complete");
  console.log(`Scanned ${result.report.scannedFiles} source file${result.report.scannedFiles === 1 ? "" : "s"}${result.report.framework ? ` (${result.report.framework})` : ""}. Found ${result.report.summary.recommended} feedback moment${result.report.summary.recommended === 1 ? "" : "s"}; ${result.selected.length} sound recommendation${result.selected.length === 1 ? "" : "s"} selected.`);
  for (const candidate of result.selected) {
    console.log(`+ ${candidate.group}: ${candidate.label} at ${candidate.location}`);
    if (candidate.context) console.log(`  ${candidate.context}`);
    console.log(`  Why: ${candidate.reason}`);
    if (candidate.implementation?.reason) console.log(`  Implementation: ${candidate.implementation.reason}`);
  }
  for (const candidate of result.report.candidates.filter((candidate) => candidate.recommendation.mode !== "sound")) {
    console.log(`- ${candidate.group}: ${candidate.label} -> ${candidate.recommendation.mode}`);
    console.log(`  ${candidate.recommendation.reason}`);
  }
  if (result.selected.length === 0) {
    console.log(`${result.dryRun ? "Would save" : "Saved"} sound plan: ${result.planPath}`);
    console.log("No sound changes selected. Application source files were not changed.");
    return;
  }
  console.log(`${result.dryRun ? "Would save" : "Saved"} audit: ${result.auditPath}`);
  console.log(`${result.dryRun ? "Would save" : "Saved"} sound plan: ${result.planPath}`);
  if (result.setup.state === "exported") console.log("Exported compact local audio so the reviewed patch has files to import.");
  if (result.setup.state === "missing") console.log("No local pack is exported yet. The review artifacts are ready; re-run with --setup before applying this patch.");
  const safeHandlers = countSafeHandlers(result.preview.preview.generatedEdits);
  const generatedFiles = new Set(result.preview.preview.generatedEdits.map((edit) => edit.file));
  console.log(`${safeHandlers} safe handler patch${safeHandlers === 1 ? "" : "es"} across ${generatedFiles.size} file${generatedFiles.size === 1 ? "" : "s"}; ${result.preview.preview.manualReview.length} need manual review.`);
  for (const edit of result.preview.preview.generatedEdits) {
    console.log(`\n${edit.location}`);
    for (const change of edit.edits) {
      for (const line of change.original.split("\n")) if (line) console.log(`- ${line}`);
      for (const line of change.replacement.split("\n")) if (line) console.log(`+ ${line}`);
    }
  }
  for (const candidate of result.preview.preview.manualReview) console.log(`! ${candidate.candidateId}: ${candidate.reason}`);
  if (result.patchPath) console.log(`PR-ready patch: ${result.patchPath}`);
  if (!result.dryRun) console.log(`Review confirmation SHA-256: ${result.preview.sha256}`);
  if (result.application) console.log(`${result.dryRun ? "Would apply" : "Applied"} reviewed source changes.`);
  else console.log("Next: review the patch. Source files stay unchanged until you re-run with --apply in an interactive terminal.");
}

/** @param {Array<any>} generatedEdits */
function countSafeHandlers(generatedEdits) {
  const candidateIds = new Set();
  for (const fileEdit of generatedEdits) {
    for (const edit of fileEdit.edits ?? []) {
      if (edit.purpose?.startsWith("Play processing")) {
        for (const candidateId of edit.candidateIds ?? []) candidateIds.add(candidateId);
      }
    }
  }
  return candidateIds.size;
}

function commandHelp(topic) {
  if (topic === "start") return `wubble-ui-sounds start [app-directory]\n\nThe recommended first run. It scans only local source files, groups meaningful moments by app flow, asks what to keep, exports compact local audio, and writes a standard review patch. It never uploads source code and never changes application files until the developer explicitly re-runs with --apply.\n\nExamples:\n  wubble-ui-sounds start\n  wubble-ui-sounds start . --scope src/app,src/features --cache\n  wubble-ui-sounds start . --style minimal\n  wubble-ui-sounds start . --select all --patch review/wubble-ui-sounds.patch\n\nRun wubble-ui-sounds directions to browse the included directions. Use --apply only after reviewing the generated patch. It refuses to apply when the reviewed source has changed. Use --force only to replace an earlier local review artifact.`;
  if (topic === "add") return `wubble-ui-sounds add [app-directory]\n\nThe configurable form of the guided workflow. It scans only local source files, groups meaningful moments by app flow, and asks what to keep. Unlike start, add exports local audio only when --setup is passed or accepted interactively. It never sends code anywhere and does not change application source by default.\n\nExamples:\n  wubble-ui-sounds add\n  wubble-ui-sounds add . --scope src/app,src/features --cache --setup\n  wubble-ui-sounds add . --select all --patch review/wubble-ui-sounds.patch\n\nUse --apply only after reviewing the generated patch. It refuses to apply when the reviewed source has changed. Use --force only to replace an earlier local review artifact.`;
  if (topic === "audit") return `wubble-ui-sounds audit [app-directory]\n\nRead-only structural scan. Use --scope for selected folders and --cache to reuse unchanged local analysis results.`;
  return `No dedicated help for ${topic}. Run wubble-ui-sounds --help for every command.`;
}

function resolveIncludedSource(style) {
  if (!style) return path.dirname(require.resolve("@wubbleai/core-pack/manifest"));
  return path.join(path.dirname(require.resolve("@wubbleai/community-sfx")), `${style}.manifest.json`);
}

function formatDirection(packId) {
  if (packId.startsWith("wubble-community-")) return packId.slice("wubble-community-".length);
  return "default";
}

function printDirections() {
  console.log("Included Wubble sound directions:");
  console.log(`- ${SOUND_DIRECTIONS.join(", ")}`);
  console.log("\nThe default direction is used when --style is omitted.");
  console.log("Choose deliberately; Wubble scans where feedback belongs, not a brand's sound identity.");
  console.log("\nExample:\n  wubble-ui-sounds start . --style minimal");
}

function printRevisionChange(action, result) {
  const verb = action === "upgrade" ? "Upgraded" : "Rolled back";
  const plannedVerb = action === "upgrade" ? "Planned upgrade" : "Planned rollback";
  console.log(`${result.dryRun ? plannedVerb : verb} ${result.packId} r${result.previousRevision} -> r${result.revision} in ${result.target}`);
  for (const file of result.planned) console.log(`> ${file}`);
  if (result.dryRun) return;
  console.log(`Snapshot: ${result.snapshotDirectory}`);
  for (const file of result.written) console.log(`+ ${file}`);
  for (const file of result.deleted) console.log(`- ${file}`);
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)} KB`;
}

process.exitCode = await main(process.argv.slice(2));
