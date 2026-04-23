// Mirror of backend/schemas.py classification, kept in sync manually. Cheaper
// than another /api/metadata round-trip every render — and the lists almost
// never change.
const MONOPHTHONGS = new Set([
  "a", "ā", "e", "ē", "i", "ī", "o", "ō", "u", "ū",
]);
const DIPHTHONGS = new Set([
  "ai", "ae", "ao", "au", "ei", "eu", "iu", "oa", "oi", "ou", "āi", "āu",
]);

export type VowelKind = "monophthong" | "diphthong" | "unknown";

export function classifyVowel(v: string): VowelKind {
  if (MONOPHTHONGS.has(v)) return "monophthong";
  if (DIPHTHONGS.has(v)) return "diphthong";
  return "unknown";
}
