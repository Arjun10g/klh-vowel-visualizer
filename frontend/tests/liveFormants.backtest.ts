import {
  estimateFormants,
  LIVE_FORMANT_FRAME_HOP,
  LIVE_FORMANT_FRAME_SIZE,
  type FormantTarget,
} from "../src/lib/liveFormants";

interface ReferencePoint {
  f1: number;
  f2: number;
}

interface BacktestToken {
  speaker: string;
  filename: string;
  vowel: string;
  reference: ReferencePoint[];
}

interface BacktestWord {
  word: string;
  speaker: string;
  tokens: BacktestToken[];
}

interface WaveAudio {
  sampleRate: number;
  samples: Float32Array;
}

const AUDIO_BASE = "https://raw.githubusercontent.com/tkettig/KLHData/main";
const MAX_F1_MAE_HZ = 100;
const MAX_F2_MAE_HZ = 120;

// The reference tracks are the nine FastTrack measurements shipped with this
// app's parquet data. Tokens are ordered by their position in each word.
const BACKTEST_WORDS: BacktestWord[] = [
  {
    word: "aloha",
    speaker: "AA",
    tokens: [
      { speaker: "AA", filename: "KLH057a_0001", vowel: "a", reference: [[516.55, 1189.55], [523.1, 1210.5], [509.75, 1147.65], [535.5, 1101], [536.4, 1091.4], [515.5, 1073.8], [451.4, 1043.5], [396.1, 1030.1], [367.65, 1031.25]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "AA", filename: "KLH057a_0002", vowel: "o", reference: [[438.1, 934.2], [438.3, 807.1], [449.4, 776.2], [445.75, 779.7], [439.6, 767.1], [455.4, 755], [449.05, 698.25], [451.2, 691.8], [449, 734.5]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "AA", filename: "KLH057a_0003", vowel: "a", reference: [[442.4, 1004.6], [420.6, 1019.5], [414.2, 936.4], [437.4, 1005.5], [437.7, 1044.1], [441.7, 997.2], [429.45, 1045.55], [401.6, 1103.8], [394.2, 1163.8]].map(([f1, f2]) => ({ f1, f2 })) },
    ],
  },
  {
    word: "inoa",
    speaker: "LV",
    tokens: [
      { speaker: "LV", filename: "KLH032d_0029", vowel: "i", reference: [[447, 2683], [437, 2695], [417, 2688], [391, 2670.5], [373.5, 2663], [358, 2668], [346, 2685.5], [337, 2699.5], [326, 2713]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "LV", filename: "KLH032d_0030", vowel: "o", reference: [[338, 1584], [386, 1492], [381.5, 1351], [326, 1204], [282.5, 1124], [244, 1069], [219.5, 978], [209, 889], [208.5, 886.5]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "LV", filename: "KLH032d_0031", vowel: "a", reference: [[211, 923], [210.5, 962.5], [209.5, 994], [208, 1017.5], [208, 1037], [209, 1053], [208.5, 1064], [207.5, 1068], [205, 1059]].map(([f1, f2]) => ({ f1, f2 })) },
    ],
  },
  {
    word: "kauaʻi",
    speaker: "DK",
    tokens: [
      { speaker: "DK", filename: "KLH063b_0080", vowel: "au", reference: [[369.8, 1514.45], [386.1, 1357.3], [402.5, 1232.5], [385.6, 1097.6], [378.1, 988.8], [379.5, 933.6], [390.2, 942.3], [426.4, 867.8], [440.3, 1099.2]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "DK", filename: "KLH063b_0081", vowel: "a", reference: [[548.95, 1025.1], [503.4, 989.5], [504.15, 1043.45], [502.2, 1122.3], [485.1, 1239], [483, 1272.7], [492.25, 1340.85], [494.1, 1430.2], [469.1, 1494.7]].map(([f1, f2]) => ({ f1, f2 })) },
      { speaker: "DK", filename: "KLH063b_0082", vowel: "i", reference: [[371.5, 1630.15], [367, 1912.3], [356.35, 1990.8], [348.3, 2009.5], [342.6, 2019.1], [333.95, 1993.15], [323.2, 2005], [310.2, 1990.4], [296.6, 1938.55]].map(([f1, f2]) => ({ f1, f2 })) },
    ],
  },
];

function ascii(view: DataView, start: number, length: number): string {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(start + index))).join("");
}

function decodePcmWave(buffer: ArrayBuffer): WaveAudio {
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file.");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = 0;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkStart, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataLength = chunkLength;
      break;
    }
    offset = chunkStart + chunkLength + (chunkLength % 2);
  }

  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataLength === 0) {
    throw new Error("Backtest fixtures must be mono 16-bit PCM WAV files.");
  }

  const samples = new Float32Array(dataLength / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32768;
  }
  return { sampleRate, samples };
}

