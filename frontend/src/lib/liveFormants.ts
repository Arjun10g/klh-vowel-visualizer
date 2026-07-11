interface Complex {
  re: number;
  im: number;
}

interface PreparedFrame {
  data: Float32Array<ArrayBufferLike>;
  sampleRate: number;
  rms: number;
}

export interface FormantEstimate {
  f1: number;
  f2: number;
  rms: number;
  confidence: number;
  maxFrequency?: number;
  lpcOrder?: number;
}

export interface FormantTarget {
  f1: number;
  f2: number;
}

export interface FormantEstimateOptions {
  mode?: "single" | "multi";
  maxFrequency?: number;
  lpcOrder?: number;
  previous?: FormantTarget | null;
  target?: FormantTarget | null;
}

interface FormantCandidate extends FormantEstimate {
  cost: number;
}

export const LIVE_FORMANT_FRAME_SIZE = 2048;
export const LIVE_FORMANT_FRAME_HOP = 1024;

const MIN_ANALYSIS_SAMPLES = 320;
const PRE_EMPHASIS = 0.97;
const RESAMPLE_FILTER_RADIUS = 16;

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cDiv(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im || 1e-12;
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}

function cAbs(value: Complex): number {
  return Math.hypot(value.re, value.im);
}

function evaluatePolynomial(coefficients: number[], value: Complex): Complex {
  let output: Complex = { re: coefficients[0], im: 0 };
  for (let index = 1; index < coefficients.length; index++) {
    output = cAdd(cMul(output, value), { re: coefficients[index], im: 0 });
  }
  return output;
}

function polynomialRoots(coefficients: number[]): Complex[] {
  const degree = coefficients.length - 1;
  const roots = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree;
    return { re: 0.55 * Math.cos(angle), im: 0.55 * Math.sin(angle) };
  });

  for (let iteration = 0; iteration < 120; iteration++) {
    let maxStep = 0;
    for (let index = 0; index < roots.length; index++) {
      let denominator: Complex = { re: 1, im: 0 };
      for (let other = 0; other < roots.length; other++) {
        if (index !== other) denominator = cMul(denominator, cSub(roots[index], roots[other]));
      }
      const step = cDiv(evaluatePolynomial(coefficients, roots[index]), denominator);
      roots[index] = cSub(roots[index], step);
      maxStep = Math.max(maxStep, cAbs(step));
    }
    if (maxStep < 1e-7) break;
  }
  return roots;
}

/** Low-pass before decimation so upper resonances cannot alias into F1/F2. */
function downsample(
  input: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  maxFrequency: number,
): { data: Float32Array<ArrayBufferLike>; sampleRate: number } {
  const targetRate = Math.min(18000, Math.max(11000, maxFrequency * 2.6));
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  if (factor === 1) return { data: input, sampleRate };

  const outputRate = sampleRate / factor;
  const cutoff = Math.min(maxFrequency + 700, outputRate * 0.44);
  const normalizedCutoff = cutoff / sampleRate;
  const output = new Float32Array(Math.floor(input.length / factor));

  for (let outputIndex = 0; outputIndex < output.length; outputIndex++) {
    const center = outputIndex * factor;
    let sum = 0;
    let weight = 0;
    for (let tap = -RESAMPLE_FILTER_RADIUS; tap <= RESAMPLE_FILTER_RADIUS; tap++) {
      const inputIndex = center + tap;
      if (inputIndex < 0 || inputIndex >= input.length) continue;
      const lowPass = tap === 0
        ? 2 * normalizedCutoff
        : Math.sin(2 * Math.PI * normalizedCutoff * tap) / (Math.PI * tap);
      const window = 0.54 + 0.46 * Math.cos((Math.PI * tap) / RESAMPLE_FILTER_RADIUS);
      const coefficient = lowPass * window;
      sum += input[inputIndex] * coefficient;
      weight += coefficient;
    }
    output[outputIndex] = weight === 0 ? 0 : sum / weight;
  }
  return { data: output, sampleRate: outputRate };
}

