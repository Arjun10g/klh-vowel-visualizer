// Per-stress line dash patterns for overlay mode (CLAUDE.md: solid/dashed/dotted).
// Stable mapping so the legend stays consistent across panels.
const DASH_BY_STRESS: Record<string, string> = {
  primary: "solid",
  secondary: "dash",
  unstressed: "dot",
};

export function dashForStress(stress: string | undefined): string {
  if (!stress) return "solid";
  return DASH_BY_STRESS[stress] ?? "longdash";
}

// Marker symbol used for the centroid point on monophthongs and the terminus
// arrow on diphthongs.
export function arrowSymbolForAngle(): string {
  // Plotly's "arrow" symbol auto-rotates to the line direction in line+marker
  // traces only when angleref is set; for our use we attach a separate
  // annotation arrow at the end instead, keeping the line trace itself clean.
  return "circle";
}
