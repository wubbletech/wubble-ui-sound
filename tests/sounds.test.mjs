import assert from "node:assert/strict";
import test from "node:test";

const calls = [];
let autoEnd = true;

class FakeAudio {
  constructor(source) {
    this.source = source;
    this.volume = 1;
    this.preload = "";
    this.currentTime = 0;
    this.listeners = new Map();
    calls.push(this);
  }

  addEventListener(eventName, listener) {
    this.listeners.set(eventName, listener);
  }

  async play() {
    if (autoEnd) this.listeners.get("ended")?.();
  }

  pause() {
    this.paused = true;
  }
}

class FakeAudioContext {
  async resume() {}
  async close() {}
}

globalThis.window = { AudioContext: FakeAudioContext };
globalThis.Audio = FakeAudio;

const { createFeedbackClient } = await import("../packages/sounds/src/index.js");

const manifest = {
  schemaVersion: 1,
  pack: { id: "signal", revision: 1 },
  defaults: { gain: 0.5, maxConcurrentSounds: 1 },
  events: {
    tap: { file: "tap.wav", durationMs: 120, sha256: "hash", gain: 0.5 }
  }
};

test("sound playback is disabled until a user enables it, then unlocks on first playback", async () => {
  calls.length = 0;
  autoEnd = true;
  const feedback = createFeedbackClient(manifest, { baseUrl: "/wubble/signal" });

  assert.deepEqual(await feedback.tap(), { played: false, reason: "disabled" });
  feedback.setEnabled(true);
  assert.deepEqual(await feedback.tap(), { played: true });
  assert.equal(feedback.getState().unlocked, true);
  assert.equal(calls.at(-1).source, "/wubble/signal/tap.wav");
  assert.equal(calls.at(-1).volume, 0.25);
});

test("policy suppresses frequent cues, respects quiet preferences, and interrupts lower-priority audio", async () => {
  calls.length = 0;
  autoEnd = false;
  const policyManifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    defaults: { maxConcurrentSounds: 1 },
    events: {
      tap: { file: "tap.wav", durationMs: 120, sha256: "tap", policy: { cooldownMs: 1_000, priority: "low", intensity: "subtle" } },
      processing: { file: "processing.wav", durationMs: 360, sha256: "processing", policy: { priority: "low" } },
      success: { file: "success.wav", durationMs: 280, sha256: "success", policy: { priority: "high", interruptPolicy: "lower-priority", hapticIntent: "success" } },
      select: { file: "select.wav", durationMs: 120, sha256: "select", policy: { priority: "low" } }
    }
  };
  const haptics = [];
  const feedback = createFeedbackClient(policyManifest, { enabled: true, onHapticIntent: (...value) => haptics.push(value) });
  await feedback.unlock();

  assert.deepEqual(await feedback.tap(), { played: true });
  assert.deepEqual(await feedback.tap(), { played: false, reason: "cooldown" });
  feedback.setReducedFeedback(true);
  assert.deepEqual(await feedback.select(), { played: false, reason: "reduced-feedback" });
  feedback.setReducedFeedback(false);
  feedback.setQuietMode(true);
  assert.deepEqual(await feedback.select(), { played: false, reason: "quiet-mode" });
  feedback.setQuietMode(false);
  feedback.stopAll();

  assert.deepEqual(await feedback.processing(), { played: true });
  const processingAudio = calls.at(-1);
  assert.deepEqual(await feedback.success(), { played: true });
  assert.equal(processingAudio.paused, true);
  assert.deepEqual(haptics, [["success", "success"]]);
  autoEnd = true;
});

test("policy rotates declared asset variants", async () => {
  calls.length = 0;
  autoEnd = true;
  const variantManifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    defaults: { maxConcurrentSounds: 1 },
    events: {
      tap: {
        file: "tap-a.wav",
        durationMs: 120,
        sha256: "tap-a",
        policy: { variantStrategy: "rotate" },
        variants: [{ file: "tap-b.wav", durationMs: 120, sha256: "tap-b" }]
      }
    }
  };
  const feedback = createFeedbackClient(variantManifest, { enabled: true, baseUrl: "/wubble" });
  await feedback.unlock();

  await feedback.tap();
  await feedback.tap();
  assert.deepEqual(calls.map((audio) => audio.source), ["/wubble/tap-a.wav", "/wubble/tap-b.wav"]);
});

test("playback uses a supported local codec source before the primary asset", async () => {
  calls.length = 0;
  autoEnd = true;
  const codecManifest = {
    schemaVersion: 1,
    pack: { id: "signal", revision: 1 },
    events: {
      tap: {
        file: "tap.mp3",
        durationMs: 120,
        sha256: "mp3",
        sources: [{ file: "tap.webm", mimeType: "audio/webm; codecs=opus", durationMs: 120, sha256: "opus" }]
      }
    }
  };
  const feedback = createFeedbackClient(codecManifest, { enabled: true, baseUrl: "/wubble", canPlayType: (mimeType) => mimeType === "audio/webm; codecs=opus" });
  await feedback.unlock();
  assert.deepEqual(await feedback.tap(), { played: true });
  assert.equal(calls.at(-1).source, "/wubble/tap.webm");

  const fallback = createFeedbackClient(codecManifest, { enabled: true, baseUrl: "/wubble", canPlayType: () => false });
  await fallback.unlock();
  assert.deepEqual(await fallback.tap(), { played: true });
  assert.equal(calls.at(-1).source, "/wubble/tap.mp3");
});
