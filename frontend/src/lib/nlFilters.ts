import type { Metadata } from "./api";
import type {
  FunctionFilterMode,
  PointMode,
  SpeakerMode,
  StressMode,
  Weighting,
} from "../store/filters";
import type { TabId } from "../store/ui";

export interface FilterPatch {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  speakerMode?: SpeakerMode;
  stressMode?: StressMode;
  weighting?: Weighting;
  pointMode?: PointMode;
  wordQuery?: string;
  functionWordModes?: Record<string, FunctionFilterMode>;
  trajectoryOpacity?: number;
  contourPointOpacity?: number;
  smoothing?: number;
  tab?: TabId;
}

export interface ParsedFilterCommand {
  patch: FilterPatch;
  confidence: number;
  explanation: string;
  warnings: string[];
  recognized: string[];
}

const CONTROL_WORDS = new Set([
  "all",
  "and",
  "average",
  "compare",
  "containing",
  "contours",
  "for",
  "from",
  "individual",
  "merged",
  "only",
  "overall",
  "plot",
  "pooled",
  "raw",
  "search",
  "separate",
  "show",
  "smooth",
  "smoothing",
  "stress",
  "stressed",
  "token",
  "tokens",
  "trajectory",
  "trajectories",
  "voice",
  "voices",
  "vowel",
  "vowels",
  "word",
  "words",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replaceAll("'", "ʻ")
    .replaceAll("`", "ʻ")
    .replaceAll("’", "ʻ")
    .toLowerCase();
}

function termsFor(value: string): string[] {
  return normalizeText(value).match(/[\p{L}\p{N}ʻ_-]+/gu) ?? [];
}

function includesPhrase(text: string, phrase: string): boolean {
  return text.includes(normalizeText(phrase));
}

function uniqueSorted<T extends string>(values: T[], order: readonly T[]): T[] {
  const selected = new Set(values);
  return order.filter((item) => selected.has(item));
}

function addRecognized(recognized: string[], label: string): void {
  if (!recognized.includes(label)) recognized.push(label);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findWordQuery(text: string, metadata: Metadata): string | undefined {
  const patterns = [
    /\b(?:word|words|token|tokens)\s+(?:containing|contains|matching|called|named)?\s*["“]?([\p{L}\p{N}ʻ'`’_-]+)/iu,
    /\b(?:containing|contains|search|find)\s+["“]?([\p{L}\p{N}ʻ'`’_-]+)/iu,
  ];
  const speakerTerms = new Set(metadata.speakers.map((speaker) => normalizeText(speaker)));
  const vowelTerms = new Set(metadata.vowels.map((vowel) => normalizeText(vowel)));
  const stressTerms = new Set(metadata.stresses.map((stress) => normalizeText(stress)));
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const normalized = normalizeText(candidate);
    if (
      CONTROL_WORDS.has(normalized) ||
      speakerTerms.has(normalized) ||
      vowelTerms.has(normalized) ||
      stressTerms.has(normalized)
    ) {
      continue;
    }
    return candidate.normalize("NFC").replaceAll("'", "ʻ").replaceAll("`", "ʻ").replaceAll("’", "ʻ");
  }
  return undefined;
}

function parseSmoothing(text: string): number | undefined {
  const match = text.match(/\bsmooth(?:ing)?\s*(?:=|to|at)?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  return clamp(Number(match[1]), 0, 100000);
}

function parseOpacity(text: string, label: "trajectory" | "contour"): number | undefined {
  const pattern = new RegExp(`\\b${label}(?:-point| point)?\\s+opacity\\s*(?:=|to|at)?\\s*(\\d+(?:\\.\\d+)?)`, "i");
  const match = text.match(pattern);
  if (!match) return undefined;
  const raw = Number(match[1]);
  return clamp(raw > 1 ? raw / 100 : raw, 0.05, 1);
}

export function parseFilterCommand(query: string, metadata: Metadata): ParsedFilterCommand {
  const raw = query.trim();
  const text = normalizeText(raw);
  const terms = new Set(termsFor(raw));
  const patch: FilterPatch = {};
  const warnings: string[] = [];
  const recognized: string[] = [];

  if (!raw) {
    return {
      patch,
      confidence: 0,
      explanation: "",
      warnings,
      recognized,
    };
  }

  if (includesPhrase(text, "all speakers") || includesPhrase(text, "all voices") || terms.has("everyone")) {
    patch.speakers = [];
    addRecognized(recognized, "all speakers");
  } else {
    const speakers = metadata.speakers.filter((speaker) => terms.has(normalizeText(speaker)));
    if (speakers.length > 0) {
      patch.speakers = uniqueSorted(speakers, metadata.speakers);
      addRecognized(recognized, `speaker ${patch.speakers.join(", ")}`);
    }
  }

  const vowels = metadata.vowels.filter((vowel) => terms.has(normalizeText(vowel)));
  if (vowels.length > 0) {
    patch.vowels = uniqueSorted(vowels, metadata.vowels);
    addRecognized(recognized, `vowel ${patch.vowels.join(", ")}`);
  }

  const stresses: string[] = [];
  if (
    terms.has("unstressed") ||
    includesPhrase(text, "no stress") ||
    includesPhrase(text, "without stress")
  ) {
    stresses.push("unstressed");
  }
  if (terms.has("primary") || includesPhrase(text, "main stress")) stresses.push("primary");
  if (terms.has("secondary")) stresses.push("secondary");
  const validStresses = uniqueSorted(
    stresses.filter((stress): stress is string => metadata.stresses.includes(stress)),
    metadata.stresses,
  );
  if (validStresses.length > 0) {
    patch.stresses = validStresses;
    addRecognized(recognized, `stress ${validStresses.join(", ")}`);
  } else if (includesPhrase(text, "all stresses") || includesPhrase(text, "any stress")) {
    patch.stresses = [];
    addRecognized(recognized, "all stresses");
  }

  if (
    terms.has("compare") ||
    includesPhrase(text, "separate speakers") ||
    includesPhrase(text, "separate voices") ||
    includesPhrase(text, "split by speaker") ||
    includesPhrase(text, "split by voice")
  ) {
    patch.speakerMode = "separate";
    addRecognized(recognized, "separate speakers");
  } else if (
    terms.has("merged") ||
    includesPhrase(text, "merge speakers") ||
    includesPhrase(text, "combine speakers") ||
    includesPhrase(text, "combine voices")
  ) {
    patch.speakerMode = "merged";
    addRecognized(recognized, "merged speakers");
  }

  if (includesPhrase(text, "stress overlay") || includesPhrase(text, "overlay stress")) {
    patch.stressMode = "overlay";
    addRecognized(recognized, "stress overlay");
  } else if (includesPhrase(text, "separate stress") || includesPhrase(text, "split by stress")) {
    patch.stressMode = "separate";
    addRecognized(recognized, "separate stress");
  } else if (includesPhrase(text, "ignore stress") || includesPhrase(text, "stress off")) {
    patch.stressMode = "off";
    addRecognized(recognized, "stress off");
  }

  if (terms.has("pooled")) {
    patch.weighting = "pooled";
    addRecognized(recognized, "pooled weighting");
  } else if (includesPhrase(text, "mean of means") || includesPhrase(text, "equal speaker")) {
    patch.weighting = "mean_of_means";
    addRecognized(recognized, "mean of means");
  }

  if (includesPhrase(text, "9 point") || includesPhrase(text, "nine point")) {
    patch.pointMode = "nine";
    addRecognized(recognized, "nine time points");
  } else if (includesPhrase(text, "single point") || includesPhrase(text, "one point")) {
    patch.pointMode = "single";
    addRecognized(recognized, "single time point");
  } else if (includesPhrase(text, "auto point")) {
    patch.pointMode = "auto";
    addRecognized(recognized, "auto time points");
  }

  if (includesPhrase(text, "raw contours") || includesPhrase(text, "raw contour")) {
    patch.tab = "raw_contours";
    addRecognized(recognized, "raw contours tab");
  } else if (includesPhrase(text, "contours only") || includesPhrase(text, "contour only")) {
    patch.tab = "contours_only";
    addRecognized(recognized, "contours only tab");
  } else if (terms.has("individual")) {
    patch.tab = "individual";
    addRecognized(recognized, "individual trajectories tab");
  } else if (terms.has("overall")) {
    patch.tab = "overall";
    addRecognized(recognized, "overall trajectories tab");
  } else if (
    includesPhrase(text, "audio monitor") ||
    terms.has("spectrogram") ||
    terms.has("waveform") ||
    terms.has("spectrum")
  ) {
    patch.tab = "live_audio";
    addRecognized(recognized, "audio monitor tab");
  } else if (includesPhrase(text, "live voice") || terms.has("mic") || terms.has("microphone")) {
    patch.tab = "live_voice";
    addRecognized(recognized, "live voice tab");
  }

  const smoothing = parseSmoothing(text);
  if (smoothing !== undefined) {
    patch.smoothing = smoothing;
    addRecognized(recognized, `smoothing ${smoothing}`);
  }

  const trajectoryOpacity = parseOpacity(text, "trajectory");
  if (trajectoryOpacity !== undefined) {
    patch.trajectoryOpacity = trajectoryOpacity;
    addRecognized(recognized, `trajectory opacity ${trajectoryOpacity}`);
  }

  const contourPointOpacity = parseOpacity(text, "contour");
  if (contourPointOpacity !== undefined) {
    patch.contourPointOpacity = contourPointOpacity;
    addRecognized(recognized, `contour opacity ${contourPointOpacity}`);
  }

  const functionWordModes: Record<string, FunctionFilterMode> = {};
  for (const column of metadata.function_word_columns) {
    const normalizedColumn = normalizeText(column);
    if (includesPhrase(text, `include ${normalizedColumn}`)) {
      functionWordModes[column] = "include";
      addRecognized(recognized, `include ${column}`);
    } else if (includesPhrase(text, `exclude ${normalizedColumn}`)) {
      functionWordModes[column] = "exclude";
      addRecognized(recognized, `exclude ${column}`);
    }
  }
  if (Object.keys(functionWordModes).length > 0) patch.functionWordModes = functionWordModes;

  const wordQuery = findWordQuery(raw, metadata);
  if (wordQuery) {
    patch.wordQuery = wordQuery;
    addRecognized(recognized, `word ${wordQuery}`);
  }

  if ((includesPhrase(text, "one user") || includesPhrase(text, "1 user")) && !patch.speakers) {
    warnings.push("Choose a speaker code such as LV, AA, DK, HM, IN, JM, RM, or SB.");
  }
  if ((terms.has("specific") || terms.has("tokens")) && !patch.wordQuery && !patch.vowels) {
    warnings.push("Name a word or vowel token to narrow the token search.");
  }
  if (recognized.length === 0) {
    warnings.push("No supported filter terms were recognized.");
  }

  const confidence =
    recognized.length === 0
      ? 0
      : warnings.length > 0
        ? 0.7
        : recognized.length === 1
          ? 0.85
          : 0.95;

  return {
    patch,
    confidence,
    explanation: recognized.length > 0 ? `Matched ${recognized.join("; ")}.` : "",
    warnings,
    recognized,
  };
}
