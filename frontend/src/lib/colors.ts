// Categorical palette — matches `rainbow(n=22)` in spirit from the original
// app.R. Tabs/contour panels use these to color points & lines by vowel.
const PALETTE = [
  "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffd92f",
  "#a65628", "#f781bf", "#999999", "#1b9e77", "#d95f02", "#7570b3",
  "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#386cb0", "#f0027f",
  "#bf5b17", "#666666", "#1f78b4", "#33a02c",
];

const cache = new Map<string, string>();

export const SELECTED_TOKEN_COLOR = "#e11d48";
export const SELECTED_TOKEN_OUTLINE = "#111827";
export const WORD_MATCH_COLOR = "#facc15";

export function colorForVowel(vowel: string): string {
  if (vowel === "oa") return "#0f766e";
  const cached = cache.get(vowel);
  if (cached) return cached;
  // Stable hash → palette index, so each vowel gets the same color across
  // panels and re-renders without needing global state.
  let h = 0;
  for (let i = 0; i < vowel.length; i++) h = (h * 31 + vowel.charCodeAt(i)) >>> 0;
  const c = PALETTE[h % PALETTE.length];
  cache.set(vowel, c);
  return c;
}
