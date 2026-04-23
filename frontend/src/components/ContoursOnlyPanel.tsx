import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";

import type { ContourGroup } from "../lib/api";
import { colorForVowel } from "../lib/colors";
import type { AxisRange } from "./PlotPanel";

const createPlotlyComponent =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((factoryModule as any).default ?? factoryModule) as (p: unknown) => React.ComponentType<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plotly = (plotlyModule as any).default ?? plotlyModule;
const Plot = createPlotlyComponent(Plotly) as React.ComponentType<{
  data: unknown[];
  layout: unknown;
  config?: unknown;
  style?: React.CSSProperties;
  useResizeHandler?: boolean;
}>;

interface Props {
  title: string;
  groups: ContourGroup[];
  /** Number of contour rings per vowel. Higher than the standard view per CLAUDE.md. */
  nLevels: number;
  useNormalized: boolean;
  xRange?: AxisRange;
  yRange?: AxisRange;
  height?: number;
}

/**
 * Contours Only — KDE rings, no scatter points. Each vowel gets its own
 * contour trace at `nLevels` evenly-spaced density levels (skipping the
 * lowest, which is just background noise).
 *
 * Per CLAUDE.md, vowels with too few tokens for a KDE surface as a structured
 * "Not enough data" annotation instead of a silently-blank panel.
 */
export function ContoursOnlyPanel({
  title,
  groups,
  nLevels,
  useNormalized,
  xRange,
  yRange,
  height = 380,
}: Props) {
  const okGroups = useMemo(() => groups.filter((g) => g.status === "ok"), [groups]);
  const insufficient = useMemo(
    () => groups.filter((g) => g.status === "insufficient_data"),
    [groups],
  );

  const traces = okGroups.map((g) => {
    const color = colorForVowel(g.vowel);
    const zMax = g.z_max ?? 0;
    // Skip the bottom 15% of the density range — it's almost always uniform
    // background noise for a normalized KDE and just clutters the plot.
    const start = zMax * 0.15;
    const end = zMax * 0.95;
    const size = nLevels > 1 ? (end - start) / (nLevels - 1) : end - start;
    return {
      type: "contour",
      x: g.x,
      y: g.y,
      z: g.z,
      name: g.vowel,
      autocontour: false,
      contours: {
        coloring: "lines",
        showlines: true,
        start,
        end,
        size,
      },
      line: { color, width: 1.5 },
      hoverinfo: "skip",
      showscale: false,
      showlegend: false,
    };
  });

  // Centroid annotations per vowel — find the cell with max density and
  // label that location.
  const annotations = okGroups
    .map((g) => {
      if (!g.x || !g.y || !g.z) return null;
      let bestI = 0, bestJ = 0, bestVal = -Infinity;
      for (let i = 0; i < g.z.length; i++) {
        for (let j = 0; j < g.z[i].length; j++) {
          if (g.z[i][j] > bestVal) {
            bestVal = g.z[i][j];
            bestI = i;
            bestJ = j;
          }
        }
      }
      const color = colorForVowel(g.vowel);
      return {
        x: g.x[bestJ],
        y: g.y[bestI],
        text: `<b>${g.vowel}</b>`,
        showarrow: false,
        font: { color, size: 16, family: "system-ui, sans-serif" },
        bgcolor: "rgba(255,255,255,0.92)",
        bordercolor: color,
        borderwidth: 1.5,
        borderpad: 3,
      };
    })
    .filter(Boolean);

  if (insufficient.length > 0) {
    annotations.push({
      x: 0.5,
      y: -0.18,
      xref: "paper",
      yref: "paper",
      text:
        "Not enough data for contours: " +
        insufficient.map((g) => `${g.vowel} (${g.n})`).join(", "),
      showarrow: false,
      font: { color: "#94a3b8", size: 11 },
      bgcolor: undefined,
    } as unknown as (typeof annotations)[number]);
  }

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <Plot
        data={traces}
        layout={{
          title: { text: title, font: { size: 13, family: "system-ui, sans-serif" } },
          xaxis: {
            title: { text: axisLabels.x, font: { size: 12 } },
            autorange: xRange ? false : "reversed",
            range: xRange ? [xRange[1], xRange[0]] : undefined,
            zeroline: false,
            gridcolor: "#eef0f4",
            tickfont: { size: 10 },
          },
          yaxis: {
            title: { text: axisLabels.y, font: { size: 12 } },
            autorange: yRange ? false : "reversed",
            range: yRange ? [yRange[1], yRange[0]] : undefined,
            zeroline: false,
            gridcolor: "#eef0f4",
            tickfont: { size: 10 },
          },
          margin: { l: 56, r: 16, t: 36, b: insufficient.length > 0 ? 60 : 46 },
          showlegend: false,
          plot_bgcolor: "#fafbff",
          paper_bgcolor: "#ffffff",
          hovermode: false,
          annotations,
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: `${height}px` }}
        useResizeHandler
      />
    </div>
  );
}
