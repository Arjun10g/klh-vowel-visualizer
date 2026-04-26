interface Complex {
  re: number;
  im: number;
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
  const den = b.re * b.re + b.im * b.im || 1e-12;
  return {
    re: (a.re * b.re + a.im * b.im) / den,
    im: (a.im * b.re - a.re * b.im) / den,
  };
}

function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

function evalPolynomial(coeffs: number[], z: Complex): Complex {
  let out: Complex = { re: coeffs[0], im: 0 };
  for (let i = 1; i < coeffs.length; i++) {
    out = cAdd(cMul(out, z), { re: coeffs[i], im: 0 });
  }
  return out;
}

function polynomialRoots(coeffs: number[]): Complex[] {
  const degree = coeffs.length - 1;
  const roots = Array.from({ length: degree }, (_, i) => {
    const theta = (2 * Math.PI * i) / degree;
    return { re: 0.55 * Math.cos(theta), im: 0.55 * Math.sin(theta) };
  });

  for (let iter = 0; iter < 70; iter++) {
    let maxStep = 0;
    for (let i = 0; i < roots.length; i++) {
      let denom: Complex = { re: 1, im: 0 };
      for (let j = 0; j < roots.length; j++) {
        if (i !== j) denom = cMul(denom, cSub(roots[i], roots[j]));
      }
      const step = cDiv(evalPolynomial(coeffs, roots[i]), denom);
      roots[i] = cSub(roots[i], step);
      maxStep = Math.max(maxStep, cAbs(step));
    }
    if (maxStep < 1e-7) break;
  }
  return roots;
}

function downsample(
  input: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  maxFrequency: number,
): { data: Float32Array<ArrayBufferLike>; sampleRate: number } {
  const targetRate = Math.min(16000, Math.max(8000, maxFrequency * 2.35));
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  if (factor === 1) return { data: input, sampleRate };
  const length = Math.floor(input.length / factor);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += input[i * factor + j];
    out[i] = sum / factor;
  }
  return { data: out, sampleRate: sampleRate / factor };
}

function autocorrelation(frame: Float32Array<ArrayBufferLike>, order: number): number[] {
  const out = new Array<number>(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let i = lag; i < frame.length; i++) sum += frame[i] * frame[i - lag];
    out[lag] = sum;
  }
  return out;
}

function levinsonDurbin(r: number[], order: number): number[] | null {
  let err = r[0];
  if (!Number.isFinite(err) || err <= 1e-9) return null;
  let a = new Array<number>(order + 1).fill(0);
  a[0] = 1;

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    if (!Number.isFinite(k) || Math.abs(k) >= 1) return null;
    const next = a.slice();
    next[i] = k;
    for (let j = 1; j < i; j++) next[j] = a[j] + k * a[i - j];
    err *= 1 - k * k;
    if (!Number.isFinite(err) || err <= 1e-9) return null;
    a = next;
  }
  return a;
}

function estimateFormantsOnce(
  frameIn: Float32Array<ArrayBufferLike>,
  sampleRateIn: number,
  options: Required<Pick<FormantEstimateOptions, "maxFrequency" | "lpcOrder">> &
    Pick<FormantEstimateOptions, "previous" | "target">,
): FormantCandidate | null {
  const { maxFrequency, lpcOrder, previous, target } = options;
  const { data, sampleRate } = downsample(frameIn, sampleRateIn, maxFrequency);
  if (data.length < 512) return null;

  let mean = 0;
  for (const sample of data) mean += sample;
  mean /= data.length;

  const frame = new Float32Array(data.length);
  let rmsSum = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const centered = data[i] - mean;
    const emphasized = centered - 0.97 * last;
    last = centered;
    const windowed = emphasized * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (data.length - 1)));
    frame[i] = windowed;
    rmsSum += centered * centered;
  }
  const rms = Math.sqrt(rmsSum / data.length);
  if (rms < 0.012) return null;

  const lpc = levinsonDurbin(autocorrelation(frame, lpcOrder), lpcOrder);
  if (!lpc) return null;

  const candidates = polynomialRoots(lpc)
    .filter((root) => root.im >= 0.01)
    .map((root) => {
      const freq = (Math.atan2(root.im, root.re) * sampleRate) / (2 * Math.PI);
      const bandwidth = (-Math.log(Math.max(cAbs(root), 1e-6)) * sampleRate) / Math.PI;
      return { freq, bandwidth };
    })
    .filter(({ freq, bandwidth }) =>
      Number.isFinite(freq) &&
      Number.isFinite(bandwidth) &&
      freq >= 180 &&
      freq <= maxFrequency &&
      bandwidth > 20 &&
      bandwidth <= 900
    )
    .sort((a, b) => a.freq - b.freq);

  let best: { f1: { freq: number; bandwidth: number }; f2: { freq: number; bandwidth: number }; cost: number } | null = null;
  for (const f1 of candidates) {
    if (f1.freq < 220 || f1.freq > 1200) continue;
    for (const f2 of candidates) {
      if (f2.freq < Math.max(650, f1.freq + 250) || f2.freq > maxFrequency) continue;
      let cost = (f1.bandwidth + f2.bandwidth) / 1800;
      cost += Math.abs(f2.freq - f1.freq - 900) / 5000;
      if (previous) {
        cost += Math.abs(f1.freq - previous.f1) / 900;
        cost += Math.abs(f2.freq - previous.f2) / 1300;
      }
      if (target) {
        cost += Math.abs(f1.freq - target.f1) / 700;
        cost += Math.abs(f2.freq - target.f2) / 900;
        if (target.f2 < 1500 && f2.freq > 2200) cost += 1.4;
      }
      if (!best || cost < best.cost) best = { f1, f2, cost };
    }
  }
  if (!best) return null;

  return {
    f1: best.f1.freq,
    f2: best.f2.freq,
    rms,
    confidence:
      Math.min(1, rms / 0.08) *
      Math.max(0.15, 1 - (best.f1.bandwidth + best.f2.bandwidth) / 1800) *
      Math.max(0.2, 1 - best.cost / 5),
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
  const lpcOrder = options.lpcOrder ?? 12;
  if (options.mode !== "multi") {
    return estimateFormantsOnce(frameIn, sampleRateIn, {
      maxFrequency,
      lpcOrder,
      previous: options.previous ?? null,
      target: options.target ?? null,
    });
  }

  const maxFrequencies = [...new Set([
    Math.max(3000, maxFrequency - 1000),
    Math.max(3000, maxFrequency - 500),
    maxFrequency,
    Math.min(6500, maxFrequency + 500),
    Math.min(6500, maxFrequency + 1000),
  ])];
  const orders = [...new Set([
    Math.max(8, lpcOrder - 2),
    lpcOrder,
    Math.min(18, lpcOrder + 2),
  ])];

  let best: FormantCandidate | null = null;
  for (const candidateMax of maxFrequencies) {
    for (const candidateOrder of orders) {
      const candidate = estimateFormantsOnce(frameIn, sampleRateIn, {
        maxFrequency: candidateMax,
        lpcOrder: candidateOrder,
        previous: options.previous ?? null,
        target: options.target ?? null,
      });
      if (!candidate) continue;
      if (!best || candidate.cost < best.cost) best = candidate;
    }
  }
  return best;
}
