import assert from "node:assert/strict";

import { dbfs, estimatePitch, rootMeanSquare, spectralCentroid } from "../src/lib/liveAudio";

const sampleRate = 44_100;
const frequency = 220;
const amplitude = 0.25;
const samples = new Float32Array(4096);
for (let index = 0; index < samples.length; index++) {
  samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
}

const rms = rootMeanSquare(samples);
assert.ok(Math.abs(rms - amplitude / Math.sqrt(2)) < 0.002);
assert.ok(Math.abs(dbfs(rms) + 15.05) < 0.15);

const pitch = estimatePitch(samples, sampleRate);
assert.ok(pitch);
assert.ok(Math.abs(pitch.hz - frequency) < 2);
assert.ok(pitch.clarity > 0.95);
assert.equal(estimatePitch(new Float32Array(2048), sampleRate), null);

const spectrum = new Float32Array(1024).fill(-110);
spectrum[20] = -20;
const centroid = spectralCentroid(spectrum, sampleRate, 2048);
assert.ok(centroid);
assert.ok(Math.abs(centroid - (20 * sampleRate) / 2048) < 5);

console.log("Live audio signal checks passed.");
