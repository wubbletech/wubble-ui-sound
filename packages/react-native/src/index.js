import { assertValidManifest, feedbackPriorityRank, resolveFeedbackPolicy, selectFeedbackAsset } from "@wubble/manifest";

/**
 * Creates a semantic feedback client for React Native. The app supplies bundled
 * asset resolution and an audio bridge, keeping playback local and provider-neutral.
 * @param {import("@wubble/manifest").FeedbackManifest} manifest
 * @param {{ assets: (file: string, asset: import("@wubble/manifest").FeedbackAssetVariant) => unknown, audio: { play: (asset: unknown, options: { volume: number, event: string, durationMs: number }) => Promise<{ stop: () => void | Promise<void>, finished: Promise<void> }> }, haptics?: { trigger: (intent: string, event: string) => void | Promise<void> }, enabled?: boolean, hapticsEnabled?: boolean, volume?: number, reducedFeedback?: boolean, quietMode?: boolean, onError?: (error: unknown) => void, random?: () => number, canPlayType?: (mimeType: string) => boolean | string }} options
 */
export function createNativeFeedbackClient(manifest, options) {
  const validatedManifest = assertValidManifest(manifest);
  if (!options || typeof options.assets !== "function" || !options.audio || typeof options.audio.play !== "function") {
    throw new Error("createNativeFeedbackClient requires local assets and an audio bridge.");
  }

  const maxConcurrentSounds = validatedManifest.defaults?.maxConcurrentSounds ?? 1;
  let enabled = options.enabled ?? false;
  let hapticsEnabled = options.hapticsEnabled ?? true;
  let volume = clamp(options.volume ?? validatedManifest.defaults?.gain ?? 0.5);
  let reducedFeedback = options.reducedFeedback ?? false;
  let quietMode = options.quietMode ?? false;
  const activePlayback = new Map();
  const lastPlayedAt = new Map();
  const variantCursor = new Map();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const canPlayType = typeof options.canPlayType === "function" ? options.canPlayType : () => false;

  /** @returns {Promise<boolean>} */
  async function unlock() {
    return true;
  }

  /** @param {import("@wubble/manifest").FeedbackEvent} eventName */
  async function play(eventName) {
    if (!enabled) return { played: false, reason: "disabled" };

    const asset = validatedManifest.events[eventName];
    if (!asset) return { played: false, reason: "unavailable" };

    const policy = resolveFeedbackPolicy(validatedManifest.defaults?.policy, asset.policy);
    if (reducedFeedback && (policy.priority === "low" || policy.intensity === "subtle")) {
      return { played: false, reason: "reduced-feedback" };
    }
    if (quietMode && policy.priority === "low") return { played: false, reason: "quiet-mode" };

    const now = Date.now();
    const previousPlay = lastPlayedAt.get(eventName);
    if (previousPlay !== undefined && now - previousPlay < policy.cooldownMs) {
      return { played: false, reason: "cooldown" };
    }
    if (!makeRoom(policy)) return { played: false, reason: "concurrency-limit" };

    const selectedAsset = selectFeedbackAsset(eventName, asset, policy.variantStrategy, random, variantCursor);
    const playableAsset = selectPlayableSource(selectedAsset, canPlayType);
    const nativeAsset = options.assets(playableAsset.file, playableAsset);
    if (nativeAsset === undefined || nativeAsset === null) return { played: false, reason: "unavailable" };

    try {
      lastPlayedAt.set(eventName, now);
      const playback = await options.audio.play(nativeAsset, {
        volume: clamp(volume * (selectedAsset.gain ?? 1)),
        event: eventName,
        durationMs: selectedAsset.durationMs
      });
      if (!playback || typeof playback.stop !== "function" || !playback.finished || typeof playback.finished.then !== "function") {
        throw new Error("Native audio bridge must return stop() and a finished Promise.");
      }
      activePlayback.set(playback, { eventName, priority: policy.priority });
      void playback.finished.then(
        () => activePlayback.delete(playback),
        (error) => {
          activePlayback.delete(playback);
          reportError(error);
        }
      );
      if (hapticsEnabled && policy.hapticIntent !== "none" && typeof options.haptics?.trigger === "function") {
        void Promise.resolve(options.haptics.trigger(policy.hapticIntent, eventName)).catch(reportError);
      }
      return { played: true };
    } catch (error) {
      if (lastPlayedAt.get(eventName) === now) lastPlayedAt.delete(eventName);
      reportError(error);
      return { played: false, reason: "playback-failed" };
    }
  }

  function stopAll() {
    for (const playback of activePlayback.keys()) stopPlayback(playback);
    activePlayback.clear();
  }

  /** @param {boolean} value */
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopAll();
  }

  /** @param {boolean} value */
  function setHapticsEnabled(value) {
    hapticsEnabled = Boolean(value);
  }

  /** @param {number} value */
  function setVolume(value) {
    volume = clamp(value);
  }

  /** @param {boolean} value */
  function setReducedFeedback(value) {
    reducedFeedback = Boolean(value);
  }

  /** @param {boolean} value */
  function setQuietMode(value) {
    quietMode = Boolean(value);
  }

  /** @param {import("@wubble/manifest").ResolvedFeedbackPolicy} policy */
  function makeRoom(policy) {
    if (activePlayback.size < maxConcurrentSounds) return true;
    if (policy.interruptPolicy === "never") return false;
    const candidate = [...activePlayback.entries()]
      .filter(([, value]) => policy.interruptPolicy === "always" || feedbackPriorityRank(value.priority) < feedbackPriorityRank(policy.priority))
      .sort(([, left], [, right]) => feedbackPriorityRank(left.priority) - feedbackPriorityRank(right.priority))[0];
    if (!candidate) return false;
    stopPlayback(candidate[0]);
    return true;
  }

  /** @param {{ stop: () => void | Promise<void> }} playback */
  function stopPlayback(playback) {
    activePlayback.delete(playback);
    void Promise.resolve(playback.stop()).catch(reportError);
  }

  /** @param {unknown} error */
  function reportError(error) {
    if (typeof options.onError === "function") options.onError(error);
  }

  return Object.freeze({
    unlock,
    play,
    stopAll,
    setEnabled,
    setHapticsEnabled,
    setVolume,
    setReducedFeedback,
    setQuietMode,
    getState: () => ({ enabled, hapticsEnabled, unlocked: true, volume, reducedFeedback, quietMode, activeSounds: activePlayback.size }),
    tap: () => play("tap"),
    toggleOn: () => play("toggleOn"),
    toggleOff: () => play("toggleOff"),
    select: () => play("select"),
    open: () => play("open"),
    close: () => play("close"),
    navigate: () => play("navigate"),
    success: () => play("success"),
    error: () => play("error"),
    warning: () => play("warning"),
    notify: () => play("notify"),
    send: () => play("send"),
    receive: () => play("receive"),
    processing: () => play("processing"),
    complete: () => play("complete"),
    deleteConfirm: () => play("deleteConfirm")
  });
}

/** @param {import("@wubble/manifest").FeedbackAssetVariant} asset @param {(mimeType: string) => boolean | string} canPlayType */
function selectPlayableSource(asset, canPlayType) {
  for (const source of asset.sources ?? []) {
    if (canPlayType(source.mimeType)) return source;
  }
  return asset;
}

/** @param {number} value */
function clamp(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
