import type { Metadata } from "./api";
import { parseFilterCommand, type FilterPatch, type ParsedFilterCommand } from "./nlFilters";

interface TensorLike {
  data?: ArrayLike<number>;
  dims?: number[];
  tolist?: () => unknown;
}

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<TensorLike>;
type ChatMessage = { role: "system" | "user"; content: string };
type TextGenerator = (
  input: string | ChatMessage[],
  options: {
    max_new_tokens: number;
    do_sample: boolean;
    temperature?: number;
    return_full_text?: boolean;
  },
) => Promise<unknown>;

interface TransformersModule {
  pipeline: {
    (task: "feature-extraction", model: string): Promise<Extractor>;
    (task: "text-generation", model: string): Promise<TextGenerator>;
  };
  env?: {
    allowLocalModels?: boolean;
    useBrowserCache?: boolean;
  };
}

interface IntentExample {
  text: string;
  patch: FilterPatch;
  label: string;
}

const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const GENERATIVE_MODEL_ID = "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA";
let extractorPromise: Promise<Extractor> | null = null;
let generatorPromise: Promise<TextGenerator> | null = null;

const INTENTS: IntentExample[] = [
  { text: "weak stress no stress unstressed", patch: { stresses: ["unstressed"] }, label: "unstressed" },
  { text: "main strong primary stress", patch: { stresses: ["primary"] }, label: "primary stress" },
  { text: "secondary stress", patch: { stresses: ["secondary"] }, label: "secondary stress" },
  { text: "draw each person separately split voices compare speakers", patch: { speakerMode: "separate" }, label: "separate speakers" },
  { text: "put voices together combine speakers merged average speakers", patch: { speakerMode: "merged" }, label: "merged speakers" },
  { text: "overlay stress lines on same graph", patch: { stressMode: "overlay" }, label: "stress overlay" },
  { text: "split by stress separate stress panels", patch: { stressMode: "separate" }, label: "separate stress" },
  { text: "ignore stress combine all stresses", patch: { stressMode: "off" }, label: "stress off" },
  { text: "pooled average weight by token", patch: { weighting: "pooled" }, label: "pooled weighting" },
  { text: "equal speaker average mean of means", patch: { weighting: "mean_of_means" }, label: "mean of means" },
  { text: "raw contour scatter points", patch: { tab: "raw_contours" }, label: "raw contours tab" },
  { text: "contours only density rings", patch: { tab: "contours_only" }, label: "contours only tab" },
  { text: "overall vowel trajectories", patch: { tab: "overall" }, label: "overall tab" },
  { text: "individual token trajectories", patch: { tab: "individual" }, label: "individual tab" },
  { text: "corpus word recorded word lookup", patch: { tab: "corpus_word" }, label: "corpus word tab" },
  { text: "live voice microphone", patch: { tab: "live_voice" }, label: "live voice tab" },
  { text: "audio monitor waveform spectrogram pitch", patch: { tab: "live_audio" }, label: "audio monitor tab" },
];

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then((rawModule) => {
      const module = rawModule as unknown as TransformersModule;
      if (module.env) {
        module.env.allowLocalModels = false;
        module.env.useBrowserCache = true;
      }
      return module.pipeline("feature-extraction", EMBEDDING_MODEL_ID);
    });
  }
  return extractorPromise;
}

function tensorToRows(tensor: TensorLike, expectedRows: number): number[][] {
  const listed = tensor.tolist?.();
  if (Array.isArray(listed) && Array.isArray(listed[0])) {
    return listed as number[][];
  }
  const data = tensor.data;
  const dims = tensor.dims;
  if (!data || !dims || dims.length < 2) return [];
  const rows = dims[0] || expectedRows;
  const cols = dims[dims.length - 1];
  const out: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const start = row * cols;
    out.push(Array.from({ length: cols }, (_, col) => Number(data[start + col] ?? 0)));
  }
  return out;
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

