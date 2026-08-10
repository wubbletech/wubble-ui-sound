export const MANIFEST_SCHEMA_VERSION = 1;
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = Object.freeze([MANIFEST_SCHEMA_VERSION]);

export class ManifestCompatibilityError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ManifestCompatibilityError";
  }
}

/**
 * Applies a registered deterministic manifest migration before validation.
 * The initial public contract has no older schema to migrate yet; explicit
 * rejection keeps a future incompatible release from being interpreted loosely.
 * @param {unknown} value
 * @returns {{ manifest: unknown, fromSchemaVersion: number, toSchemaVersion: number, migrated: boolean }}
 */
export function migrateManifest(value) {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) {
    throw new ManifestCompatibilityError("Manifest schemaVersion must be a positive integer.");
  }
  if (value.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    return {
      manifest: value,
      fromSchemaVersion: value.schemaVersion,
      toSchemaVersion: MANIFEST_SCHEMA_VERSION,
      migrated: false
    };
  }
  if (value.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new ManifestCompatibilityError(`Manifest schemaVersion ${value.schemaVersion} is newer than this SDK supports (${MANIFEST_SCHEMA_VERSION}).`);
  }
  throw new ManifestCompatibilityError(`Manifest schemaVersion ${value.schemaVersion} requires a migration that this SDK does not provide.`);
}

