// Mirror of backend/schemas.py classification, kept in sync manually. Cheaper
// than another /api/metadata round-trip every render — and the lists almost
// never change.
const MONOPHTHONGS = new Set([
  "a", "ā", "e", "ē", "i", "ī", "o", "ō", "u", "ū",
]);
const DIPHTHONGS = new Set([
  "ai", "ae", "ao", "au", "ei", "eu", "iu", "oi", "ou", "āi", "āu",
]);
const SPECIAL_VOWELS = new Set(["oa"]);

export type VowelKind = "monophthong" | "diphthong" | "special" | "unknown";

export function classifyVowel(v: string): VowelKind {
  if (MONOPHTHONGS.has(v)) return "monophthong";
  if (DIPHTHONGS.has(v)) return "diphthong";
  if (SPECIAL_VOWELS.has(v)) return "special";
  return "unknown";
}
