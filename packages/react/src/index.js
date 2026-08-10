"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createFeedbackClient } from "@wubbleai/sounds";

const FeedbackContext = createContext(null);

/**
 * Provides one local-first feedback client and a persisted user preference.
 * This component is client-only; it does not access browser APIs during SSR.
 * @param {{ manifest: import("@wubbleai/manifest").FeedbackManifest, baseUrl?: string, children: import("react").ReactNode, defaultEnabled?: boolean, defaultVolume?: number, defaultReducedFeedback?: boolean, defaultQuietMode?: boolean, storageKey?: string, reducedFeedbackStorageKey?: string, quietModeStorageKey?: string }} props
 */
export function FeedbackProvider({
  manifest,
  baseUrl = `/wubble/${manifest.pack.id}`,
  children,
  defaultEnabled = false,
  defaultVolume = manifest.defaults?.gain ?? 0.5,
  defaultReducedFeedback = false,
  defaultQuietMode = false,
  storageKey = "wubble.ui-sounds.enabled",
  reducedFeedbackStorageKey = `${storageKey}.reduced`,
  quietModeStorageKey = `${storageKey}.quiet`
}) {
  const clientRef = useRef(null);
  const clientInputsRef = useRef({ manifest: null, baseUrl: null });
  if (clientInputsRef.current.manifest !== manifest || clientInputsRef.current.baseUrl !== baseUrl) {
    clientRef.current = createFeedbackClient(manifest, { baseUrl, enabled: defaultEnabled, volume: defaultVolume, reducedFeedback: defaultReducedFeedback, quietMode: defaultQuietMode });
    clientInputsRef.current = { manifest, baseUrl };
  }

  const client = clientRef.current;
  const [enabled, setEnabledState] = useState(defaultEnabled);
  const [volume, setVolumeState] = useState(defaultVolume);
  const [reducedFeedback, setReducedFeedbackState] = useState(defaultReducedFeedback);
  const [quietMode, setQuietModeState] = useState(defaultQuietMode);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    const persisted = readBooleanPreference(storageKey);
    if (persisted !== null) {
      setEnabledState(persisted);
      client.setEnabled(persisted);
    }
    const persistedReducedFeedback = readBooleanPreference(reducedFeedbackStorageKey);
    if (persistedReducedFeedback !== null) {
      setReducedFeedbackState(persistedReducedFeedback);
      client.setReducedFeedback(persistedReducedFeedback);
    }
    const persistedQuietMode = readBooleanPreference(quietModeStorageKey);
    if (persistedQuietMode !== null) {
      setQuietModeState(persistedQuietMode);
      client.setQuietMode(persistedQuietMode);
    }
    setPreferencesReady(true);
  }, [client, quietModeStorageKey, reducedFeedbackStorageKey, storageKey]);

  useEffect(() => {
    client.setEnabled(enabled);
    client.setVolume(volume);
    client.setReducedFeedback(reducedFeedback);
    client.setQuietMode(quietMode);
  }, [client, enabled, quietMode, reducedFeedback, volume]);

  useEffect(() => {
    if (preferencesReady) writeBooleanPreference(storageKey, enabled);
  }, [enabled, preferencesReady, storageKey]);

  useEffect(() => {
    if (preferencesReady) writeBooleanPreference(reducedFeedbackStorageKey, reducedFeedback);
  }, [preferencesReady, reducedFeedback, reducedFeedbackStorageKey]);

  useEffect(() => {
    if (preferencesReady) writeBooleanPreference(quietModeStorageKey, quietMode);
  }, [preferencesReady, quietMode, quietModeStorageKey]);

  useEffect(() => () => client.stopAll(), [client]);

  const setEnabled = useCallback(
    async (nextEnabled) => {
      const value = Boolean(nextEnabled);
      client.setEnabled(value);
      setEnabledState(value);
      return value ? client.unlock() : true;
    },
    [client]
  );

  const setVolume = useCallback(
    (nextVolume) => {
      const value = clamp(nextVolume);
      client.setVolume(value);
      setVolumeState(value);
    },
    [client]
  );

  const setReducedFeedback = useCallback(
    (nextReducedFeedback) => {
      const value = Boolean(nextReducedFeedback);
      client.setReducedFeedback(value);
      setReducedFeedbackState(value);
    },
    [client]
  );

  const setQuietMode = useCallback(
    (nextQuietMode) => {
      const value = Boolean(nextQuietMode);
      client.setQuietMode(value);
      setQuietModeState(value);
    },
    [client]
  );

  const value = useMemo(
    () => ({
      feedback: client,
      enabled,
      volume,
      reducedFeedback,
      quietMode,
      preferencesReady,
      play: client.play,
      unlock: client.unlock,
      setEnabled,
      setVolume,
      setReducedFeedback,
      setQuietMode
    }),
    [client, enabled, preferencesReady, quietMode, reducedFeedback, setEnabled, setQuietMode, setReducedFeedback, setVolume, volume]
  );

  return createElement(FeedbackContext.Provider, { value }, children);
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used inside a FeedbackProvider.");
  }
  return context;
}

