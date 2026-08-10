import type { FeedbackEvent, FeedbackManifest } from "@wubbleai/manifest";

export type PlaybackResult =
  | { played: true }
  | { played: false; reason: "disabled" | "locked" | "unavailable" | "concurrency-limit" | "cooldown" | "reduced-feedback" | "quiet-mode" | "playback-failed" };

export interface FeedbackClient {
  unlock(): Promise<boolean>;
  play(event: FeedbackEvent): Promise<PlaybackResult>;
  stopAll(): void;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  setReducedFeedback(reducedFeedback: boolean): void;
  setQuietMode(quietMode: boolean): void;
  getState(): { enabled: boolean; unlocked: boolean; volume: number; reducedFeedback: boolean; quietMode: boolean; activeSounds: number };
  tap(): Promise<PlaybackResult>;
  toggleOn(): Promise<PlaybackResult>;
  toggleOff(): Promise<PlaybackResult>;
  select(): Promise<PlaybackResult>;
  open(): Promise<PlaybackResult>;
  close(): Promise<PlaybackResult>;
  navigate(): Promise<PlaybackResult>;
  success(): Promise<PlaybackResult>;
  error(): Promise<PlaybackResult>;
  warning(): Promise<PlaybackResult>;
  notify(): Promise<PlaybackResult>;
  send(): Promise<PlaybackResult>;
  receive(): Promise<PlaybackResult>;
  processing(): Promise<PlaybackResult>;
  complete(): Promise<PlaybackResult>;
  deleteConfirm(): Promise<PlaybackResult>;
}

export interface FeedbackClientOptions {
  baseUrl?: string;
  enabled?: boolean;
  volume?: number;
  reducedFeedback?: boolean;
  quietMode?: boolean;
  onError?: (error: unknown) => void;
  onHapticIntent?: (intent: string, event: FeedbackEvent) => void;
  random?: () => number;
  canPlayType?: (mimeType: string) => boolean | string;
}

export function createFeedbackClient(manifest: FeedbackManifest, options?: FeedbackClientOptions): FeedbackClient;
