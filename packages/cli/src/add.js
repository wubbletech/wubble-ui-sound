import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { approveAuditPlan } from "./approval.js";
import { auditProject } from "./audit.js";
import { applyPatchPreview } from "./patch-apply.js";
import { createPatchPreview } from "./patch-preview.js";
import { createPatchText } from "./patch-diff.js";
import { exportPack } from "./pack.js";
import { formatSoundPlan, groupRecommendations } from "./sound-plan.js";

const require = createRequire(import.meta.url);

/**
 * Guides a developer from a local scan to reviewed, optional source changes.
 * @param {{ target: string, scopes?: string[], cache?: boolean, select?: string, setup?: boolean, patch?: string, platform?: "web" | "react-native", apply?: boolean, yes?: boolean, force?: boolean, dryRun?: boolean }} options
 */
export async function addUiSounds(options) {
  const root = path.resolve(options.target);
  const report = await auditProject(root, { scopes: options.scopes, cache: options.cache });
  const candidates = report.candidates.filter((candidate) => candidate.recommendation.mode === "sound");
  const outputDirectory = path.join(root, ".wubble-ui-sounds");
  const auditPath = path.join(outputDirectory, "latest-audit.json");
  const planPath = path.join(outputDirectory, "sound-plan.md");

  const selected = await selectCandidates(candidates, options);
  if (!options.dryRun) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(auditPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(planPath, `${formatSoundPlan(report, selected)}\n`, "utf8");
  }

  if (selected.length === 0) {
    return { report, selected, auditPath, planPath, setup: { state: "not-needed" }, approval: undefined, preview: undefined, patchPath: undefined, application: undefined, dryRun: Boolean(options.dryRun) };
  }
  if (options.dryRun) {
    return { report, selected, auditPath, planPath, setup: { state: "planned" }, approval: undefined, preview: { preview: { generatedEdits: [], manualReview: [] } }, patchPath: undefined, application: undefined, dryRun: true };
  }

  const setup = await ensureLocalSetup(root, options);
  if (options.apply && setup.state === "missing") {
    throw new Error("No local Wubble pack is exported in this app. Re-run add with --setup, or run wubble-ui-sounds setup before applying source changes.");
  }

  const approval = await approveAuditPlan({
    plan: auditPath,
    select: selected.map((candidate) => candidate.id).join(","),
    force: options.force,
    dryRun: false
  });
  const preview = await createPatchPreview({ approval: approval.output, force: options.force, dryRun: false });
  const patchPath = preview.preview.generatedEdits.length > 0
    ? await writeReviewPatch(root, preview.preview, options)
    : undefined;
  let application;
  if (options.apply && preview.preview.generatedEdits.length > 0) {
    const shouldApply = options.yes || await confirmApply();
    if (shouldApply) {
      application = await applyPatchPreview({ preview: preview.output, confirm: preview.sha256, dryRun: options.dryRun });
    }
  }
  return { report, selected, auditPath, planPath, setup, approval, preview, patchPath, application, dryRun: Boolean(options.dryRun) };
}

/** @param {Array<any>} candidates @param {{ select?: string, yes?: boolean }} options */
async function selectCandidates(candidates, options) {
  if (options.select) {
    if (options.select === "all") return candidates;
    if (options.select === "none") return [];
    const requested = new Set(options.select.split(",").map((value) => value.trim()).filter(Boolean));
    const available = new Set(candidates.map((candidate) => candidate.id));
    const unknown = [...requested].filter((id) => !available.has(id));
    if (unknown.length > 0) throw new Error(`The sound recommendations do not contain: ${unknown.join(", ")}.`);
    return candidates.filter((candidate) => requested.has(candidate.id));
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("wubble-ui-sounds add needs an interactive terminal. Use --select all, --select none, or explicit candidate ids in automation.");
  }
  if (options.yes) return candidates;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const selected = [];
    for (const group of groupRecommendations(candidates)) {
      console.log(`\n${group.label}`);
      for (const candidate of group.candidates) {
        console.log(`  ${candidate.label} - ${candidate.events.join(" -> ")} [${candidate.implementation?.mode === "safe-patch-candidate" ? "safe patch candidate" : "manual review"}]`);
        console.log(`  ${candidate.location}${candidate.context ? `\n  ${candidate.context}` : ""}`);
        console.log(`  Why: ${candidate.reason}`);
        if (candidate.implementation?.reason) console.log(`  Implementation: ${candidate.implementation.reason}`);
      }
      const answer = (await terminal.question(`  Add all ${group.candidates.length} recommendation${group.candidates.length === 1 ? "" : "s"} in this flow? [y/N/r] `)).trim();
      if (/^y(?:es)?$/i.test(answer)) {
        selected.push(...group.candidates);
        continue;
      }
      if (!/^r(?:eview)?$/i.test(answer)) continue;
      for (const candidate of group.candidates) {
        const candidateAnswer = await terminal.question(`  Add ${candidate.label}? [y/N] `);
        if (/^y(?:es)?$/i.test(candidateAnswer.trim())) selected.push(candidate);
      }
    }
    return selected;
  } finally {
    terminal.close();
  }
}

/** @param {string} root @param {any} options */
async function ensureLocalSetup(root, options) {
  const integration = path.join(root, "src", "lib", "wubble-ui-sounds.js");
  if (await fileExists(integration)) return { state: "ready", integration };

  let shouldSetup = Boolean(options.setup);
  if (!shouldSetup && process.stdin.isTTY && process.stdout.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await terminal.question("\nNo local Wubble pack is exported yet. Export Wubble Core now? [Y/n] ");
      shouldSetup = !/^n(?:o)?$/i.test(answer.trim());
    } finally {
      terminal.close();
    }
  }
  if (!shouldSetup) return { state: "missing", integration };

  const coreManifest = require.resolve("@wubble/core-pack/manifest");
  const result = await exportPack({
    source: path.dirname(coreManifest),
    target: root,
    platform: options.platform,
    force: options.force,
    dryRun: false
  });
  return { state: "exported", integration, packId: result.packId, revision: result.revision };
}

/** @param {string} root @param {any} preview @param {{ patch?: string, force?: boolean }} options */
async function writeReviewPatch(root, preview, options) {
  const patchPath = options.patch
    ? path.resolve(root, options.patch)
    : path.join(root, ".wubble-ui-sounds", "recommended.patch");
  if (await fileExists(patchPath) && !options.force) {
    throw new Error(`Review patch already exists: ${patchPath}. Review it or re-run with --force to replace it.`);
  }
  await mkdir(path.dirname(patchPath), { recursive: true });
  await writeFile(patchPath, await createPatchText(preview), "utf8");
  return patchPath;
}

/** @param {string} file */
async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function confirmApply() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question("\nApply the reviewed safe patches now? [y/N] ");
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}
