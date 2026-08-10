import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Applies a reviewed patch preview after checking every source hash and range.
 * @param {{ preview: string, confirm: string, output?: string, dryRun?: boolean }} options
 */
export async function applyPatchPreview(options) {
  const previewPath = path.resolve(options.preview);
  const previewBytes = await readFile(previewPath, "utf8");
  const previewSha256 = hashText(previewBytes);
  if (options.confirm !== previewSha256) {
    throw new Error("Apply requires --confirm with the exact SHA-256 printed by preview-apply. Review the preview again before changing source files.");
  }
  const preview = readPreview(previewBytes);
  const root = path.resolve(preview.approval.root);
  const output = path.resolve(options.output ?? path.join(root, ".wubble-ui-sounds", "applied-patch.json"));
  const snapshotDirectory = path.join(root, ".wubble-ui-sounds", "source-snapshots", previewSha256);
  const plans = await validateApplicationPlan({ root, preview });

  if (await fileExists(output)) {
    throw new Error(`Application record already exists: ${output}. Roll it back before applying another preview.`);
  }
  if (await fileExists(snapshotDirectory)) {
    throw new Error(`Source snapshot already exists: ${snapshotDirectory}. Refusing to replace an existing recovery point.`);
  }

  const application = {
    schemaVersion: 1,
    kind: "wubble-ui-sounds-patch-application",
    state: "prepared",
    preview: { source: previewPath, sha256: previewSha256 },
    root,
    snapshotDirectory,
    files: plans.map((plan, index) => ({
      file: plan.file,
      snapshot: path.join(snapshotDirectory, `source-${index + 1}.original`),
      beforeSha256: hashText(plan.before),
      afterSha256: hashText(plan.after)
    }))
  };

  if (options.dryRun) return { application, dryRun: true };

  await mkdir(snapshotDirectory, { recursive: true });
  for (const [index, plan] of plans.entries()) {
    await writeFile(application.files[index].snapshot, plan.before, "utf8");
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(application, null, 2)}\n`, "utf8");

  const written = [];
  try {
    for (const plan of plans) {
      await writeAtomic(plan.file, plan.after);
      written.push(plan);
    }
  } catch (error) {
    for (const plan of written.reverse()) await writeAtomic(plan.file, plan.before);
    application.state = "restored-after-failed-apply";
    application.failure = error instanceof Error ? error.message : String(error);
    await writeFile(output, `${JSON.stringify(application, null, 2)}\n`, "utf8");
    throw new Error(`Source apply failed and completed writes were restored: ${application.failure}`);
  }

  application.state = "applied";
  application.appliedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(application, null, 2)}\n`, "utf8");
  return { application, dryRun: false };
}

/**
 * Restores the exact source snapshots produced by applyPatchPreview.
 * @param {{ record: string, dryRun?: boolean }} options
 */
export async function rollbackFeedbackPatch(options) {
  const recordPath = path.resolve(options.record);
  const application = readApplication(await readFile(recordPath, "utf8"));
  if (application.state !== "applied") throw new Error(`Rollback requires an applied patch record, received state: ${application.state}.`);
  const plans = [];

  for (const entry of application.files) {
    const file = requireInsideRoot(application.root, entry.file);
    const [before, current] = await Promise.all([readFile(entry.snapshot, "utf8"), readFile(file, "utf8")]);
    if (hashText(before) !== entry.beforeSha256) throw new Error(`Snapshot no longer matches its recorded hash: ${entry.snapshot}.`);
    if (hashText(current) !== entry.afterSha256) throw new Error(`Refusing rollback because the applied source changed: ${file}.`);
    plans.push({ file, before, after: current });
  }

  if (options.dryRun) return { application, dryRun: true, files: plans.map((plan) => plan.file) };

  const restored = [];
  try {
    for (const plan of plans) {
      await writeAtomic(plan.file, plan.before);
      restored.push(plan);
    }
  } catch (error) {
    for (const plan of restored.reverse()) await writeAtomic(plan.file, plan.after);
    throw new Error(`Source rollback failed and completed restores were reversed: ${error instanceof Error ? error.message : String(error)}`);
  }

  application.state = "rolled-back";
  application.rolledBackAt = new Date().toISOString();
  await writeFile(recordPath, `${JSON.stringify(application, null, 2)}\n`, "utf8");
  return { application, dryRun: false, files: plans.map((plan) => plan.file) };
}

/** @param {{ root: string, preview: any }} options */
async function validateApplicationPlan({ root, preview }) {
  if (!Array.isArray(preview.generatedEdits) || preview.generatedEdits.length === 0) {
    throw new Error("Patch preview contains no generated edits to apply.");
  }
  const integration = path.join(root, "src", "lib", "wubble-ui-sounds.js");
  if (!await fileExists(integration)) {
    throw new Error(`Local feedback integration is missing: ${integration}. Export a Wubble pack before applying this preview.`);
  }
  const plans = [];
  for (const entry of preview.generatedEdits) {
    const file = requireInsideRoot(root, entry.file);
    const before = await readFile(file, "utf8");
    if (hashText(before) !== entry.sourceSha256) {
      throw new Error(`Refusing to apply because source changed since preview: ${file}. Generate a new preview after reviewing the change.`);
    }
    if (!Array.isArray(entry.edits) || entry.edits.length === 0) throw new Error(`Preview contains no edits for ${file}.`);
    const after = applyEdits(before, entry.edits, file);
    plans.push({ file, before, after });
  }
  return plans;
}

/** @param {string} source @param {Array<any>} edits @param {string} file */
function applyEdits(source, edits, file) {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let nearestStart = Number.POSITIVE_INFINITY;
  let result = source;
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new Error(`Preview contains an invalid edit range for ${file}.`);
    }
    if (edit.end > nearestStart) throw new Error(`Preview contains overlapping edits for ${file}.`);
    const original = source.slice(edit.start, edit.end);
    if (typeof edit.original !== "string" || original !== edit.original || hashText(original) !== edit.originalSha256 || typeof edit.replacement !== "string") {
      throw new Error(`Preview edit no longer matches its recorded source range: ${file}.`);
    }
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
    nearestStart = edit.start;
  }
  return result;
}

/** @param {string} previewBytes */
function readPreview(previewBytes) {
  let preview;
  try {
    preview = JSON.parse(previewBytes);
  } catch (error) {
    throw new Error(`Unable to read patch preview: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (preview?.schemaVersion !== 1 || preview?.kind !== "wubble-ui-sounds-patch-preview" || typeof preview.approval?.root !== "string") {
    throw new Error("Apply requires a Wubble patch preview record.");
  }
  return preview;
}

/** @param {string} recordBytes */
function readApplication(recordBytes) {
  let application;
  try {
    application = JSON.parse(recordBytes);
  } catch (error) {
    throw new Error(`Unable to read application record: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (application?.schemaVersion !== 1 || application?.kind !== "wubble-ui-sounds-patch-application" || typeof application.root !== "string" || !Array.isArray(application.files)) {
    throw new Error("Rollback requires a Wubble patch application record.");
  }
  return application;
}

/** @param {string} root @param {string} file */
function requireInsideRoot(root, file) {
  if (typeof file !== "string") throw new Error("Patch record contains an invalid file path.");
  const resolved = path.resolve(file);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Patch record points outside the audited project: ${file}.`);
  }
  return resolved;
}

/** @param {string} file @param {string} contents */
async function writeAtomic(file, contents) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.wubble-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

/** @param {string} value */
function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
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