export const FEEDBACK_EVENTS = Object.freeze([
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

const FEEDBACK_EVENT_SET = new Set(FEEDBACK_EVENTS);
const PRIORITIES = new Set(["low", "normal", "high"]);
const INTERRUPTION_POLICIES = new Set(["never", "lower-priority", "always"]);
const INTENSITIES = new Set(["subtle", "standard", "pronounced"]);
const HAPTIC_INTENTS = new Set(["none", "selection", "success", "warning", "error"]);
const VARIANT_STRATEGIES = new Set(["rotate", "random"]);
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/webm; codecs=opus", "audio/ogg; codecs=opus", "audio/mp4; codecs=mp4a.40.2"]);

/**
 * Validates the portable, local-first pack manifest used by the browser runtime.
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(value) {
  const errors = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["Manifest must be an object."] };
  }

  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`);
  }

  if (!isRecord(value.pack) || !isNonEmptyString(value.pack.id)) {
    errors.push("pack.id must be a non-empty string.");
  }

  if (!isRecord(value.pack) || !Number.isInteger(value.pack.revision) || value.pack.revision < 1) {
    errors.push("pack.revision must be a positive integer.");
  }

  if (isRecord(value.pack) && value.pack.budgetKb !== undefined && (!Number.isInteger(value.pack.budgetKb) || value.pack.budgetKb < 1 || value.pack.budgetKb > 1_024)) {
    errors.push("pack.budgetKb must be a positive integer no greater than 1024.");
  }

  if (!isRecord(value.events) || Object.keys(value.events).length === 0) {
    errors.push("events must contain at least one supported event.");
  } else {
    for (const [eventName, asset] of Object.entries(value.events)) {
      validateEvent(eventName, asset, errors);
    }
  }

  if (value.defaults !== undefined) {
    validateDefaults(value.defaults, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {unknown} value
 * @returns {import("./index.d.ts").FeedbackManifest}
 */
export function assertValidManifest(value) {
  const result = validateManifest(value);
  if (!result.valid) {
    throw new Error(`Invalid Wubble manifest: ${result.errors.join(" ")}`);
  }

  return /** @type {import("./index.d.ts").FeedbackManifest} */ (value);
}

/**
 * Resolves the effective playback policy for a semantic event.
 * @param {import("./index.d.ts").FeedbackPolicy | undefined} defaults
 * @param {import("./index.d.ts").FeedbackPolicy | undefined} eventPolicy
 */
export function resolveFeedbackPolicy(defaults, eventPolicy) {
  return {
    cooldownMs: eventPolicy?.cooldownMs ?? defaults?.cooldownMs ?? 0,
    priority: eventPolicy?.priority ?? defaults?.priority ?? "normal",
    interruptPolicy: eventPolicy?.interruptPolicy ?? defaults?.interruptPolicy ?? "never",
    intensity: eventPolicy?.intensity ?? defaults?.intensity ?? "standard",
    hapticIntent: eventPolicy?.hapticIntent ?? defaults?.hapticIntent ?? "none",
    variantStrategy: eventPolicy?.variantStrategy ?? defaults?.variantStrategy ?? "rotate"
  };
}

/**
 * Selects a declared primary or variant asset while retaining the caller's cursor state.
 * @param {string} eventName
 * @param {import("./index.d.ts").FeedbackAsset} asset
 * @param {"rotate" | "random"} strategy
 * @param {() => number} random
 * @param {Map<string, number>} cursor
 */
export function selectFeedbackAsset(eventName, asset, strategy, random, cursor) {
  const choices = [asset, ...(asset.variants ?? [])];
  if (choices.length === 1) return choices[0];
  const nextIndex = strategy === "random"
    ? Math.min(choices.length - 1, Math.floor(clampUnit(random()) * choices.length))
    : (cursor.get(eventName) ?? 0) % choices.length;
  cursor.set(eventName, nextIndex + 1);
  return choices[nextIndex];
}

/** @param {"low" | "normal" | "high"} priority */
export function feedbackPriorityRank(priority) {
  return priority === "high" ? 2 : priority === "normal" ? 1 : 0;
}

/** @param {string} eventName @param {unknown} asset @param {string[]} errors */
function validateEvent(eventName, asset, errors) {
  if (!FEEDBACK_EVENT_SET.has(eventName)) {
    errors.push(`events.${eventName} is not a supported feedback event.`);
  }

  if (!isRecord(asset)) {
    errors.push(`events.${eventName} must be an object.`);
    return;
  }

  validateAsset(asset, `events.${eventName}`, errors);
  validateSources(asset, `events.${eventName}`, errors);
  validatePolicy(asset.policy, `events.${eventName}.policy`, errors);

  if (asset.variants !== undefined) {
    if (!Array.isArray(asset.variants) || asset.variants.length === 0 || asset.variants.length > 5) {
      errors.push(`events.${eventName}.variants must contain between 1 and 5 assets.`);
    } else {
      const files = new Set([asset.file]);
      for (const [index, variant] of asset.variants.entries()) {
        validateAsset(variant, `events.${eventName}.variants.${index}`, errors);
        validateSources(variant, `events.${eventName}.variants.${index}`, errors);
        if (isRecord(variant) && files.has(variant.file)) {
          errors.push(`events.${eventName}.variants.${index}.file must differ from the primary asset and other variants.`);
        }
        if (isRecord(variant)) files.add(variant.file);
      }
    }
  }
}

/** @param {unknown} asset @param {string} path @param {string[]} errors */
function validateSources(asset, path, errors) {
  if (!isRecord(asset) || asset.sources === undefined) return;
  if (!Array.isArray(asset.sources) || asset.sources.length === 0 || asset.sources.length > 3) {
    errors.push(`${path}.sources must contain between 1 and 3 codec sources.`);
    return;
  }
  const files = new Set([asset.file]);
  for (const [index, source] of asset.sources.entries()) {
    const sourcePath = `${path}.sources.${index}`;
    validateAsset(source, sourcePath, errors);
    if (isRecord(source) && files.has(source.file)) errors.push(`${sourcePath}.file must differ from the primary asset and other sources.`);
    if (isRecord(source) && !AUDIO_MIME_TYPES.has(source.mimeType)) errors.push(`${sourcePath}.mimeType must be a supported local audio MIME type.`);
    if (isRecord(source)) files.add(source.file);
  }
}

/** @param {unknown} defaults @param {string[]} errors */
function validateDefaults(defaults, errors) {
  if (!isRecord(defaults)) {
    errors.push("defaults must be an object.");
    return;
  }

  if (defaults.gain !== undefined && !isGain(defaults.gain)) {
    errors.push("defaults.gain must be a number between 0 and 1.");
  }

  if (
    defaults.maxConcurrentSounds !== undefined &&
    (!Number.isInteger(defaults.maxConcurrentSounds) ||
      defaults.maxConcurrentSounds < 1 ||
      defaults.maxConcurrentSounds > 4)
  ) {
    errors.push("defaults.maxConcurrentSounds must be an integer between 1 and 4.");
  }

  validatePolicy(defaults.policy, "defaults.policy", errors);
}

/** @param {unknown} asset @param {string} path @param {string[]} errors */
function validateAsset(asset, path, errors) {
  if (!isRecord(asset)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  if (!isSafeRelativePath(asset.file)) {
    errors.push(`${path}.file must be a safe relative asset path.`);
  }

  if (!Number.isInteger(asset.durationMs) || asset.durationMs < 1 || asset.durationMs > 30_000) {
    errors.push(`${path}.durationMs must be an integer between 1 and 30000.`);
  }

  if (!isNonEmptyString(asset.sha256)) {
    errors.push(`${path}.sha256 must be a non-empty string.`);
  }

  if (asset.gain !== undefined && !isGain(asset.gain)) {
    errors.push(`${path}.gain must be a number between 0 and 1.`);
  }
}

/** @param {unknown} policy @param {string} path @param {string[]} errors */
function validatePolicy(policy, path, errors) {
  if (policy === undefined) return;
  if (!isRecord(policy)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  if (policy.cooldownMs !== undefined && (!Number.isInteger(policy.cooldownMs) || policy.cooldownMs < 0 || policy.cooldownMs > 60_000)) {
    errors.push(`${path}.cooldownMs must be an integer between 0 and 60000.`);
  }
  if (policy.priority !== undefined && !PRIORITIES.has(policy.priority)) {
    errors.push(`${path}.priority must be low, normal, or high.`);
  }
  if (policy.interruptPolicy !== undefined && !INTERRUPTION_POLICIES.has(policy.interruptPolicy)) {
    errors.push(`${path}.interruptPolicy must be never, lower-priority, or always.`);
  }
  if (policy.intensity !== undefined && !INTENSITIES.has(policy.intensity)) {
    errors.push(`${path}.intensity must be subtle, standard, or pronounced.`);
  }
  if (policy.hapticIntent !== undefined && !HAPTIC_INTENTS.has(policy.hapticIntent)) {
    errors.push(`${path}.hapticIntent must be none, selection, success, warning, or error.`);
  }
  if (policy.variantStrategy !== undefined && !VARIANT_STRATEGIES.has(policy.variantStrategy)) {
    errors.push(`${path}.variantStrategy must be rotate or random.`);
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {number} value */
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** @param {unknown} value */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
function isGain(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** @param {unknown} value */
function isSafeRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.split("/").includes("..") &&
    !/^[a-z][a-z\d+.-]*:/i.test(value)
  );
}
