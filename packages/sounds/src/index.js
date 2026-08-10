import { assertValidManifest, feedbackPriorityRank, resolveFeedbackPolicy, selectFeedbackAsset } from "@wubble/manifest";

/**
 * Creates a feedback client that only plays customer-hosted static assets.
 * Playback is disabled by default. The first enabled playback attempt may unlock browser audio
 * when it is called directly from a user gesture.
 * @param {import("@wubble/manifest").FeedbackManifest} manifest
 * @param {{ baseUrl?: string, enabled?: boolean, volume?: number, reducedFeedback?: boolean, quietMode?: boolean, onError?: (error: unknown) => void, onHapticIntent?: (intent: string, event: string) => void, random?: () => number, canPlayType?: (mimeType: string) => boolean | string }} [options]
 */
export function createFeedbackClient(manifest, options = {}) {
  const validatedManifest = assertValidManifest(manifest);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "");
  const maxConcurrentSounds = validatedManifest.defaults?.maxConcurrentSounds ?? 1;
  let enabled = options.enabled ?? false;
  let volume = clamp(options.volume ?? validatedManifest.defaults?.gain ?? 0.5);
  let reducedFeedback = options.reducedFeedback ?? false;
  let quietMode = options.quietMode ?? false;
  let unlocked = false;
  const activeAudio = new Map();
  const lastPlayedAt = new Map();
  const variantCursor = new Map();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const canPlayType = typeof options.canPlayType === "function" ? options.canPlayType : browserCanPlayType;

  /**
   * Call this directly from a click, pointer, or keyboard handler before feedback is used.
   * @returns {Promise<boolean>}
   */
  async function unlock() {
    if (!hasBrowserAudio()) {
      return false;
    }

    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        const resume = context.resume();
        // Mark this client ready synchronously so an Audio element can start within the same
        // click or key handler that triggered the first feedback cue.
        unlocked = true;
        await resume;
        await context.close();
      } else {
        unlocked = true;
      }
      return true;
    } catch (error) {
      unlocked = false;
      reportError(error);
      return false;
    }
  }

  /** @param {import("@wubble/manifest").FeedbackEvent} eventName */
  async function play(eventName) {
    if (!enabled || !hasBrowserAudio()) {
      return { played: false, reason: enabled ? "locked" : "disabled" };
    }

    if (!unlocked) {
      void unlock();
      if (!unlocked) return { played: false, reason: "locked" };
    }

    const asset = validatedManifest.events[eventName];
    if (!asset) {
      return { played: false, reason: "unavailable" };
    }

    const policy = resolveFeedbackPolicy(validatedManifest.defaults?.policy, asset.policy);
    if (reducedFeedback && (policy.priority === "low" || policy.intensity === "subtle")) {
      return { played: false, reason: "reduced-feedback" };
    }

    if (quietMode && policy.priority === "low") {
      return { played: false, reason: "quiet-mode" };
    }

    const now = Date.now();
    const previousPlay = lastPlayedAt.get(eventName);
    if (previousPlay !== undefined && now - previousPlay < policy.cooldownMs) {
      return { played: false, reason: "cooldown" };
    }

    if (!makeRoom(policy)) {
      return { played: false, reason: "concurrency-limit" };
    }

    const selectedAsset = selectFeedbackAsset(eventName, asset, policy.variantStrategy, random, variantCursor);
    const playableAsset = selectPlayableSource(selectedAsset, canPlayType);
    const audio = new Audio(resolveAssetUrl(baseUrl, playableAsset.file));
    audio.preload = "auto";
    audio.volume = clamp(volume * (selectedAsset.gain ?? 1));
    activeAudio.set(audio, { eventName, priority: policy.priority });

    const release = () => activeAudio.delete(audio);
    audio.addEventListener("ended", release, { once: true });
    audio.addEventListener("error", release, { once: true });

    try {
      lastPlayedAt.set(eventName, now);
      await audio.play();
      if (policy.hapticIntent !== "none" && typeof options.onHapticIntent === "function") {
        options.onHapticIntent(policy.hapticIntent, eventName);
      }
      return { played: true };
    } catch (error) {
      release();
      if (lastPlayedAt.get(eventName) === now) lastPlayedAt.delete(eventName);
      reportError(error);
      return { played: false, reason: "playback-failed" };
    }
  }

  function stopAll() {
    for (const audio of activeAudio.keys()) {
      stopAudio(audio);
    }
    activeAudio.clear();
  }

  /** @param {boolean} value */
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      stopAll();
    }
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

  /** @param {import("@wubble/manifest").FeedbackPolicy} policy */
  function makeRoom(policy) {
    if (activeAudio.size < maxConcurrentSounds) return true;
    if (policy.interruptPolicy === "never") return false;

    const active = [...activeAudio.entries()];
    const candidate = active
      .filter(([, value]) => policy.interruptPolicy === "always" || feedbackPriorityRank(value.priority) < feedbackPriorityRank(policy.priority))
      .sort(([, left], [, right]) => feedbackPriorityRank(left.priority) - feedbackPriorityRank(right.priority))[0];
    if (!candidate) return false;
    stopAudio(candidate[0]);
    return true;
  }

  /** @param {HTMLAudioElement} audio */
  function stopAudio(audio) {
    audio.pause();
    audio.currentTime = 0;
    activeAudio.delete(audio);
  }

  function reportError(error) {
    if (typeof options.onError === "function") {
      options.onError(error);
    }
  }

  return Object.freeze({
    unlock,
    play,
    stopAll,
    setEnabled,
    setVolume,
    setReducedFeedback,
    setQuietMode,
    getState: () => ({ enabled, unlocked, volume, reducedFeedback, quietMode, activeSounds: activeAudio.size }),
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

/** @returns {boolean} */
function hasBrowserAudio() {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

/** @param {string} mimeType */
function browserCanPlayType(mimeType) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
  const probe = document.createElement("audio");
  return typeof probe.canPlayType === "function" && probe.canPlayType(mimeType) !== "";
}

/** @param {string} baseUrl */
function normalizeBaseUrl(baseUrl) {
  return baseUrl.length > 0 && !baseUrl.endsWith("/") ? `${baseUrl}/` : baseUrl;
}

/** @param {string} baseUrl @param {string} file */
function resolveAssetUrl(baseUrl, file) {
  return `${baseUrl}${file}`;
}

/** @param {number} value */
function clamp(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
