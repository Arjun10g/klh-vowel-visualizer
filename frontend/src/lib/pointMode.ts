import type { TokenSample } from "./api";
import { classifyVowel } from "./vowels";
import type { PointMode } from "../store/filters";

export function representativeSample(rows: TokenSample[]): TokenSample {
  return rows.reduce((best, row) =>
    Math.abs(row.time - 5) < Math.abs(best.time - 5) ? row : best
  );
}

export function samplesForPointMode(rows: TokenSample[], pointMode: PointMode): TokenSample[] {
  if (rows.length === 0) return [];
  if (pointMode === "nine") return rows;
  if (pointMode === "single") return [representativeSample(rows)];
  return classifyVowel(rows[0].vowel) === "diphthong" ? rows : [representativeSample(rows)];
}
