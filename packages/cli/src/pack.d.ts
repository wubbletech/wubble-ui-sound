import type { FeedbackManifest } from "@wubble/manifest";

export interface PackEventReport {
  name: string;
  assetPath: string;
  format: "wav";
  bytes: number;
  durationMs: number;
}

export interface PackReport {
  valid: boolean;
  errors: string[];
  manifestPath: string;
  manifest?: FeedbackManifest;
  events: PackEventReport[];
  totalBytes: number;
  budgetKb: number;
  budgetUsagePercent: number;
}

export function validatePack(manifestPath: string, budgetKb?: number): Promise<PackReport>;
export function inspectPack(manifestPath: string, budgetKb?: number): Promise<PackReport>;
export function exportPack(options: {
  source: string;
  target: string;
  budgetKb?: number;
  force?: boolean;
  dryRun?: boolean;
  platform?: "web" | "react-native";
}): Promise<{
  packId: string;
  revision: number;
  target: string;
  dryRun: boolean;
  planned: string[];
  written: string[];
  unchanged: string[];
  platform: "web" | "react-native";
}>;

export interface PackRevisionChangeResult {
  packId: string;
  previousRevision: number;
  revision: number;
  target: string;
  dryRun: boolean;
  planned: string[];
  written: string[];
  deleted: string[];
  snapshotDirectory: string;
  platform: "web" | "react-native";
}

export function upgradePack(options: {
  source: string;
  target: string;
  budgetKb?: number;
  dryRun?: boolean;
  platform?: "web" | "react-native";
}): Promise<PackRevisionChangeResult>;

export function upgradePackArchive(options: {
  archive: string;
  target: string;
  publicKey?: string;
  trustedKeys?: string;
  budgetKb?: number;
  dryRun?: boolean;
  platform?: "web" | "react-native";
}): Promise<PackRevisionChangeResult & { archive: { keyId: string; sha256: string; trustStatus: "active" | "retired" | "direct" } }>;

export function rollbackPack(options: {
  target: string;
  packId: string;
  revision: number;
  dryRun?: boolean;
  platform?: "web" | "react-native";
}): Promise<PackRevisionChangeResult>;

export function installPackArchive(options: {
  archive: string;
  publicKey?: string;
  trustedKeys?: string;
  target: string;
  budgetKb?: number;
  force?: boolean;
  dryRun?: boolean;
  platform?: "web" | "react-native";
}): Promise<Awaited<ReturnType<typeof exportPack>> & { archive: { keyId: string; sha256: string; trustStatus: "active" | "retired" | "direct" } }>;
