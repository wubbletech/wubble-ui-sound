import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectories = [
  path.resolve(currentDirectory, "../examples/vanilla/public/wubble/signal"),
  path.resolve(currentDirectory, "../examples/nextjs/public/wubble/signal")
];
const nextManifestModulePath = path.resolve(currentDirectory, "../examples/nextjs/src/lib/signal-manifest.js");
const sampleRate = 16_000;

// These deterministic reference signals exercise the complete SDK contract.
// They are test fixtures, not the production Wubble sound library.
const signalDesigns = {
  tap: { durationMs: 90, notes: [760], decay: 42, gain: 0.36 },
  toggleOn: { durationMs: 110, notes: [520, 720], decay: 29, gain: 0.28 },
  toggleOff: { durationMs: 110, notes: [720, 500], decay: 29, gain: 0.28 },
  select: { durationMs: 120, notes: [630], decay: 27, gain: 0.28 },
  open: { durationMs: 150, notes: [430, 610], decay: 20, gain: 0.24 },
  close: { durationMs: 140, notes: [610, 420], decay: 21, gain: 0.24 },
  navigate: { durationMs: 120, notes: [690], decay: 24, gain: 0.25 },
  success: { durationMs: 280, notes: [520, 730, 910], decay: 12, gain: 0.25 },
  error: { durationMs: 210, notes: [260, 210], decay: 14, gain: 0.28, detune: -22 },
  warning: { durationMs: 240, notes: [390, 470], decay: 13, gain: 0.26 },
  notify: { durationMs: 180, notes: [720, 900], decay: 18, gain: 0.22 },
  send: { durationMs: 140, notes: [560, 790], decay: 22, gain: 0.24 },
  receive: { durationMs: 170, notes: [790, 560], decay: 18, gain: 0.23 },
  processing: { durationMs: 360, notes: [390, 460, 520], decay: 9, gain: 0.15 },
  complete: { durationMs: 300, notes: [490, 660, 820], decay: 12, gain: 0.24 },
  deleteConfirm: { durationMs: 250, notes: [360, 270], decay: 12, gain: 0.22, detune: -16 }
};

const feedbackPolicies = {
  tap: { cooldownMs: 110, priority: "low", intensity: "subtle", hapticIntent: "selection" },
  toggleOn: { cooldownMs: 130, priority: "low", intensity: "subtle", hapticIntent: "selection" },
  toggleOff: { cooldownMs: 130, priority: "low", intensity: "subtle", hapticIntent: "selection" },
  select: { cooldownMs: 120, priority: "low", intensity: "subtle", hapticIntent: "selection" },
  open: { cooldownMs: 140, priority: "low", intensity: "subtle" },
  close: { cooldownMs: 140, priority: "low", intensity: "subtle" },
  navigate: { cooldownMs: 120, priority: "low", intensity: "subtle" },
  success: { cooldownMs: 250, priority: "high", interruptPolicy: "lower-priority", hapticIntent: "success" },
  error: { cooldownMs: 350, priority: "high", interruptPolicy: "always", intensity: "pronounced", hapticIntent: "error" },
  warning: { cooldownMs: 300, priority: "high", interruptPolicy: "lower-priority", hapticIntent: "warning" },
  notify: { cooldownMs: 280, priority: "normal" },
  send: { cooldownMs: 160, priority: "normal" },
  receive: { cooldownMs: 180, priority: "normal" },
  processing: { cooldownMs: 600, priority: "low", intensity: "subtle" },
  complete: { cooldownMs: 300, priority: "high", interruptPolicy: "lower-priority", hapticIntent: "success" },
  deleteConfirm: { cooldownMs: 320, priority: "high", interruptPolicy: "lower-priority", hapticIntent: "warning" }
};

const signals = Object.fromEntries(
  Object.entries(signalDesigns).map(([eventName, design]) => [
    eventName,
    { durationMs: design.durationMs, samples: createReferenceSignal(design) }
  ])
);

const events = {};
for (const [eventName, signal] of Object.entries(signals)) {
  const file = `${eventName}.wav`;
  const wav = createWav(signal.samples, sampleRate);
  events[eventName] = {
    file,
    durationMs: signal.durationMs,
    sha256: createHash("sha256").update(wav).digest("hex"),
    gain: signalDesigns[eventName].gain,
    policy: feedbackPolicies[eventName]
  };
}

const manifest = {
  schemaVersion: 1,
  pack: { id: "signal", revision: 1 },
  defaults: { gain: 0.55, maxConcurrentSounds: 1, policy: { interruptPolicy: "never", variantStrategy: "rotate" } },
  events
};

for (const outputDirectory of outputDirectories) {
  await mkdir(outputDirectory, { recursive: true });
  for (const [eventName, signal] of Object.entries(signals)) {
    await writeFile(path.join(outputDirectory, `${eventName}.wav`), createWav(signal.samples, sampleRate));
  }
  await writeFile(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

await writeFile(nextManifestModulePath, `export const signalManifest = ${JSON.stringify(manifest, null, 2)};\n`);

function createReferenceSignal({ durationMs, notes, decay, gain, detune = 0 }) {
  const durationSeconds = durationMs / 1_000;
  return synthesize(durationSeconds, (time) => {
    const noteIndex = Math.min(notes.length - 1, Math.floor((time / durationSeconds) * notes.length));
    const noteTime = time - (noteIndex * durationSeconds) / notes.length;
    const frequency = notes[noteIndex] + detune * (time / durationSeconds);
    const envelope = Math.min(1, noteTime * 180) * Math.exp(-decay * noteTime);
    return Math.sin(2 * Math.PI * frequency * noteTime) * envelope * gain;
  });
}

function synthesize(durationSeconds, sampleAt) {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.max(-1, Math.min(1, sampleAt(index / sampleRate)));
    samples[index] = Math.round(value * 32_767);
  }
  return samples;
}

function createWav(samples, rate) {
  const bytesPerSample = 2;
  const buffer = Buffer.alloc(44 + samples.length * bytesPerSample);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * bytesPerSample, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * bytesPerSample, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * bytesPerSample);
  }
  return buffer;
}
