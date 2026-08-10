export const MANIFEST_SCHEMA_VERSION: 1;
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: readonly [1];

export class ManifestCompatibilityError extends Error {}

export interface ManifestMigrationResult {
  manifest: unknown;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  migrated: boolean;
}

export const FEEDBACK_EVENTS: readonly [
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
];

export type FeedbackEvent = (typeof FEEDBACK_EVENTS)[number];

export type FeedbackPriority = "low" | "normal" | "high";
export type FeedbackInterruptPolicy = "never" | "lower-priority" | "always";
export type FeedbackIntensity = "subtle" | "standard" | "pronounced";
export type HapticIntent = "none" | "selection" | "success" | "warning" | "error";
export type VariantStrategy = "rotate" | "random";

export interface FeedbackPolicy {
  cooldownMs?: number;
  priority?: FeedbackPriority;
  interruptPolicy?: FeedbackInterruptPolicy;
  intensity?: FeedbackIntensity;
  hapticIntent?: HapticIntent;
  variantStrategy?: VariantStrategy;
}

export interface FeedbackAssetSource {
  file: string;
  mimeType: "audio/mpeg" | "audio/webm; codecs=opus" | "audio/ogg; codecs=opus" | "audio/mp4; codecs=mp4a.40.2";
  durationMs: number;
  sha256: string;
}

export interface FeedbackAssetVariant {
  file: string;
  durationMs: number;
  sha256: string;
  gain?: number;
  sources?: FeedbackAssetSource[];
}

export interface FeedbackAsset extends FeedbackAssetVariant {
  policy?: FeedbackPolicy;
  variants?: FeedbackAssetVariant[];
}

export interface FeedbackManifest {
  schemaVersion: number;
  pack: {
    id: string;
    revision: number;
    budgetKb?: number;
  };
  defaults?: {
    gain?: number;
    maxConcurrentSounds?: number;
    policy?: FeedbackPolicy;
  };
  events: Partial<Record<FeedbackEvent, FeedbackAsset>>;
}

export interface ResolvedFeedbackPolicy {
  cooldownMs: number;
  priority: FeedbackPriority;
  interruptPolicy: FeedbackInterruptPolicy;
  intensity: FeedbackIntensity;
  hapticIntent: HapticIntent;
  variantStrategy: VariantStrategy;
}

export function validateManifest(value: unknown): { valid: boolean; errors: string[] };
export function assertValidManifest(value: unknown): FeedbackManifest;
export function migrateManifest(value: unknown): ManifestMigrationResult;
export function resolveFeedbackPolicy(defaults?: FeedbackPolicy, eventPolicy?: FeedbackPolicy): ResolvedFeedbackPolicy;
export function selectFeedbackAsset(eventName: string, asset: FeedbackAsset, strategy: VariantStrategy, random: () => number, cursor: Map<string, number>): FeedbackAssetVariant;
export function feedbackPriorityRank(priority: FeedbackPriority): number;
