"use client";

import type { MouseEvent, ReactNode } from "react";
import type { FeedbackEvent, FeedbackManifest } from "@wubble/manifest";
import type { FeedbackClient, PlaybackResult } from "@wubble/sounds";

export interface FeedbackProviderProps {
  manifest: FeedbackManifest;
  baseUrl?: string;
  children: ReactNode;
  defaultEnabled?: boolean;
  defaultVolume?: number;
  defaultReducedFeedback?: boolean;
  defaultQuietMode?: boolean;
  storageKey?: string;
  reducedFeedbackStorageKey?: string;
  quietModeStorageKey?: string;
}

export interface FeedbackContextValue {
  feedback: FeedbackClient;
  enabled: boolean;
  volume: number;
  reducedFeedback: boolean;
  quietMode: boolean;
  preferencesReady: boolean;
  play(event: FeedbackEvent): Promise<PlaybackResult>;
  unlock(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  setVolume(volume: number): void;
  setReducedFeedback(reducedFeedback: boolean): void;
  setQuietMode(quietMode: boolean): void;
}

export function FeedbackProvider(props: FeedbackProviderProps): ReactNode;
export function useFeedback(): FeedbackContextValue;
export function FeedbackSettings(props?: { label?: string; showVolume?: boolean; showReducedFeedback?: boolean; showQuietMode?: boolean }): ReactNode;
export function FeedbackButton(props: {
  event: FeedbackEvent;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}): ReactNode;

export type AsyncFeedbackStatus = "idle" | "pending" | "success" | "error";

export interface AsyncFeedbackOptions {
  pendingEvent?: FeedbackEvent;
  successEvent?: FeedbackEvent;
  errorEvent?: FeedbackEvent;
}

export function runFeedbackAction<T>(options: AsyncFeedbackOptions & {
  play(event: FeedbackEvent): Promise<PlaybackResult>;
  action(): T | Promise<T>;
  onStateChange?(state: Exclude<AsyncFeedbackStatus, "idle">): void;
}): Promise<T>;

export function useAsyncFeedback(options?: AsyncFeedbackOptions): {
  status: AsyncFeedbackStatus;
  run<T>(action: () => T | Promise<T>): Promise<T>;
  reset(): void;
};
