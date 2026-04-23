import { z } from "zod";

const VowelTypeSchema = z.enum(["monophthong", "diphthong"]);

export const MetadataSchema = z.object({
  speakers: z.array(z.string()),
  vowels: z.array(z.string()),
  stresses: z.array(z.string()),
  prev_sounds: z.array(z.string()),
  next_sounds: z.array(z.string()),
  vowel_types: z.record(z.string(), VowelTypeSchema),
});
export type Metadata = z.infer<typeof MetadataSchema>;

export const TokenSampleSchema = z.object({
  token_id: z.string(),
  speaker: z.string(),
  filename: z.string(),
  vowel: z.string(),
  word: z.string(),
  stress: z.string(),
  previous_sound: z.string().nullable(),
  next_sound: z.string().nullable(),
  time: z.number(),
  f1: z.number(),
  f2: z.number(),
  f1_normed: z.number(),
  f2_normed: z.number(),
  start: z.number(),
  original_order: z.number(),
});
export type TokenSample = z.infer<typeof TokenSampleSchema>;

export const TokensResponseSchema = z.object({
  n_tokens: z.number(),
  n_rows: z.number(),
  rows: z.array(TokenSampleSchema),
});
export type TokensResponse = z.infer<typeof TokensResponseSchema>;

type QueryValue = string[] | string | number | undefined;

function buildQuery(params: { [key: string]: QueryValue }): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function fetchMetadata(): Promise<Metadata> {
  const r = await fetch("/api/metadata");
  if (!r.ok) throw new Error(`metadata: ${r.status}`);
  return MetadataSchema.parse(await r.json());
}

export type TokenFilters = {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  limit?: number;
};

export async function fetchTokens(filters: TokenFilters): Promise<TokensResponse> {
  const r = await fetch(`/api/tokens${buildQuery(filters)}`);
  if (!r.ok) throw new Error(`tokens: ${r.status}`);
  return TokensResponseSchema.parse(await r.json());
}

export const TokenDetailSchema = z.object({
  token_id: z.string(),
  speaker: z.string(),
  filename: z.string(),
  word: z.string(),
  vowel: z.string(),
  stress: z.string(),
  previous_sound: z.string().nullable(),
  next_sound: z.string().nullable(),
  start: z.number(),
  audio_url: z.string().url(),
  interview_seconds: z.number().nullable(),
  interview_offset_available: z.boolean(),
});
export type TokenDetail = z.infer<typeof TokenDetailSchema>;

export async function fetchTokenDetail(tokenId: string): Promise<TokenDetail> {
  const r = await fetch(`/api/token/${encodeURIComponent(tokenId)}`);
  if (!r.ok) throw new Error(`token detail: ${r.status}`);
  return TokenDetailSchema.parse(await r.json());
}

export const TrajectoryPointSchema = z.object({
  time: z.number(),
  f1: z.number(),
  f2: z.number(),
});

export const TrajectoryGroupSchema = z.object({
  group_key: z.string(),
  dimensions: z.record(z.string(), z.string()),
  vowel: z.string(),
  n_tokens: z.number(),
  points: z.array(TrajectoryPointSchema),
});
export type TrajectoryGroup = z.infer<typeof TrajectoryGroupSchema>;

export const TrajectoriesResponseSchema = z.object({
  normalize: z.boolean(),
  group_by: z.array(z.enum(["none", "speaker", "stress"])),
  weighting: z.enum(["mean_of_means", "pooled"]),
  smoothing: z.number(),
  n_eval_points: z.number(),
  groups: z.array(TrajectoryGroupSchema),
});
export type TrajectoriesResponse = z.infer<typeof TrajectoriesResponseSchema>;

export type GroupByDim = "none" | "speaker" | "stress";
export type TrajectoryFilters = {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  normalize?: string; // "true"/"false"
  group_by?: GroupByDim[];
  weighting?: "mean_of_means" | "pooled";
  smoothing?: number;
  n_eval_points?: number;
};

export async function fetchTrajectories(filters: TrajectoryFilters): Promise<TrajectoriesResponse> {
  const r = await fetch(`/api/trajectories${buildQuery(filters)}`);
  if (!r.ok) throw new Error(`trajectories: ${r.status}`);
  return TrajectoriesResponseSchema.parse(await r.json());
}

export const ContourGroupSchema = z.object({
  group_key: z.string(),
  dimensions: z.record(z.string(), z.string()),
  vowel: z.string(),
  status: z.enum(["ok", "insufficient_data"]),
  n: z.number(),
  x: z.array(z.number()).nullable().optional(),
  y: z.array(z.number()).nullable().optional(),
  z: z.array(z.array(z.number())).nullable().optional(),
  z_max: z.number().nullable().optional(),
});
export type ContourGroup = z.infer<typeof ContourGroupSchema>;

export const ContoursResponseSchema = z.object({
  normalize: z.boolean(),
  group_by: z.array(z.enum(["none", "speaker", "stress"])),
  grid_size: z.number(),
  groups: z.array(ContourGroupSchema),
});
export type ContoursResponse = z.infer<typeof ContoursResponseSchema>;

export type ContourFilters = {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  normalize?: string;
  group_by?: GroupByDim[];
  grid_size?: number;
};

export async function fetchContours(filters: ContourFilters): Promise<ContoursResponse> {
  const r = await fetch(`/api/contours${buildQuery(filters)}`);
  if (!r.ok) throw new Error(`contours: ${r.status}`);
  return ContoursResponseSchema.parse(await r.json());
}
