import type { FormantEstimate } from "./liveFormants";

export interface LiveFormantSmootherState {
  estimate: FormantEstimate;
  history: FormantEstimate[];
}

export interface SmoothedLiveEstimate {
  estimate: FormantEstimate;
  state: LiveFormantSmootherState;
  includeInTrail: boolean;
}

const HISTORY_SIZE = 5;
const MIN_TRAIL_CONFIDENCE = 0.2;

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function normalizedDistance(
  f1: number,
  f2: number,
  reference: FormantEstimate,
): number {
  return Math.hypot((f1 - reference.f1) / 300, (f2 - reference.f2) / 750);
}

/**
 * Stabilize what is drawn without feeding the filtered point back into LPC
 * candidate selection. A rolling median removes isolated pole swaps, while a
 * confidence-weighted EMA preserves sustained vowel movement within a few
 * overlapping frames.
 */
export function smoothLiveEstimate(
  next: FormantEstimate,
  previous: LiveFormantSmootherState | null,
): SmoothedLiveEstimate {
  if (!previous) {
    return {
      estimate: next,
      state: { estimate: next, history: next.confidence >= MIN_TRAIL_CONFIDENCE ? [next] : [] },
      includeInTrail: next.confidence >= MIN_TRAIL_CONFIDENCE,
    };
  }

  if (next.confidence < MIN_TRAIL_CONFIDENCE) {
    return { estimate: previous.estimate, state: previous, includeInTrail: false };
  }

  const rawJump = normalizedDistance(next.f1, next.f2, previous.estimate);
  // Large, weak one-frame moves are typically an F2/F3 swap. A real vowel
  // trajectory is allowed through as a sequence of smaller, voiced changes.
  if (rawJump > 2.15 && next.confidence < 0.72) {
    return { estimate: previous.estimate, state: previous, includeInTrail: false };
  }

  const history = [...previous.history, next].slice(-HISTORY_SIZE);
  const centerF1 = median(history.map((estimate) => estimate.f1));
  const centerF2 = median(history.map((estimate) => estimate.f2));
  const alpha = 0.24 + 0.46 * Math.min(1, next.confidence);
  const estimate: FormantEstimate = {
    ...next,
    f1: previous.estimate.f1 + alpha * (centerF1 - previous.estimate.f1),
    f2: previous.estimate.f2 + alpha * (centerF2 - previous.estimate.f2),
  };

  return {
    estimate,
    state: { estimate, history },
    includeInTrail: true,
  };
}