function prepareFrame(
  frameIn: Float32Array<ArrayBufferLike>,
  sampleRateIn: number,
  maxFrequency: number,
): PreparedFrame | null {
  const { data, sampleRate } = downsample(frameIn, sampleRateIn, maxFrequency);
  if (data.length < MIN_ANALYSIS_SAMPLES) return null;

  let mean = 0;
  for (const sample of data) mean += sample;
  mean /= data.length;

  let rmsSum = 0;
  let last = 0;
  const windowed = new Float32Array(data.length);
  for (let index = 0; index < data.length; index++) {
    const centered = data[index] - mean;
    const emphasized = centered - PRE_EMPHASIS * last;
    last = centered;
    windowed[index] = emphasized * (0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (data.length - 1)));
    rmsSum += centered * centered;
  }
  const rms = Math.sqrt(rmsSum / data.length);
  return rms < 0.008 ? null : { data: windowed, sampleRate, rms };
}

function autocorrelation(frame: Float32Array<ArrayBufferLike>, order: number): number[] {
  const values = new Array<number>(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let index = lag; index < frame.length; index++) sum += frame[index] * frame[index - lag];
    values[lag] = sum;
  }
  return values;
}

function levinsonDurbin(correlation: number[], order: number): number[] | null {
  let error = correlation[0] * (1 + 1e-6);
  if (!Number.isFinite(error) || error <= 1e-9) return null;
  const coefficients = new Array<number>(order + 1).fill(0);
  coefficients[0] = 1;

  for (let currentOrder = 1; currentOrder <= order; currentOrder++) {
    let accumulator = correlation[currentOrder];
    for (let index = 1; index < currentOrder; index++) {
      accumulator += coefficients[index] * correlation[currentOrder - index];
    }
    const reflection = -accumulator / error;
    if (!Number.isFinite(reflection) || Math.abs(reflection) >= 1) return null;
    const next = coefficients.slice();
    next[currentOrder] = reflection;
    for (let index = 1; index < currentOrder; index++) {
      next[index] = coefficients[index] + reflection * coefficients[currentOrder - index];
    }
    error *= 1 - reflection * reflection;
    if (!Number.isFinite(error) || error <= 1e-9) return null;
    for (let index = 1; index <= currentOrder; index++) coefficients[index] = next[index];
  }
  return coefficients;
}

