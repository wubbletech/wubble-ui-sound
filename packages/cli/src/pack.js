import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertValidManifest, validateManifest } from "@wubble/manifest";
import { verifyPackArchive } from "./archive.js";

const DEFAULT_BUDGET_KB = 120;

/**
 * Validates all local files referenced by a Wubble manifest.
 * @param {string} manifestPath
 * @param {number | undefined} budgetKb
 */
export async function validatePack(manifestPath, budgetKb) {
  const errors = [];
  const manifest = await readManifest(manifestPath, errors);
  if (!manifest) return invalidReport(manifestPath, errors, budgetKb ?? DEFAULT_BUDGET_KB);

  const manifestValidation = validateManifest(manifest);
  errors.push(...manifestValidation.errors);
  const effectiveBudgetKb = budgetKb ?? manifest.pack.budgetKb ?? DEFAULT_BUDGET_KB;
  if (errors.length > 0) return invalidReport(manifestPath, errors, effectiveBudgetKb, manifest);

  const sourceDirectory = path.dirname(manifestPath);
  const events = [];
  for (const [name, asset] of Object.entries(manifest.events)) {
    for (const entry of enumerateEventAssets(name, asset)) {
      const record = await inspectLocalAsset(sourceDirectory, entry.asset, entry.label, errors);
      if (record) {
        events.push({ name, eventName: name, variantIndex: entry.variantIndex, sourceIndex: entry.sourceIndex, ...record });
      }
    }
  }

  const totalBytes = events.reduce((total, event) => total + event.bytes, 0);
  if (totalBytes > effectiveBudgetKb * 1024) {
    errors.push(`Pack is ${totalBytes} bytes and exceeds the ${effectiveBudgetKb} KB budget.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    manifestPath,
    manifest,
    events,
    eventCount: Object.keys(manifest.events).length,
    assetCount: events.length,
    totalBytes,
    budgetKb: effectiveBudgetKb,
    budgetUsagePercent: (totalBytes / (effectiveBudgetKb * 1024)) * 100
  };
}

/**
 * @param {string} manifestPath
 * @param {number | undefined} budgetKb
 */
export async function inspectPack(manifestPath, budgetKb) {
  return validatePack(manifestPath, budgetKb);
}

/**
 * Verifies and installs a signed local release artifact through the regular protected exporter.
 * @param {{ archive: string, target: string, publicKey?: string, trustedKeys?: string, budgetKb?: number, force?: boolean, dryRun?: boolean, platform?: "web" | "react-native" }} options
 */
export async function installPackArchive(options) {
  return applyVerifiedArchive(options, "install", (source) => exportPack({
    source,
    target: options.target,
    budgetKb: options.budgetKb,
    force: options.force,
    dryRun: options.dryRun,
    platform: options.platform
  }));
}

/**
 * Verifies a signed local release artifact before applying a protected managed upgrade.
 * @param {{ archive: string, target: string, publicKey?: string, trustedKeys?: string, budgetKb?: number, dryRun?: boolean, platform?: "web" | "react-native" }} options
 */
export async function upgradePackArchive(options) {
  return applyVerifiedArchive(options, "upgrade", (source) => upgradePack({
    source,
    target: options.target,
    budgetKb: options.budgetKb,
    dryRun: options.dryRun,
    platform: options.platform
  }));
}

/** @param {any} options @param {"install" | "upgrade"} operation @param {(source: string) => Promise<any>} apply */
async function applyVerifiedArchive(options, operation, apply) {
  const archiveBytes = await readFile(options.archive);
  const verified = verifyPackArchive({
    archiveBytes,
    ...(await readArchiveTrust(options))
  });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), `wubble-pack-${operation}-`));
  try {
    await materializeVerifiedArchive(temporaryDirectory, verified);
    const result = await apply(temporaryDirectory);
    return { ...result, archive: { keyId: verified.archive.signature.keyId, sha256: createHash("sha256").update(archiveBytes).digest("hex"), trustStatus: verified.trust.status } };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** @param {{ publicKey?: string, trustedKeys?: string }} options */
async function readArchiveTrust(options) {
  if (options.publicKey && options.trustedKeys) throw new Error("Provide either --public-key or --trusted-keys, not both.");
  if (options.publicKey) return { publicKeyPem: await readFile(options.publicKey) };
  if (options.trustedKeys) {
    try {
      return { trustedKeys: JSON.parse(await readFile(options.trustedKeys, "utf8")) };
    } catch {
      throw new Error("Trusted key registry must be valid JSON.");
    }
  }
  throw new Error("A signed archive operation requires --public-key or --trusted-keys.");
}

/** @param {string} temporaryDirectory @param {{ manifest: unknown, files: Array<{ file: string, bytes: Uint8Array }> }} verified */
async function materializeVerifiedArchive(temporaryDirectory, verified) {
  await writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(verified.manifest, null, 2)}\n`, "utf8");
  for (const file of verified.files) {
    const target = path.join(temporaryDirectory, file.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

/**
 * Exports a validated local pack into a customer project without silent overwrite.
 * @param {{ source: string, target: string, budgetKb?: number, force?: boolean, dryRun?: boolean, platform?: "web" | "react-native" }} options
 */
export async function exportPack(options) {
  const manifestPath = await resolveManifestPath(options.source);
  const report = await validatePack(manifestPath, options.budgetKb);
  if (!report.valid) {
    throw new Error(`Cannot export an invalid pack:\n${report.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const manifest = assertValidManifest(report.manifest);
  assertSafePackId(manifest.pack.id);
  const platform = normalizePlatform(options.platform);
  const exportedManifest = createExportManifest(manifest);
  const writes = createPackWrites(options.target, report, exportedManifest, platform);

  const conflicts = [];
  const unchanged = [];
  const planned = [];
  for (const write of writes) {
    const state = await classifyWrite(write);
    planned.push(write.target);
    if (state === "conflict") conflicts.push(write.target);
    if (state === "unchanged") unchanged.push(write.target);
  }

  if (conflicts.length > 0 && !options.force) {
    throw new Error(`Export would overwrite changed files. Re-run with --force only after review:\n${conflicts.map((file) => `- ${file}`).join("\n")}`);
  }

  if (options.dryRun) {
    return {
      packId: manifest.pack.id,
      revision: manifest.pack.revision,
      target: options.target,
      platform,
      dryRun: true,
      planned,
      written: [],
      unchanged
    };
  }

  const written = [];
  for (const write of writes) {
    const state = await classifyWrite(write);
    if (state === "unchanged") continue;
    await mkdir(path.dirname(write.target), { recursive: true });
    if (write.source) {
      await copyFile(write.source, write.target);
    } else {
      await writeFile(write.target, write.contents, "utf8");
    }
    written.push(write.target);
  }

  await writeInstallState(options.target, await createInstallState(options.target, exportedManifest, writes, platform));

  return {
    packId: manifest.pack.id,
    revision: manifest.pack.revision,
    target: options.target,
    platform,
    dryRun: false,
    planned,
    written,
    unchanged
  };
}

/**
 * Updates an existing Wubble export after confirming that none of the managed
 * files were changed by the customer. A snapshot is written before any file changes.
 * @param {{ source: string, target: string, budgetKb?: number, dryRun?: boolean, platform?: "web" | "react-native" }} options
 */
export async function upgradePack(options) {
  const manifestPath = await resolveManifestPath(options.source);
  const report = await validatePack(manifestPath, options.budgetKb);
  if (!report.valid) {
    throw new Error(`Cannot upgrade to an invalid pack:\n${report.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const manifest = assertValidManifest(report.manifest);
  assertSafePackId(manifest.pack.id);
  const platform = normalizePlatform(options.platform);
  const state = await readInstallState(options.target, manifest.pack.id, platform);
  if (!state) {
    throw new Error(`No managed install record exists for ${manifest.pack.id}. Export this pack with the current CLI before using upgrade.`);
  }
  if (state.revision >= manifest.pack.revision) {
    throw new Error(`Upgrade requires a newer revision than r${state.revision}; received r${manifest.pack.revision}.`);
  }

  const changed = await findChangedManagedFiles(options.target, state);
  if (changed.length > 0) {
    throw new Error(`Upgrade stopped because managed files were changed or removed:\n${changed.map((file) => `- ${file}`).join("\n")}`);
  }

  const exportedManifest = createExportManifest(manifest);
  const writes = createPackWrites(options.target, report, exportedManifest, platform);
  const nextState = await createInstallState(options.target, exportedManifest, writes, platform);
  const deletions = Object.keys(state.files).filter((file) => !(file in nextState.files));
  const planned = [...writes.map((write) => write.target), ...deletions.map((file) => path.join(options.target, file))];
  const snapshotDirectory = getSnapshotDirectory(options.target, manifest.pack.id, state.revision, platform);

  if (options.dryRun) {
    return {
      packId: manifest.pack.id,
      previousRevision: state.revision,
      revision: manifest.pack.revision,
      target: options.target,
      platform,
      dryRun: true,
      planned,
      written: [],
      deleted: [],
      snapshotDirectory
    };
  }

  await createSnapshot(options.target, state);
  const written = await applyWrites(writes);
  const deleted = await removeManagedFiles(options.target, deletions);
  await writeInstallState(options.target, nextState);

  return {
    packId: manifest.pack.id,
    previousRevision: state.revision,
    revision: manifest.pack.revision,
    target: options.target,
    platform,
    dryRun: false,
    planned,
    written,
    deleted,
    snapshotDirectory
  };
}

/**
 * Restores a previously snapshotted pack revision after checking the current managed files.
 * @param {{ target: string, packId: string, revision: number, dryRun?: boolean, platform?: "web" | "react-native" }} options
 */
export async function rollbackPack(options) {
  assertSafePackId(options.packId);
  const platform = normalizePlatform(options.platform);
  const state = await readInstallState(options.target, options.packId, platform);
  if (!state) throw new Error(`No managed install record exists for ${options.packId}.`);
  if (state.revision === options.revision) throw new Error(`${options.packId} is already at r${options.revision}.`);

  const changed = await findChangedManagedFiles(options.target, state);
  if (changed.length > 0) {
    throw new Error(`Rollback stopped because managed files were changed or removed:\n${changed.map((file) => `- ${file}`).join("\n")}`);
  }

  const snapshotDirectory = getSnapshotDirectory(options.target, options.packId, options.revision, platform);
  const snapshotState = await readSnapshotState(snapshotDirectory);
  if (snapshotState.packId !== options.packId || snapshotState.revision !== options.revision || snapshotState.platform !== platform) {
    throw new Error(`Snapshot r${options.revision} does not belong to ${options.packId}.`);
  }
  const corrupted = await findChangedManagedFiles(path.join(snapshotDirectory, "files"), snapshotState);
  if (corrupted.length > 0) {
    throw new Error(`Rollback snapshot r${options.revision} is incomplete or changed:\n${corrupted.map((file) => `- ${file}`).join("\n")}`);
  }

  const planned = Object.keys(snapshotState.files).map((file) => path.join(options.target, file));
  const deletions = Object.keys(state.files).filter((file) => !(file in snapshotState.files));
  planned.push(...deletions.map((file) => path.join(options.target, file)));

  if (options.dryRun) {
    return {
      packId: options.packId,
      previousRevision: state.revision,
      revision: options.revision,
      target: options.target,
      platform,
      dryRun: true,
      planned,
      written: [],
      deleted: [],
      snapshotDirectory
    };
  }

  await createSnapshot(options.target, state);
  const written = await restoreSnapshot(options.target, snapshotDirectory, snapshotState);
  const deleted = await removeManagedFiles(options.target, deletions);
  await writeInstallState(options.target, snapshotState);

  return {
    packId: options.packId,
    previousRevision: state.revision,
    revision: options.revision,
    target: options.target,
    platform,
    dryRun: false,
    planned,
    written,
    deleted,
    snapshotDirectory
  };
}

/** @param {string} target @param {Awaited<ReturnType<typeof validatePack>>} report @param {import("@wubble/manifest").FeedbackManifest} exportedManifest @param {"web" | "react-native"} platform */
function createPackWrites(target, report, exportedManifest, platform) {
  if (platform === "react-native") return createNativePackWrites(target, report, exportedManifest);
  const assetDirectory = path.join(target, "public", "wubble", exportedManifest.pack.id);
  return [
    ...report.events.map((event) => ({
      source: event.assetPath,
      target: path.join(assetDirectory, getExportAsset(exportedManifest, event.eventName, event.variantIndex, event.sourceIndex).file)
    })),
    { contents: `${JSON.stringify(exportedManifest, null, 2)}\n`, target: path.join(assetDirectory, "manifest.json") },
    { contents: createIntegrationModule(exportedManifest), target: path.join(target, "src", "lib", "wubble-ui-sounds.js") },
    { contents: createConfig(exportedManifest, report.budgetKb, platform), target: path.join(target, "wubble.ui-sounds.yml") }
  ];
}

/** @param {string} target @param {Awaited<ReturnType<typeof validatePack>>} report @param {import("@wubble/manifest").FeedbackManifest} exportedManifest */
function createNativePackWrites(target, report, exportedManifest) {
  const nativeManifest = createNativeExportManifest(exportedManifest);
  const layout = getExportLayout(target, nativeManifest.pack.id, "react-native");
  const writes = [];
  for (const [eventName, asset] of Object.entries(exportedManifest.events)) {
    for (const selection of enumerateNativeSelections(eventName, asset)) {
      const sourceRecord = report.events.find((event) => event.eventName === eventName && event.variantIndex === selection.variantIndex && event.sourceIndex === selection.sourceIndex);
      if (!sourceRecord) throw new Error(`Missing local asset for React Native ${eventName}.`);
      writes.push({ source: sourceRecord.assetPath, target: path.join(layout.assetDirectory, selection.asset.file) });
    }
  }
  writes.push(
    { contents: `${JSON.stringify(nativeManifest, null, 2)}\n`, target: path.join(layout.assetDirectory, "manifest.json") },
    { contents: createNativeIntegrationModule(nativeManifest, layout.integrationPath, layout.assetDirectory), target: layout.integrationPath },
    { contents: createConfig(nativeManifest, report.budgetKb, "react-native"), target: layout.configPath }
  );
  return writes;
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest */
function createNativeExportManifest(manifest) {
  const native = structuredClone(manifest);
  for (const [eventName, asset] of Object.entries(manifest.events)) {
    native.events[eventName] = selectNativeAsset(asset);
  }
  return native;
}

/** @param {import("@wubble/manifest").FeedbackAsset} asset */
function selectNativeAsset(asset) {
  const { file, durationMs, sha256, sources, variants, ...metadata } = asset;
  const sourceIndex = selectNativeSourceIndex(asset);
  const selected = sourceIndex === null ? asset : sources[sourceIndex];
  return {
    ...metadata,
    file: selected.file,
    durationMs: selected.durationMs,
    sha256: selected.sha256,
    ...(variants?.length ? { variants: variants.map(selectNativeAsset) } : {})
  };
}

/** @param {import("@wubble/manifest").FeedbackAssetVariant} asset */
function selectNativeSourceIndex(asset) {
  const index = (asset.sources ?? []).findIndex((source) => source.mimeType === "audio/mp4; codecs=mp4a.40.2");
  return index === -1 ? null : index;
}

/** @param {string} eventName @param {import("@wubble/manifest").FeedbackAsset} asset */
function enumerateNativeSelections(eventName, asset) {
  const selections = [];
  const add = (item, variantIndex) => {
    const sourceIndex = selectNativeSourceIndex(item);
    const selected = sourceIndex === null ? item : item.sources[sourceIndex];
    selections.push({ eventName, variantIndex, sourceIndex, asset: selected });
  };
  add(asset, null);
  for (const [variantIndex, variant] of (asset.variants ?? []).entries()) add(variant, variantIndex);
  return selections;
}

/** @param {{ source?: string, contents?: string, target: string }[]} writes */
async function applyWrites(writes) {
  const written = [];
  for (const write of writes) {
    const state = await classifyWrite(write);
    if (state === "unchanged") continue;
    await mkdir(path.dirname(write.target), { recursive: true });
    if (write.source) await copyFile(write.source, write.target);
    else await writeFile(write.target, write.contents, "utf8");
    written.push(write.target);
  }
  return written;
}

/** @param {string} target @param {import("@wubble/manifest").FeedbackManifest} manifest @param {{ source?: string, contents?: string, target: string }[]} writes @param {"web" | "react-native"} platform */
async function createInstallState(target, manifest, writes, platform) {
  const files = {};
  for (const write of writes) {
    const relativePath = relativeManagedPath(target, write.target);
    const contents = write.source ? await readFile(write.source) : Buffer.from(write.contents, "utf8");
    files[relativePath] = createHash("sha256").update(contents).digest("hex");
  }
  return { schemaVersion: 1, packId: manifest.pack.id, revision: manifest.pack.revision, platform, files };
}

/** @param {string} target @param {string} packId @param {"web" | "react-native"} platform */
function getInstallStatePath(target, packId, platform) {
  return path.join(getManagedDirectory(target, packId, platform), "state.json");
}

/** @param {string} target @param {string} packId @param {number} revision @param {"web" | "react-native"} platform */
function getSnapshotDirectory(target, packId, revision, platform) {
  return path.join(getManagedDirectory(target, packId, platform), "snapshots", `r${revision}`);
}

/** @param {string} target @param {string} packId @param {"web" | "react-native"} platform */
async function readInstallState(target, packId, platform) {
  const statePath = getInstallStatePath(target, packId, platform);
  try {
    const state = assertInstallState(JSON.parse(await readFile(statePath, "utf8")), statePath);
    if (state.platform !== platform) throw new Error(`Managed install record is for ${state.platform}, not ${platform}.`);
    return state;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw new Error(`Unable to read managed install record: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** @param {string} target @param {{ schemaVersion: number, packId: string, revision: number, platform: "web" | "react-native", files: Record<string, string> }} state */
async function writeInstallState(target, state) {
  const statePath = getInstallStatePath(target, state.packId, state.platform);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** @param {string} target @param {{ files: Record<string, string> }} state */
async function findChangedManagedFiles(target, state) {
  const changed = [];
  for (const [relativePath, expectedHash] of Object.entries(state.files)) {
    try {
      const contents = await readFile(path.join(target, relativePath));
      const actualHash = createHash("sha256").update(contents).digest("hex");
      if (actualHash !== expectedHash) changed.push(relativePath);
    } catch {
      changed.push(relativePath);
    }
  }
  return changed;
}

/** @param {string} target @param {{ packId: string, revision: number, platform: "web" | "react-native", files: Record<string, string> }} state */
async function createSnapshot(target, state) {
  const snapshotDirectory = getSnapshotDirectory(target, state.packId, state.revision, state.platform);
  const existing = await stat(snapshotDirectory).catch(() => null);
  if (existing) {
    const existingState = await readSnapshotState(snapshotDirectory);
    if (existingState.packId !== state.packId || existingState.revision !== state.revision || existingState.platform !== state.platform) {
      throw new Error(`Existing snapshot at ${snapshotDirectory} does not match the managed install.`);
    }
    const corrupted = await findChangedManagedFiles(path.join(snapshotDirectory, "files"), existingState);
    if (corrupted.length > 0) {
      throw new Error(`Existing snapshot at ${snapshotDirectory} is incomplete or changed.`);
    }
    return snapshotDirectory;
  }

  const temporaryDirectory = `${snapshotDirectory}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    for (const relativePath of Object.keys(state.files)) {
      const source = path.join(target, relativePath);
      const destination = path.join(temporaryDirectory, "files", relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    await writeFile(path.join(temporaryDirectory, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await mkdir(path.dirname(snapshotDirectory), { recursive: true });
    await rename(temporaryDirectory, snapshotDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return snapshotDirectory;
}

/** @param {string} snapshotDirectory */
async function readSnapshotState(snapshotDirectory) {
  try {
    return assertInstallState(JSON.parse(await readFile(path.join(snapshotDirectory, "state.json"), "utf8")), snapshotDirectory);
  } catch (error) {
    throw new Error(`Unable to read rollback snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** @param {string} target @param {string} snapshotDirectory @param {{ files: Record<string, string> }} state */
async function restoreSnapshot(target, snapshotDirectory, state) {
  const written = [];
  for (const relativePath of Object.keys(state.files)) {
    const source = path.join(snapshotDirectory, "files", relativePath);
    const destination = path.join(target, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    written.push(destination);
  }
  return written;
}

/** @param {string} target @param {string[]} relativePaths */
async function removeManagedFiles(target, relativePaths) {
  const deleted = [];
  for (const relativePath of relativePaths) {
    const file = path.join(target, relativePath);
    try {
      await rm(file);
      deleted.push(file);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }
  return deleted;
}

/** @param {string} target @param {string} candidate */
function relativeManagedPath(target, candidate) {
  const relativePath = path.relative(target, candidate);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Managed file resolves outside the target: ${candidate}`);
  }
  return relativePath;
}

/** @param {unknown} value @param {string} location */
function assertInstallState(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid install record at ${location}.`);
  if (value.schemaVersion !== 1 || !isSafePackId(value.packId) || !Number.isInteger(value.revision) || value.revision < 1) {
    throw new Error(`Invalid install record at ${location}.`);
  }
  if (value.platform === undefined) value.platform = "web";
  if (value.platform !== "web" && value.platform !== "react-native") throw new Error(`Invalid install record at ${location}.`);
  if (!value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw new Error(`Invalid install record at ${location}.`);
  for (const [relativePath, hash] of Object.entries(value.files)) {
    if (typeof hash !== "string" || !/^[a-f\d]{64}$/i.test(hash) || !isSafeRelativePath(relativePath)) {
      throw new Error(`Invalid install record at ${location}.`);
    }
  }
  return value;
}

/** @param {unknown} packId */
function assertSafePackId(packId) {
  if (!isSafePackId(packId)) throw new Error("pack.id must be a single safe path segment.");
}

/** @param {unknown} packId */
function isSafePackId(packId) {
  return typeof packId === "string" && packId.length > 0 && packId !== "." && packId !== ".." && !packId.includes("/") && !packId.includes("\\");
}

/** @param {string} relativePath */
function isSafeRelativePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`) && !path.isAbsolute(normalized);
}

/** @param {string | undefined} platform */
function normalizePlatform(platform) {
  if (platform === undefined || platform === "web") return "web";
  if (platform === "react-native") return platform;
  throw new Error("platform must be web or react-native.");
}

/** @param {string} target @param {string} packId @param {"web" | "react-native"} platform */
function getManagedDirectory(target, packId, platform) {
  const base = path.join(target, ".wubble-ui-sounds", packId);
  return platform === "web" ? base : path.join(base, platform);
}

/** @param {string} sourceDirectory @param {import("@wubble/manifest").FeedbackAssetVariant} asset @param {string} label @param {string[]} errors */
async function inspectLocalAsset(sourceDirectory, asset, label, errors) {
  const assetPath = path.resolve(sourceDirectory, asset.file);
  const pathError = await ensurePathWithin(sourceDirectory, assetPath);
  if (pathError) {
    errors.push(`${label}: ${pathError}`);
    return null;
  }

  try {
    const file = await readFile(assetPath);
    const metadata = inspectAsset(file, asset.file, asset.durationMs);
    const actualHash = createHash("sha256").update(file).digest("hex");
    if (actualHash !== asset.sha256) {
      errors.push(`${label}: SHA-256 does not match the manifest.`);
    }
    if (metadata.durationVerified && metadata.durationMs !== asset.durationMs) {
      errors.push(`${label}: expected ${asset.durationMs} ms, received ${metadata.durationMs} ms.`);
    }
    return { assetPath, format: path.extname(asset.file).slice(1).toLowerCase() || "unknown", bytes: file.length, ...metadata };
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** @param {string} source */
async function resolveManifestPath(source) {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat) throw new Error(`Source does not exist: ${source}`);
  if (sourceStat.isDirectory()) return path.join(source, "manifest.json");
  return source;
}

/** @param {string} manifestPath @param {string[]} errors */
async function readManifest(manifestPath, errors) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`Unable to read manifest: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** @param {string} rootDirectory @param {string} candidatePath */
async function ensurePathWithin(rootDirectory, candidatePath) {
  const relativePath = path.relative(rootDirectory, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return "Asset resolves outside the pack directory.";
  try {
    await access(candidatePath);
    return null;
  } catch {
    return "Referenced asset file does not exist.";
  }
}

/** @param {Buffer} file */
function inspectAsset(file, fileName, declaredDurationMs) {
  if (path.extname(fileName).toLowerCase() !== ".wav") {
    return { durationMs: declaredDurationMs, durationVerified: false };
  }
  return inspectWav(file);
}

/** @param {Buffer} file */
function inspectWav(file) {
  if (file.length < 44 || file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only valid WAV assets are supported by the local fixture exporter.");
  }

  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= file.length) {
    const chunkName = file.toString("ascii", offset, offset + 4);
    const chunkSize = file.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > file.length) throw new Error("WAV chunk extends beyond the file boundary.");
    if (chunkName === "fmt ") {
      if (chunkSize < 16) throw new Error("WAV fmt chunk is incomplete.");
      byteRate = file.readUInt32LE(chunkStart + 8);
    }
    if (chunkName === "data") dataBytes = chunkSize;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataBytes) throw new Error("WAV file must contain fmt and data chunks.");
  return { durationMs: Math.round((dataBytes / byteRate) * 1000), durationVerified: true };
}

/** @param {{ source?: string, contents?: string, target: string }} write */
async function classifyWrite(write) {
  try {
    const current = await readFile(write.target);
    const expected = write.source ? await readFile(write.source) : Buffer.from(write.contents, "utf8");
    return current.equals(expected) ? "unchanged" : "conflict";
  } catch {
    return "new";
  }
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest */
function createIntegrationModule(manifest) {
  return `// Generated by Wubble UI Sounds. Re-run setup with --force to replace this file.\nimport { createFeedbackClient } from "@wubble/ui-sounds";\n\nexport const feedbackManifest = ${JSON.stringify(manifest, null, 2)};\n\nexport const feedback = createFeedbackClient(feedbackManifest, {\n  baseUrl: "/wubble/${manifest.pack.id}",\n  enabled: false\n});\n\nexport function setFeedbackEnabled(enabled) {\n  feedback.setEnabled(enabled);\n}\n\nexport function unlockFeedback() {\n  return feedback.unlock();\n}\n`;
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest @param {string} integrationPath @param {string} assetDirectory */
function createNativeIntegrationModule(manifest, integrationPath, assetDirectory) {
  const assetFiles = new Set();
  for (const asset of Object.values(manifest.events)) {
    assetFiles.add(asset.file);
    for (const variant of asset.variants ?? []) assetFiles.add(variant.file);
  }
  const assets = [...assetFiles].sort().map((file) => {
    const assetPath = path.join(assetDirectory, file);
    const relativePath = path.relative(path.dirname(integrationPath), assetPath).replaceAll(path.sep, "/");
    const requiredPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return `  ${JSON.stringify(file)}: require(${JSON.stringify(requiredPath)})`;
  }).join(",\n");
  return `// Generated by Wubble UI Sounds. Re-run setup with --force to replace this file.\nimport { createNativeFeedbackClient } from "@wubble/react-native";\n\nexport const feedbackManifest = ${JSON.stringify(manifest, null, 2)};\n\nexport const feedbackAssets = {\n${assets}\n};\n\nexport function createWubbleFeedback({ audio, haptics, enabled = false, ...options }) {\n  return createNativeFeedbackClient(feedbackManifest, {\n    ...options,\n    assets: (file) => feedbackAssets[file],\n    audio,\n    haptics,\n    enabled\n  });\n}\n`;
}

/** @param {string} target @param {string} packId @param {"web" | "react-native"} platform */
function getExportLayout(target, packId, platform) {
  if (platform === "react-native") {
    return {
      assetDirectory: path.join(target, "src", "assets", "wubble", packId),
      integrationPath: path.join(target, "src", "lib", "wubble-ui-sounds.native.js"),
      configPath: path.join(target, "wubble.ui-sounds.native.yml")
    };
  }
  return {
    assetDirectory: path.join(target, "public", "wubble", packId),
    integrationPath: path.join(target, "src", "lib", "wubble-ui-sounds.js"),
    configPath: path.join(target, "wubble.ui-sounds.yml")
  };
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest @param {number} budgetKb @param {"web" | "react-native"} platform */
function createConfig(manifest, budgetKb, platform = "web") {
  const events = Object.keys(manifest.events).map((event) => `  - ${event}`).join("\n");
  return `version: 1\npack: ${manifest.pack.id}\nrevision: ${manifest.pack.revision}\nplatform: ${platform}\nevents:\n${events}\nbudget:\n  maxCompressedKb: ${budgetKb}\npreferences:\n  defaultEnabled: false\n  maxConcurrentSounds: ${manifest.defaults?.maxConcurrentSounds ?? 1}\n`;
}

function invalidReport(manifestPath, errors, budgetKb, manifest = undefined) {
  return { valid: false, errors, manifestPath, manifest, events: [], totalBytes: 0, budgetKb, budgetUsagePercent: 0 };
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest */
function createExportManifest(manifest) {
  const exported = structuredClone(manifest);
  for (const asset of Object.values(exported.events)) {
    appendHashToFilename(asset);
    for (const source of asset.sources ?? []) appendHashToFilename(source);
    for (const variant of asset.variants ?? []) appendHashToFilename(variant);
    for (const variant of asset.variants ?? []) {
      for (const source of variant.sources ?? []) appendHashToFilename(source);
    }
  }
  return exported;
}

/** @param {import("@wubble/manifest").FeedbackAssetVariant} asset */
function appendHashToFilename(asset) {
  const extension = path.extname(asset.file);
  const basename = path.basename(asset.file, extension);
  asset.file = `${basename}.${asset.sha256.slice(0, 12)}${extension}`;
}

/** @param {import("@wubble/manifest").FeedbackManifest} manifest @param {string} eventName @param {number | null} variantIndex */
function getExportAsset(manifest, eventName, variantIndex, sourceIndex) {
  const asset = manifest.events[eventName];
  const variant = variantIndex === null ? asset : asset.variants[variantIndex];
  return sourceIndex === null ? variant : variant.sources[sourceIndex];
}

/** @param {string} eventName @param {import("@wubble/manifest").FeedbackAsset} asset */
function enumerateEventAssets(eventName, asset) {
  const entries = [];
  const addAsset = (item, variantIndex, label) => {
    entries.push({ eventName, variantIndex, sourceIndex: null, label, asset: item });
    for (const [sourceIndex, source] of (item.sources ?? []).entries()) {
      entries.push({ eventName, variantIndex, sourceIndex, label: `${label}.sources.${sourceIndex}`, asset: source });
    }
  };
  addAsset(asset, null, `events.${eventName}`);
  for (const [variantIndex, variant] of (asset.variants ?? []).entries()) {
    addAsset(variant, variantIndex, `events.${eventName}.variants.${variantIndex}`);
  }
  return entries;
}