/**
 * A compact, accessible user setting that keeps sound optional.
 * @param {{ label?: string, showVolume?: boolean, showReducedFeedback?: boolean, showQuietMode?: boolean }} props
 */
export function FeedbackSettings({ label = "Interface sounds", showVolume = true, showReducedFeedback = true, showQuietMode = true }) {
  const { enabled, quietMode, reducedFeedback, setEnabled, setQuietMode, setReducedFeedback, setVolume, volume } = useFeedback();
  const id = useId();
  const volumeId = `${id}-volume`;

  return createElement(
    "fieldset",
    null,
    createElement("legend", null, label),
    createElement(
      "label",
      null,
      createElement("input", {
        type: "checkbox",
        checked: enabled,
        onChange: (event) => void setEnabled(event.currentTarget.checked)
      }),
      "Enable sounds"
    ),
    showVolume &&
      createElement(
        "label",
        { htmlFor: volumeId },
        "Volume",
        createElement("input", {
          id: volumeId,
          type: "range",
          min: "0",
          max: "1",
          step: "0.05",
          value: volume,
          onChange: (event) => setVolume(Number(event.currentTarget.value))
        })
      ),
    showReducedFeedback &&
      createElement(
        "label",
        null,
        createElement("input", {
          type: "checkbox",
          checked: reducedFeedback,
          onChange: (event) => setReducedFeedback(event.currentTarget.checked)
        }),
        "Reduce frequent sounds"
      ),
    showQuietMode &&
      createElement(
        "label",
        null,
        createElement("input", {
          type: "checkbox",
          checked: quietMode,
          onChange: (event) => setQuietMode(event.currentTarget.checked)
        }),
        "Quiet context"
      )
  );
}

/**
 * A semantic button that plays feedback before invoking its optional click handler.
 * @param {{ event: import("@wubbleai/manifest").FeedbackEvent, children: import("react").ReactNode, onClick?: (event: import("react").MouseEvent<HTMLButtonElement>) => void, disabled?: boolean }} props
 */
export function FeedbackButton({ event, children, onClick, disabled = false }) {
  const { play } = useFeedback();
  const handleClick = useCallback(
    (clickEvent) => {
      void play(event);
      onClick?.(clickEvent);
    },
    [event, onClick, play]
  );

  return createElement("button", { type: "button", disabled, onClick: handleClick }, children);
}

/**
 * Runs an asynchronous product action with semantic pending, success, and error feedback.
 * The caller remains responsible for visible loading, success, and error states.
 * @template T
 * @param {{ play: (event: import("@wubbleai/manifest").FeedbackEvent) => Promise<import("@wubbleai/sounds").PlaybackResult>, action: () => T | Promise<T>, pendingEvent?: import("@wubbleai/manifest").FeedbackEvent, successEvent?: import("@wubbleai/manifest").FeedbackEvent, errorEvent?: import("@wubbleai/manifest").FeedbackEvent, onStateChange?: (state: "pending" | "success" | "error") => void }} options
 * @returns {Promise<T>}
 */
export async function runFeedbackAction({
  play,
  action,
  pendingEvent = "processing",
  successEvent = "success",
  errorEvent = "error",
  onStateChange
}) {
  onStateChange?.("pending");
  await play(pendingEvent);

  try {
    const result = await action();
    onStateChange?.("success");
    await play(successEvent);
    return result;
  } catch (error) {
    onStateChange?.("error");
    await play(errorEvent);
    throw error;
  }
}

/**
 * Adds a standard semantic sound sequence to an asynchronous UI action.
 * @param {{ pendingEvent?: import("@wubbleai/manifest").FeedbackEvent, successEvent?: import("@wubbleai/manifest").FeedbackEvent, errorEvent?: import("@wubbleai/manifest").FeedbackEvent }} [options]
 */
export function useAsyncFeedback(options = {}) {
  const { play } = useFeedback();
  const [status, setStatus] = useState("idle");
  const { pendingEvent = "processing", successEvent = "success", errorEvent = "error" } = options;

  const run = useCallback(
    (action) =>
      runFeedbackAction({
        play,
        action,
        pendingEvent,
        successEvent,
        errorEvent,
        onStateChange: setStatus
      }),
    [errorEvent, pendingEvent, play, successEvent]
  );

  const reset = useCallback(() => setStatus("idle"), []);
  return { status, run, reset };
}

function readBooleanPreference(key) {
  if (typeof window === "undefined" || !key) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? null : value === "true";
  } catch {
    return null;
  }
}

function writeBooleanPreference(key, value) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // A blocked storage area must never prevent application feedback controls from working.
  }
}

function clamp(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
