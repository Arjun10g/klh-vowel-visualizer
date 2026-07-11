export interface PitchEstimate {
  hz: number;
  clarity: number;
}

export function rootMeanSquare(samples: Float32Array<ArrayBufferLike>): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}

export function dbfs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/**
 * Normalized autocorrelation pitch estimate for ordinary speaking voices.
 * The caller should treat a null result as unvoiced or too quiet.
 */
export function estimatePitch(
  samples: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  minHz = 70,
  maxHz = 400,
): PitchEstimate | null {
  if (samples.length < 320 || rootMeanSquare(samples) < 0.008) return null;

  const edge = Math.floor(samples.length * 0.05);
  const start = edge;
  const end = samples.length - edge;
  let mean = 0;
  for (let index = start; index < end; index++) mean += samples[index];
  mean /= Math.max(1, end - start);

  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.floor(sampleRate / minHz), end - start - 2);
  const scores: number[] = [];
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = start; index < end - lag; index++) {
      const left = samples[index] - mean;
      const right = samples[index + lag] - mean;
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const score = dot / Math.sqrt(leftEnergy * rightEnergy || 1e-12);
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
    }
  }

  if (bestScore < 0.58) return null;
  const minimumPeakScore = Math.max(0.58, bestScore * 0.9);
  let bestLag = 0;
  // Harmonics and subharmonics can be almost as correlated as the true period.
  // The first strong local peak is the fundamental for the voice range above.
  for (let index = 1; index < scores.length - 1; index++) {
    const score = scores[index];
    if (score >= minimumPeakScore && score >= scores[index - 1] && score > scores[index + 1]) {
      bestLag = minLag + index;
      break;
    }
  }
  if (bestLag === 0) return null;
  return { hz: sampleRate / bestLag, clarity: bestScore };
}

export function spectralCentroid(
  frequencyDb: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  fftSize: number,
): number | null {
  let weighted = 0;
  let total = 0;
  const binHz = sampleRate / fftSize;
  for (let index = 0; index < frequencyDb.length; index++) {
    const db = frequencyDb[index];
    if (!Number.isFinite(db) || db <= -110) continue;
    const magnitude = 10 ** (db / 20);
    weighted += index * binHz * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / total : null;
}
