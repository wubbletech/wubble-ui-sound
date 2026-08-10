import type { FeedbackAssetVariant, FeedbackEvent, FeedbackManifest, FeedbackPolicy } from "@wubbleai/manifest";

export type NativePlaybackResult =
  | { played: true }
  | { played: false; reason: "disabled" | "unavailable" | "concurrency-limit" | "cooldown" | "reduced-feedback" | "quiet-mode" | "playback-failed" };

export interface NativePlaybackHandle {
  stop(): void | Promise<void>;
  finished: Promise<void>;
}

export interface NativeAudioBridge {
  play(asset: unknown, options: { volume: number; event: FeedbackEvent; durationMs: number }): Promise<NativePlaybackHandle>;
}

export interface NativeHapticBridge {
  trigger(intent: NonNullable<FeedbackPolicy["hapticIntent"]>, event: FeedbackEvent): void | Promise<void>;
}

export interface NativeFeedbackClientOptions {
  assets(file: string, asset: FeedbackAssetVariant): unknown;
  audio: NativeAudioBridge;
  haptics?: NativeHapticBridge;
  enabled?: boolean;
  hapticsEnabled?: boolean;
  volume?: number;
  reducedFeedback?: boolean;
  quietMode?: boolean;
  onError?: (error: unknown) => void;
  random?: () => number;
  canPlayType?: (mimeType: string) => boolean | string;
}

export interface NativeFeedbackClient {
  unlock(): Promise<boolean>;
  play(event: FeedbackEvent): Promise<NativePlaybackResult>;
  stopAll(): void;
  setEnabled(enabled: boolean): void;
  setHapticsEnabled(hapticsEnabled: boolean): void;
  setVolume(volume: number): void;
  setReducedFeedback(reducedFeedback: boolean): void;
  setQuietMode(quietMode: boolean): void;
  getState(): { enabled: boolean; hapticsEnabled: boolean; unlocked: boolean; volume: number; reducedFeedback: boolean; quietMode: boolean; activeSounds: number };
  tap(): Promise<NativePlaybackResult>;
  toggleOn(): Promise<NativePlaybackResult>;
  toggleOff(): Promise<NativePlaybackResult>;
  select(): Promise<NativePlaybackResult>;
  open(): Promise<NativePlaybackResult>;
  close(): Promise<NativePlaybackResult>;
  navigate(): Promise<NativePlaybackResult>;
  success(): Promise<NativePlaybackResult>;
  error(): Promise<NativePlaybackResult>;
  warning(): Promise<NativePlaybackResult>;
  notify(): Promise<NativePlaybackResult>;
  send(): Promise<NativePlaybackResult>;
  receive(): Promise<NativePlaybackResult>;
  processing(): Promise<NativePlaybackResult>;
  complete(): Promise<NativePlaybackResult>;
  deleteConfirm(): Promise<NativePlaybackResult>;
}

export function createNativeFeedbackClient(manifest: FeedbackManifest, options: NativeFeedbackClientOptions): NativeFeedbackClient;