function estimateOnce(
  prepared: PreparedFrame,
  options: Required<Pick<FormantEstimateOptions, "maxFrequency" | "lpcOrder">> &
    Pick<FormantEstimateOptions, "previous" | "target">,
): FormantCandidate | null {
  const { maxFrequency, lpcOrder, previous, target } = options;
  const effectiveMax = Math.min(maxFrequency, prepared.sampleRate / 2 - 100);
  const lpc = levinsonDurbin(autocorrelation(prepared.data, lpcOrder), lpcOrder);
  if (!lpc) return null;

  const resonances = polynomialRoots(lpc)
    .filter((root) => root.im >= 0.01)
    .map((root) => ({
      freq: (Math.atan2(root.im, root.re) * prepared.sampleRate) / (2 * Math.PI),
      bandwidth: (-Math.log(Math.max(cAbs(root), 1e-6)) * prepared.sampleRate) / Math.PI,
    }))
    .filter(({ freq, bandwidth }) =>
      Number.isFinite(freq) &&
      Number.isFinite(bandwidth) &&
      freq >= 150 &&
      freq <= effectiveMax &&
      bandwidth >= 20 &&
      bandwidth <= 900,
    )
    .sort((a, b) => a.freq - b.freq);

  let best: { f1: { freq: number; bandwidth: number }; f2: { freq: number; bandwidth: number }; cost: number } | null = null;
  for (let f1Index = 0; f1Index < resonances.length; f1Index++) {
    const f1 = resonances[f1Index];
    if (f1.freq > 1300) continue;
    for (let f2Index = f1Index + 1; f2Index < resonances.length; f2Index++) {
      const f2 = resonances[f2Index];
      if (f2.freq < Math.max(500, f1.freq + 150) || f2.freq > effectiveMax) continue;
      let cost = (f1.bandwidth / 900) + (f2.bandwidth / 1200);
      cost += Math.abs(f2.freq - f1.freq - 1100) / 9000;
      // Prefer the first two resonances; this keeps a narrow F3/F4 pole from
      // being selected as F2 just because it has a smaller bandwidth.
      cost += f1Index * 0.55 + (f2Index - f1Index - 1) * 0.3;
      if (previous) {
        const movement = Math.hypot((f1.freq - previous.f1) / 650, (f2.freq - previous.f2) / 1200);
        cost += Math.min(0.45, movement * 0.16);
      }
      if (target) {
        const targetDistance = Math.hypot((f1.freq - target.f1) / 700, (f2.freq - target.f2) / 1100);
        // Corpus data resolves genuine ties, but never overrules the signal.
        cost += Math.min(0.2, targetDistance * 0.05);
      }
      if (!best || cost < best.cost) best = { f1, f2, cost };
    }
  }
  if (!best) return null;

  if (previous) {
    const f1Jump = Math.abs(best.f1.freq - previous.f1);
    const f2Jump = Math.abs(best.f2.freq - previous.f2);
    // A true vowel movement develops over several overlapping frames. A large
    // one-frame jump with no corresponding F1 movement is usually an F2/F3
    // pole swap, especially in back vowels with a low F2.
    if (f1Jump < 550 && f2Jump > 1050) {
      return {
        f1: previous.f1,
        f2: previous.f2,
        rms: prepared.rms,
        confidence: 0.08,
        maxFrequency,
        lpcOrder,
        cost: best.cost + 1,
      };
    }
  }

  const bandwidthQuality = Math.max(0.1, 1 - (best.f1.bandwidth + best.f2.bandwidth) / 1400);
  return {
    f1: best.f1.freq,
    f2: best.f2.freq,
    rms: prepared.rms,
    confidence:
      Math.min(1, prepared.rms / 0.06) *
      bandwidthQuality *
      Math.min(1, Math.max(0.2, 1 - best.cost / 2.5)),
    maxFrequency,
    lpcOrder,
    cost: best.cost,
  };
}

export function estimateFormants(
  frameIn: Float32Array<ArrayBufferLike>,
  sampleRateIn: number,
  options: FormantEstimateOptions = {},
): FormantEstimate | null {
  const maxFrequency = options.maxFrequency ?? 5000;
  const lpcOrder = options.lpcOrder ?? 14;
  const frequencyCeilings = options.mode === "multi"
    ? [...new Set([
        Math.max(3000, maxFrequency - 500),
        maxFrequency,
        Math.min(6500, maxFrequency + 500),
      ])]
    : [maxFrequency];
  const prepared = prepareFrame(frameIn, sampleRateIn, Math.max(...frequencyCeilings));
  if (!prepared) return null;
  const orders = options.mode === "multi"
    ? [...new Set([Math.max(8, lpcOrder - 6), Math.max(10, lpcOrder - 4), Math.max(12, lpcOrder - 2), lpcOrder, Math.min(20, lpcOrder + 2)])]
    : [lpcOrder];

  let best: FormantCandidate | null = null;
  for (const ceiling of frequencyCeilings) {
    for (const order of orders) {
      const candidate = estimateOnce(prepared, {
        maxFrequency: ceiling,
        lpcOrder: order,
        previous: options.previous ?? null,
        target: options.target ?? null,
      });
      if (!candidate) continue;
      candidate.cost += (Math.abs(order - lpcOrder) / 2) * 0.08;
      if (!best || candidate.cost < best.cost) best = candidate;
    }
  }

  if (best) return best;
  if (!options.previous) return null;
  // Keep a continuous trace through one uncertain voiced frame. The component
  // clears this prior after two consecutive unvoiced frames.
  return {
    ...options.previous,
    rms: prepared.rms,
    confidence: 0.08,
    maxFrequency,
    lpcOrder,
  };
}