function mergePatch(base: FilterPatch, next: FilterPatch): FilterPatch {
  const functionWordModes =
    base.functionWordModes || next.functionWordModes
      ? { ...base.functionWordModes, ...next.functionWordModes }
      : undefined;
  return {
    ...base,
    ...next,
    ...(functionWordModes ? { functionWordModes } : {}),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replaceAll("'", "ʻ")
    .replaceAll("`", "ʻ")
    .replaceAll("’", "ʻ")
    .toLowerCase();
}

function uniqueValues(values: string[], allowed: string[]): string[] {
  const normalized = new Set(values.map((value) => normalizeText(value)));
  return allowed.filter((value) => normalized.has(normalizeText(value)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return [];
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : undefined;
}

function readNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function labelsForPatch(patch: FilterPatch): string[] {
  const labels: string[] = [];
  if (patch.speakers) labels.push(`generated speaker ${patch.speakers.length ? patch.speakers.join(", ") : "all"}`);
  if (patch.vowels) labels.push(`generated vowel ${patch.vowels.join(", ")}`);
  if (patch.stresses) labels.push(`generated stress ${patch.stresses.length ? patch.stresses.join(", ") : "all"}`);
  if (patch.speakerMode) labels.push(`generated speaker mode ${patch.speakerMode}`);
  if (patch.stressMode) labels.push(`generated stress mode ${patch.stressMode}`);
  if (patch.weighting) labels.push(`generated ${patch.weighting}`);
  if (patch.pointMode) labels.push(`generated ${patch.pointMode} points`);
  if (patch.wordQuery) labels.push(`generated word ${patch.wordQuery}`);
  if (patch.smoothing !== undefined) labels.push(`generated smoothing ${patch.smoothing}`);
  if (patch.trajectoryOpacity !== undefined) labels.push(`generated trajectory opacity ${patch.trajectoryOpacity}`);
  if (patch.contourPointOpacity !== undefined) labels.push(`generated contour opacity ${patch.contourPointOpacity}`);
  if (patch.tab) labels.push(`generated tab ${patch.tab.replaceAll("_", " ")}`);
  if (patch.functionWordModes) {
    for (const [column, mode] of Object.entries(patch.functionWordModes)) {
      labels.push(`generated ${mode} ${column}`);
    }
  }
  return labels;
}

function sanitizeGeneratedPatch(value: unknown, metadata: Metadata): FilterPatch {
  if (!isObject(value)) return {};
  const patch: FilterPatch = {};

  const speakers = readStringArray(value.speakers);
  if (speakers) patch.speakers = uniqueValues(speakers, metadata.speakers);
  else if (Array.isArray(value.speakers) && value.speakers.length === 0) patch.speakers = [];

  const vowels = readStringArray(value.vowels);
  if (vowels) patch.vowels = uniqueValues(vowels, metadata.vowels);

  const stresses = readStringArray(value.stresses);
  if (stresses) patch.stresses = uniqueValues(stresses, metadata.stresses);
  else if (Array.isArray(value.stresses) && value.stresses.length === 0) patch.stresses = [];

  const speakerMode = readEnum(value.speakerMode, ["merged", "separate"] as const);
  if (speakerMode) patch.speakerMode = speakerMode;

  const stressMode = readEnum(value.stressMode, ["off", "overlay", "separate"] as const);
  if (stressMode) patch.stressMode = stressMode;

  const weighting = readEnum(value.weighting, ["mean_of_means", "pooled"] as const);
  if (weighting) patch.weighting = weighting;

  const pointMode = readEnum(value.pointMode, ["auto", "single", "nine"] as const);
  if (pointMode) patch.pointMode = pointMode;

  const tab = readEnum(value.tab, [
    "overall",
    "individual",
    "raw_contours",
    "contours_only",
    "corpus_word",
    "live_voice",
    "live_audio",
  ] as const);
  if (tab) patch.tab = tab;

  if (typeof value.wordQuery === "string") {
    const wordQuery = value.wordQuery.trim();
    if (wordQuery.length > 0 && wordQuery.length <= 80) patch.wordQuery = wordQuery;
  }

  const smoothing = readNumber(value.smoothing, 0, 100000);
  if (smoothing !== undefined) patch.smoothing = smoothing;

  const trajectoryOpacity = readNumber(value.trajectoryOpacity, 0.05, 1);
  if (trajectoryOpacity !== undefined) patch.trajectoryOpacity = trajectoryOpacity;

  const contourPointOpacity = readNumber(value.contourPointOpacity, 0.05, 1);
  if (contourPointOpacity !== undefined) patch.contourPointOpacity = contourPointOpacity;

  if (isObject(value.functionWordModes)) {
    const functionWordModes: NonNullable<FilterPatch["functionWordModes"]> = {};
    for (const column of metadata.function_word_columns) {
      const mode = readEnum(value.functionWordModes[column], ["ignore", "include", "exclude"] as const);
      if (mode) functionWordModes[column] = mode;
    }
    if (Object.keys(functionWordModes).length > 0) patch.functionWordModes = functionWordModes;
  }

  return patch;
}

function extractGeneratedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractGeneratedText).filter(Boolean).join("\n");
  if (!isObject(value)) return "";

  const generated = value.generated_text;
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated)) {
    const messages = generated
      .map((item) => (isObject(item) && typeof item.content === "string" ? item.content : extractGeneratedText(item)))
      .filter(Boolean);
    return messages[messages.length - 1] ?? "";
  }

  for (const key of ["text", "content", "answer"]) {
    const next = value[key];
    if (typeof next === "string") return next;
  }
  return "";
}

function extractJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }
      if (char === "\"") inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function buildGenerativePrompt(query: string, metadata: Metadata): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You convert a user request into one JSON object named FilterPatch. " +
        "Return only JSON. Do not include markdown, comments, code, or prose. " +
        "Only use keys from this schema: speakers, vowels, stresses, speakerMode, stressMode, " +
        "weighting, pointMode, wordQuery, functionWordModes, trajectoryOpacity, " +
        "contourPointOpacity, smoothing, tab.",
    },
    {
      role: "user",
      content:
        `Allowed speakers: ${metadata.speakers.join(", ")}.\n` +
        `Allowed vowels: ${metadata.vowels.join(", ")}.\n` +
        `Allowed stresses: ${metadata.stresses.join(", ")}.\n` +
        `Allowed function columns: ${metadata.function_word_columns.join(", ") || "none"}.\n` +
        "speakerMode: merged or separate. stressMode: off, overlay, or separate. " +
        "weighting: mean_of_means or pooled. pointMode: auto, single, or nine. " +
        "tab: overall, individual, raw_contours, contours_only, corpus_word, live_voice, or live_audio. " +
        "Use empty arrays for all speakers or all stresses. " +
        `Request: ${query}`,
    },
  ];
}

async function getGenerator(): Promise<TextGenerator> {
  if (!generatorPromise) {
    generatorPromise = import("@huggingface/transformers").then((rawModule) => {
      const module = rawModule as unknown as TransformersModule;
      if (module.env) {
        module.env.allowLocalModels = false;
        module.env.useBrowserCache = true;
      }
      return module.pipeline("text-generation", GENERATIVE_MODEL_ID);
    });
  }
  return generatorPromise;
}

export async function parseSemanticFilterCommand(
  query: string,
  metadata: Metadata,
): Promise<ParsedFilterCommand> {
  const base = parseFilterCommand(query, metadata);
  if (!query.trim()) return base;

  const extractor = await getExtractor();
  const texts = [query, ...INTENTS.map((intent) => intent.text)];
  const embeddings = tensorToRows(await extractor(texts, { pooling: "mean", normalize: true }), texts.length);
  const queryEmbedding = embeddings[0];
  if (!queryEmbedding) return base;

  const matches = INTENTS.map((intent, index) => ({
    intent,
    score: dot(queryEmbedding, embeddings[index + 1] ?? []),
  }))
    .filter((match) => match.score >= 0.36)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (matches.length === 0) {
    return {
      ...base,
      warnings: [...base.warnings, "Semantic assist did not find a confident intent match."],
    };
  }

  const patch = matches.reduce((current, match) => mergePatch(current, match.intent.patch), base.patch);
  const recognized = [
    ...base.recognized,
    ...matches.map((match) => `${match.intent.label} (${Math.round(match.score * 100)}%)`),
  ];
  return {
    patch,
    confidence: Math.max(base.confidence, Math.min(0.96, matches[0].score)),
    explanation: `Matched ${recognized.join("; ")}.`,
    warnings: base.warnings,
    recognized,
  };
}

export async function parseGenerativeFilterCommand(
  query: string,
  metadata: Metadata,
): Promise<ParsedFilterCommand> {
  const base = parseFilterCommand(query, metadata);
  if (!query.trim()) return base;

  const generator = await getGenerator();
  const output = await generator(buildGenerativePrompt(query, metadata), {
    max_new_tokens: 180,
    do_sample: false,
    temperature: 0,
    return_full_text: false,
  });
  const text = extractGeneratedText(output);
  const generatedObject = extractJsonObject(text);
  if (!generatedObject) {
    return {
      ...base,
      warnings: [...base.warnings, "Local parser did not return valid filter JSON."],
    };
  }

  const generatedPatch = sanitizeGeneratedPatch(generatedObject, metadata);
  const generatedLabels = labelsForPatch(generatedPatch);
  if (generatedLabels.length === 0) {
    return {
      ...base,
      warnings: [...base.warnings, "Local parser returned no usable filter values."],
    };
  }

  const recognized = [...base.recognized, ...generatedLabels].filter(
    (label, index, labels) => labels.indexOf(label) === index,
  );
  return {
    patch: mergePatch(base.patch, generatedPatch),
    confidence: Math.max(base.confidence, 0.88),
    explanation: `Matched ${recognized.join("; ")}.`,
    warnings: base.warnings,
    recognized,
  };
}
