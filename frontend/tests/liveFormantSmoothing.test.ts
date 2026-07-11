import assert from "node:assert/strict";

import {
  smoothLiveEstimate,
  type LiveFormantSmootherState,
} from "../src/lib/liveFormantSmoothing";
import type { FormantEstimate } from "../src/lib/liveFormants";

function estimate(f1: number, f2: number, confidence = 0.9): FormantEstimate {
  return { f1, f2, confidence, rms: 0.08 };
}

let state: LiveFormantSmootherState | null = null;
function push(next: FormantEstimate) {
  const result = smoothLiveEstimate(next, state);
  state = result.state;
  return result;
}

const initial = push(estimate(500, 1500));
assert.equal(initial.includeInTrail, true);

const isolatedJump = push(estimate(900, 3000, 0.3));
assert.equal(isolatedJump.includeInTrail, false);
assert.equal(isolatedJump.estimate.f1, 500);
assert.equal(isolatedJump.estimate.f2, 1500);

push(estimate(540, 1650));
push(estimate(590, 1800));
const sustainedMovement = push(estimate(640, 1950));
assert.equal(sustainedMovement.includeInTrail, true);
assert.ok(sustainedMovement.estimate.f1 > 550);
assert.ok(sustainedMovement.estimate.f2 > 1650);

const lowConfidence = push(estimate(700, 2600, 0.1));
assert.equal(lowConfidence.includeInTrail, false);
assert.equal(lowConfidence.estimate.f1, sustainedMovement.estimate.f1);
assert.equal(lowConfidence.estimate.f2, sustainedMovement.estimate.f2);

console.log("Live formant display smoothing checks passed.");
