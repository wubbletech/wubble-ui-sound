import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { assertValidManifest, migrateManifest } from "@wubble/manifest";

const ARCHIVE_FORMAT = "wubble-pack";
const ARCHIVE_SCHEMA_VERSION = 1;

/**
 * Verifies an approved Wubble pack artifact using a caller-supplied key or registry.
 * @param {{ archiveBytes: Uint8Array, publicKeyPem?: string | Buffer, trustedKeys?: unknown }} options
 */
export function verifyPackArchive({ archiveBytes, publicKeyPem, trustedKeys }) {
  let archive;
  try {
    archive = JSON.parse(gunzipSync(archiveBytes).toString("utf8"));
  } catch {
    throw new Error("Pack archive is not a valid gzip JSON artifact.");
  }
  validateArchiveShape(archive);
  const trust = resolveArchiveTrust({ publicKeyPem, trustedKeys, keyId: archive.signature.keyId });
  const { value, ...signatureMetadata } = archive.signature;
  const unsigned = { ...archive, signature: signatureMetadata };
  const valid = verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(trust.publicKeyPem), Buffer.from(value, "base64"));
  if (!valid) throw new Error("Pack archive signature is invalid.");

  const compatibility = migrateManifest(archive.manifest);
  const manifest = assertValidManifest(compatibility.manifest);
  const expectedFiles = new Set(listManifestFiles(manifest));
  if (expectedFiles.size !== archive.assets.length) throw new Error("Pack archive assets do not match its manifest.");
  const files = archive.assets.map((asset) => {
    if (!expectedFiles.has(asset.file) || !isSafeRelativePath(asset.file) || typeof asset.data !== "string") {
      throw new Error("Pack archive contains an invalid asset entry.");
    }
    const bytes = Buffer.from(asset.data, "base64");
    if (asset.bytes !== bytes.length || asset.sha256 !== hash(bytes)) throw new Error(`Pack archive asset integrity failed: ${asset.file}.`);
    return { file: asset.file, bytes };
  });
  return { archive, manifest, files, trust: { keyId: archive.signature.keyId, status: trust.status }, compatibility };
}

/** @param {{ publicKeyPem?: string | Buffer, trustedKeys?: unknown, keyId: string }} options */
function resolveArchiveTrust({ publicKeyPem, trustedKeys, keyId }) {
  if (publicKeyPem && trustedKeys) throw new Error("Provide either a trusted public key or a trusted key registry, not both.");
  if (publicKeyPem) return { publicKeyPem, status: "direct" };
  if (!trustedKeys || typeof trustedKeys !== "object" || Array.isArray(trustedKeys)) {
    throw new Error("A trusted public key or trusted key registry is required to verify a pack archive.");
  }
  const registry = /** @type {{ schemaVersion?: unknown, keys?: unknown }} */ (trustedKeys);
  if (registry.schemaVersion !== 1 || !registry.keys || typeof registry.keys !== "object" || Array.isArray(registry.keys)) {
    throw new Error("Trusted key registry schema is unsupported.");
  }
  const record = /** @type {{ publicKey?: unknown, status?: unknown } | undefined} */ (registry.keys[keyId]);
  if (!record || typeof record.publicKey !== "string" || !record.publicKey.trim()) {
    throw new Error(`Trusted key registry does not contain ${keyId}.`);
  }
  if (record.status === "revoked") throw new Error(`Trusted key ${keyId} is revoked.`);
  if (record.status !== "active" && record.status !== "retired") {
    throw new Error(`Trusted key ${keyId} has an unsupported status.`);
  }
  return { publicKeyPem: record.publicKey, status: record.status };
}

/** @param {any} manifest */
function listManifestFiles(manifest) {
  if (!manifest?.pack?.id || !Number.isInteger(manifest.pack.revision) || !manifest.events || typeof manifest.events !== "object") {
    throw new Error("Pack archive requires a valid manifest.");
  }
  const files = new Set();
  const add = (asset) => {
    if (!asset?.file || !isSafeRelativePath(asset.file)) throw new Error("Pack archive manifest contains an unsafe asset file.");
    files.add(asset.file);
    for (const source of asset.sources ?? []) add(source);
    for (const variant of asset.variants ?? []) add(variant);
  };
  for (const asset of Object.values(manifest.events)) add(asset);
  return [...files].sort();
}

/** @param {any} archive */
function validateArchiveShape(archive) {
  if (!archive || typeof archive !== "object" || archive.format !== ARCHIVE_FORMAT || archive.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error("Pack archive format or schema is unsupported.");
  }
  if (!archive.signature || archive.signature.algorithm !== "ed25519" || !isSafeKeyId(archive.signature.keyId) || typeof archive.signature.value !== "string") {
    throw new Error("Pack archive signature metadata is invalid.");
  }
  if (!archive.records?.audit || !archive.records?.qualityReport || !Array.isArray(archive.assets)) {
    throw new Error("Pack archive is missing required release records.");
  }
  if (archive.pack?.id !== archive.manifest?.pack?.id || archive.pack?.revision !== archive.manifest?.pack?.revision) {
    throw new Error("Pack archive metadata does not match its manifest.");
  }
}

/** @param {unknown} value */
function isSafeKeyId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
}

/** @param {unknown} value */
function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`) && !path.isAbsolute(normalized);
}

/** @param {Uint8Array} bytes */
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {unknown} value */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}
