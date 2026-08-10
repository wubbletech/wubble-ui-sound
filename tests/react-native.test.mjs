import assert from "node:assert/strict";
import test from "node:test";
import { createNativeFeedbackClient } from "../packages/react-native/src/index.js";

const manifest = {
  schemaVersion: 1,
  pack: { id: "signal", revision: 1 },
  defaults: { maxConcurrentSounds: 1 },
  events: {
    tap: { file: "tap.mp3", durationMs: 120, sha256: "tap", policy: { cooldownMs: 1_000, priority: "low", intensity: "subtle" } },
    success: { file: "success.mp3", durationMs: 260, sha256: "success", policy: { priority: "high", interruptPolicy: "lower-priority", hapticIntent: "success" } },
    select: {
      file: "select.mp3",
      durationMs: 120,
      sha256: "select",
      sources: [{ file: "select.webm", mimeType: "audio/webm; codecs=opus", durationMs: 120, sha256: "select-opus" }]
    }
  }
};

test("native feedback is local, opt-in, and shares web policy semantics", async () => {
  const calls = [];
  const haptics = [];
  const handles = [];
  const feedback = createNativeFeedbackClient(manifest, {
    assets: (file) => ({ local: file }),
    audio: {
      async play(asset, options) {
        let resolveFinished;
        const handle = {
          stopped: false,
          finished: new Promise((resolve) => { resolveFinished = resolve; }),
          stop() {
            this.stopped = true;
            resolveFinished();
          }
        };
        handles.push(handle);
        calls.push({ asset, options, handle });
        return handle;
      }
    },
    haptics: { trigger: (intent, event) => haptics.push([intent, event]) },
    canPlayType: (mimeType) => mimeType === "audio/webm; codecs=opus"
  });

  assert.deepEqual(await feedback.tap(), { played: false, reason: "disabled" });
  feedback.setEnabled(true);
  assert.deepEqual(await feedback.tap(), { played: true });
  assert.deepEqual(calls.at(-1).asset, { local: "tap.mp3" });
  assert.deepEqual(await feedback.tap(), { played: false, reason: "cooldown" });

  feedback.setReducedFeedback(true);
  assert.deepEqual(await feedback.tap(), { played: false, reason: "reduced-feedback" });
  feedback.setReducedFeedback(false);
  assert.deepEqual(await feedback.success(), { played: true });
  assert.equal(handles.at(-2).stopped, true);
  assert.deepEqual(haptics, [["success", "success"]]);

  feedback.setHapticsEnabled(false);
  feedback.stopAll();
  assert.deepEqual(await feedback.success(), { played: true });
  assert.deepEqual(haptics, [["success", "success"]]);
  assert.equal(feedback.getState().hapticsEnabled, false);

  feedback.stopAll();
  assert.equal(feedback.getState().activeSounds, 0);
  assert.deepEqual(await feedback.select(), { played: true });
  assert.deepEqual(calls.at(-1).asset, { local: "select.webm" });
});

test("native feedback reports unavailable assets and audio bridge failures", async () => {
  const errors = [];
  const feedback = createNativeFeedbackClient(manifest, {
    assets: () => undefined,
    audio: { play: async () => { throw new Error("must not run"); } },
    enabled: true,
    onError: (error) => errors.push(error)
  });
  assert.deepEqual(await feedback.success(), { played: false, reason: "unavailable" });
  assert.equal(errors.length, 0);

  const failing = createNativeFeedbackClient(manifest, {
    assets: (file) => file,
    audio: { play: async () => { throw new Error("native playback failed"); } },
    enabled: true,
    onError: (error) => errors.push(error)
  });
  assert.deepEqual(await failing.success(), { played: false, reason: "playback-failed" });
  assert.match(errors.at(-1).message, /native playback failed/);
});