function analysisFrames(audio: WaveAudio): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let start = 0; start + LIVE_FORMANT_FRAME_SIZE <= audio.samples.length; start += LIVE_FORMANT_FRAME_HOP) {
    frames.push(audio.samples.slice(start, start + LIVE_FORMANT_FRAME_SIZE));
  }
  return frames;
}

function referenceAt(points: ReferencePoint[], progress: number): ReferencePoint {
  const position = Math.max(0, Math.min(points.length - 1, progress * points.length - 0.5));
  const lower = Math.floor(position);
  const upper = Math.min(points.length - 1, lower + 1);
  const mix = position - lower;
  return {
    f1: points[lower].f1 + (points[upper].f1 - points[lower].f1) * mix,
    f2: points[lower].f2 + (points[upper].f2 - points[lower].f2) * mix,
  };
}

async function fetchTokenAudio(token: BacktestToken): Promise<WaveAudio> {
  const url = `${AUDIO_BASE}/${token.speaker}/output${token.speaker === "LV" ? "_dissertation" : ""}/sounds/${token.filename}.wav`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${token.filename}: HTTP ${response.status}`);
  return decodePcmWave(await response.arrayBuffer());
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function run(): Promise<void> {
  const f1Errors: number[] = [];
  const f2Errors: number[] = [];
  const processingTimes: number[] = [];
  const wordResults: string[] = [];

  for (const word of BACKTEST_WORDS) {
    const wordF1Errors: number[] = [];
    const wordF2Errors: number[] = [];
    let previous: FormantTarget | null = null;

    for (const token of word.tokens) {
      const audio = await fetchTokenAudio(token);
      const frames = analysisFrames(audio);
      if (frames.length === 0) throw new Error(`No complete analysis frame for ${token.filename}.`);
      for (let index = 0; index < frames.length; index++) {
        const startedAt = performance.now();
        const estimate = estimateFormants(
          frames[index],
          audio.sampleRate,
          { mode: "multi", maxFrequency: 5000, lpcOrder: 14, previous },
        );
        processingTimes.push(performance.now() - startedAt);
        if (!estimate) throw new Error(`No estimate for ${word.word}: ${token.filename} point ${index + 1}.`);
        previous = estimate;
        const center = (index * LIVE_FORMANT_FRAME_HOP + LIVE_FORMANT_FRAME_SIZE / 2) / audio.samples.length;
        const reference = referenceAt(token.reference, center);
        wordF1Errors.push(Math.abs(estimate.f1 - reference.f1));
        wordF2Errors.push(Math.abs(estimate.f2 - reference.f2));
      }
    }

    f1Errors.push(...wordF1Errors);
    f2Errors.push(...wordF2Errors);
    wordResults.push(`${word.speaker} ${word.word}: F1 MAE ${mean(wordF1Errors).toFixed(0)} Hz, F2 MAE ${mean(wordF2Errors).toFixed(0)} Hz`);
  }

  console.log("Live formant backtest (recorded multi-vowel words)");
  for (const result of wordResults) console.log(result);
  const f1Mae = mean(f1Errors);
  const f2Mae = mean(f2Errors);
  console.log(`Overall: F1 MAE ${f1Mae.toFixed(0)} Hz, F2 MAE ${f2Mae.toFixed(0)} Hz`);
  console.log(`Estimator mean: ${mean(processingTimes).toFixed(1)} ms/frame`);
  if (f1Mae > MAX_F1_MAE_HZ || f2Mae > MAX_F2_MAE_HZ) {
    throw new Error(
      `Backtest exceeded the regression limits: F1 <= ${MAX_F1_MAE_HZ} Hz, F2 <= ${MAX_F2_MAE_HZ} Hz.`,
    );
  }
}

await run();
