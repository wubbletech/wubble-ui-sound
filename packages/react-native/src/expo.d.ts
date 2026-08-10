import type { NativeAudioBridge, NativeHapticBridge } from "./index.js";

export function createExpoFeedbackBridge(options?: {
  playerOptions?: Record<string, unknown>;
  haptics?: boolean;
}): Promise<NativeAudioBridge & NativeHapticBridge>;
