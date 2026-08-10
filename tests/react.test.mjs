import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider, FeedbackSettings, runFeedbackAction } from "../packages/react/src/index.js";

const manifest = {
  schemaVersion: 1,
  pack: { id: "signal", revision: 1 },
  events: {
    tap: { file: "tap.wav", durationMs: 120, sha256: "hash" }
  }
};

test("React feedback controls render during SSR without browser access", () => {
  const output = renderToStaticMarkup(
    createElement(
      FeedbackProvider,
      { manifest },
      createElement(FeedbackSettings, { label: "Product sounds" })
    )
  );

  assert.match(output, /Product sounds/);
  assert.match(output, /<legend>Product sounds<\/legend>/);
  assert.match(output, /Enable sounds/);
  assert.match(output, /type="checkbox"/);
  assert.match(output, /Quiet context/);
  assert.match(output, /type="range"/);
});

test("async product actions preserve visible state transitions when audio is unavailable", async () => {
  const states = [];
  const events = [];
  const play = async (event) => {
    events.push(event);
    return { played: false, reason: "disabled" };
  };

  const result = await runFeedbackAction({
    play,
    action: async () => "saved without audio",
    onStateChange: (state) => states.push(state)
  });

  assert.equal(result, "saved without audio");
  assert.deepEqual(events, ["processing", "success"]);
  assert.deepEqual(states, ["pending", "success"]);
});

test("the reference product flow remains operable while sound is off", async () => {
  const source = await readFile(new URL("../examples/nextjs/app/feedback-demo.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /disabled=\{!enabled/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Draft saved\. Visual confirmation remains available with sound off\./);
});

test("async feedback plays pending and success or error around a product action", async () => {
  const events = [];
  const states = [];
  const play = async (event) => {
    events.push(event);
    return { played: true };
  };

  const result = await runFeedbackAction({
    play,
    action: async () => "saved",
    onStateChange: (state) => states.push(state)
  });
  assert.equal(result, "saved");
  assert.deepEqual(events, ["processing", "success"]);
  assert.deepEqual(states, ["pending", "success"]);

  await assert.rejects(
    runFeedbackAction({
      play,
      action: async () => { throw new Error("invalid"); },
      onStateChange: (state) => states.push(state)
    }),
    /invalid/
  );
  assert.deepEqual(events, ["processing", "success", "processing", "error"]);
  assert.deepEqual(states, ["pending", "success", "pending", "error"]);
});
