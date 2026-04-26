import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";
import type { PlotMouseEvent } from "plotly.js";

import type { TokenSample, TrajectoryGroup, TrajectoryPoint } from "../lib/api";
import {
  colorForVowel,
  SELECTED_TOKEN_COLOR,
  SELECTED_TOKEN_OUTLINE,
  WORD_MATCH_COLOR,
} from "../lib/colors";
import { dashForStress } from "../lib/dashes";
import { classifyVowel } from "../lib/vowels";
import type { PointMode } from "../store/filters";
import { useSelection } from "../store/selection";
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
  onClick?: (e: Readonly<PlotMouseEvent>) => void;
}>;

interface Props {
  title: string;
  /** Trajectories belonging to this panel (already filtered by panel's group). */
  trajectories: TrajectoryGroup[];
  highlightSamples?: TokenSample[];
  wordQuery?: string;
  pointMode: PointMode;
  /** When set, locks axis ranges so panels are visually comparable. */
  xRange?: AxisRange;
  yRange?: AxisRange;
  height?: number;
  /** When true, the trajectories within this panel differ by stress; render
   * with per-stress line dashes. Otherwise lines are solid. */
  stressOverlay: boolean;
  useNormalized: boolean;
}

interface LineTrace {
  vowel: string;
  stress?: string;
  color: string;
  dash: string;
  x: number[];
  y: number[];
  showArrow: boolean;
}

interface MonoMarker {
  vowel: string;
  stress?: string;
  color: string;
  x: number;
  y: number;
  symbol: string;
}

interface HighlightBundle {
  x: (number | null)[];
  y: (number | null)[];
  ids: (string | null)[];
  text: (string | null)[];
  selectedIdxs: Set<number>;
}

function representativePoint(points: TrajectoryPoint[]): TrajectoryPoint {
  return points.reduce((best, point) =>
    Math.abs(point.time - 5) < Math.abs(best.time - 5) ? point : best
  );
}

function representativeRow(rows: TokenSample[]): TokenSample {
  return rows.reduce((best, row) =>
    Math.abs(row.time - 5) < Math.abs(best.time - 5) ? row : best
  );
}

function filterRowsForPointMode(rows: TokenSample[], pointMode: PointMode): TokenSample[] {
  if (rows.length === 0) return [];
  if (pointMode === "nine") return rows;
  if (pointMode === "single") return [representativeRow(rows)];
  return classifyVowel(rows[0].vowel) === "diphthong" ? rows : [representativeRow(rows)];
}

/**
 * Overall Trajectories panel — implements the spec from CLAUDE.md:
 * monophthongs render as a single labeled point at the trajectory's centroid;
 * diphthongs render as a smoothed path with an arrow at the terminus and the
 * vowel label at the terminus (not midpoint — that was the original app's bug).
 */
export function OverallTrajectoryPanel({
  title,
  trajectories,
  highlightSamples = [],
  wordQuery = "",
  pointMode,
  xRange,
  yRange,
  height = 380,
  stressOverlay,
  useNormalized,
}: Props) {
  const select = useSelection((s) => s.select);
  const selectedId = useSelection((s) => s.tokenId);

  const { monoMarkers, lineTraces } = useMemo(() => {
    const monos: MonoMarker[] = [];
    const lines: LineTrace[] = [];
    for (const g of trajectories) {
      if (g.points.length === 0) continue;
      const stress = g.dimensions.stress;
      const color = colorForVowel(g.vowel);
      const dash = stressOverlay ? dashForStress(stress) : "solid";
      const kind = classifyVowel(g.vowel);
      const renderLine =
        pointMode === "nine" || (pointMode === "auto" && kind === "diphthong");
      if (!renderLine) {
        const point = representativePoint(g.points);
        monos.push({
          vowel: g.vowel,
          stress,
          color,
          x: point.f2,
          y: point.f1,
          symbol: kind === "special" ? "diamond" : "circle",
        });
      } else {
        lines.push({
          vowel: g.vowel,
          stress,
          color,
          dash,
          x: g.points.map((p) => p.f2),
          y: g.points.map((p) => p.f1),
          showArrow: kind === "diphthong",
        });
      }
    }
    return { monoMarkers: monos, lineTraces: lines };
  }, [trajectories, stressOverlay, pointMode]);

  const highlightBundle = useMemo<HighlightBundle | null>(() => {
    if (!wordQuery.trim() || highlightSamples.length === 0) return null;
    const x: (number | null)[] = [];
    const y: (number | null)[] = [];
    const ids: (string | null)[] = [];
    const text: (string | null)[] = [];
    const selectedIdxs = new Set<number>();
    const byToken = new Map<string, TokenSample[]>();
    for (const row of highlightSamples) {
      const arr = byToken.get(row.token_id);
      if (arr) arr.push(row);
      else byToken.set(row.token_id, [row]);
    }
    const tokens = [...byToken.values()];
    for (let i = 0; i < tokens.length; i++) {
      const rows = filterRowsForPointMode(tokens[i].sort((a, b) => a.time - b.time), pointMode);
      for (const row of rows) {
        const idx = x.length;
        x.push(useNormalized ? row.f2_normed : row.f2);
        y.push(useNormalized ? row.f1_normed : row.f1);
        ids.push(row.token_id);
        text.push(`${row.word} (${row.vowel}) — ${row.speaker} t=${row.time}`);
        if (row.token_id === selectedId) selectedIdxs.add(idx);
      }
      if (i < tokens.length - 1) {
        x.push(null);
        y.push(null);
        ids.push(null);
        text.push(null);
      }
    }
    return { x, y, ids, text, selectedIdxs };
  }, [highlightSamples, pointMode, selectedId, useNormalized, wordQuery]);

  // One line trace per diphthong group; stress-overlay produces one trace per
  // (vowel, stress) pair so dashes can differ. Hide tracenames in the legend
  // — the parent renders the shared HTML legend.
  //
  // Arrow at the terminus is the LAST marker of the trace, using Plotly's
  // marker.symbol="arrow" + marker.angleref="previous" to auto-rotate it
  // along the curve's tangent. Cleaner than a separate annotation arrow,
  // which used to draw as a long chord across the panel when n_eval_points
  // was small (the "doubled trajectory" bug).
  const linePlotTraces = lineTraces.map((t) => {
    const lastIdx = t.x.length - 1;
    const symbols = t.x.map((_, i) =>
      t.showArrow && i === lastIdx ? "arrow" : "circle"
    );
    const sizes = t.x.map((_, i) =>
      t.showArrow && i === lastIdx ? 16 : 5
    );
    return {
      type: "scatter",
      mode: "lines+markers",
      name: t.stress ? `${t.vowel} (${t.stress})` : t.vowel,
      x: t.x,
      y: t.y,
      line: { color: t.color, width: 2.5, dash: t.dash, shape: "spline" },
      marker: {
        color: t.color,
        size: sizes,
        symbol: symbols,
        angleref: "previous",
        line: { color: "#ffffff", width: 0.8 },
      },
      hoverinfo: "name",
      showlegend: false,
    };
  });

  // Monophthongs as a single scatter trace per stress (so dashes don't apply
  // — they're points). For stress-overlay we still color-code per vowel and
  // use marker symbols to encode stress... but a simpler choice: just show
  // them as filled circles with the stress noted in the hover label.
  const monoTrace = monoMarkers.length > 0
    ? {
        type: "scatter",
        mode: "markers",
        x: monoMarkers.map((m) => m.x),
        y: monoMarkers.map((m) => m.y),
        text: monoMarkers.map((m) =>
          m.stress ? `${m.vowel} (${m.stress})` : m.vowel
        ),
        marker: {
          color: monoMarkers.map((m) => m.color),
          size: 12,
          symbol: monoMarkers.map((m) => m.symbol),
          line: { color: "#fff", width: 1.5 },
        },
        hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: false,
      }
    : null;

  // Per-vowel labels:
  //  - monophthongs at the centroid
  //  - diphthongs at the terminus (last point of the smoothed line)
  const annotations = [
    ...monoMarkers.map((m) => ({
      x: m.x,
      y: m.y,
      text: `<b>${m.vowel}</b>`,
      showarrow: false,
      yshift: -16,
      font: { color: m.color, size: 16, family: "system-ui, sans-serif" },
      captureevents: false,
    })),
    ...lineTraces.map((t) => {
      const lastIdx = t.x.length - 1;
      return {
        x: t.x[lastIdx],
        y: t.y[lastIdx],
        text: `<b>${t.vowel}</b>`,
        showarrow: false,
        xshift: -14,
        yshift: -14,
        font: { color: t.color, size: 16, family: "system-ui, sans-serif" },
        bgcolor: "rgba(255,255,255,0.85)",
        bordercolor: t.color,
        borderwidth: 1,
        borderpad: 2,
        captureevents: false,
      };
    }),
    // Diphthong terminus arrow is now drawn as the line trace's last marker
    // (marker.symbol="arrow" + angleref="previous"). No separate annotation.
  ];

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  const highlightTrace = highlightBundle
    ? {
        type: "scatter",
        mode: pointMode === "single" ? "markers" : "lines+markers",
        name: "Word matches",
        x: highlightBundle.x,
        y: highlightBundle.y,
        customdata: highlightBundle.ids,
        text: highlightBundle.text,
        line: { color: "#0f172a", width: 3.5, shape: "spline" },
        marker: { color: WORD_MATCH_COLOR, size: 9, line: { color: "#0f172a", width: 1.5 } },
        hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: false,
      }
    : null;

  const selectedHighlightTrace = highlightBundle && highlightBundle.selectedIdxs.size > 0
    ? {
        type: "scatter",
        mode: pointMode === "single" ? "markers" : "lines+markers",
        name: "Selected token",
        x: highlightBundle.x.map((value, index) =>
          highlightBundle.selectedIdxs.has(index) ? value : null
        ),
        y: highlightBundle.y.map((value, index) =>
          highlightBundle.selectedIdxs.has(index) ? value : null
        ),
        customdata: highlightBundle.ids,
        text: highlightBundle.text,
        line: { color: SELECTED_TOKEN_COLOR, width: 4.5, shape: "spline" },
        marker: {
          color: SELECTED_TOKEN_COLOR,
          size: 10,
          line: { color: SELECTED_TOKEN_OUTLINE, width: 1.8 },
        },
        hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: false,
      }
    : null;

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const tokenIdFromPoint = (point as unknown as { customdata?: unknown }).customdata;
    if (typeof tokenIdFromPoint !== "string") return;
    const sample = highlightSamples.find((s) => s.token_id === tokenIdFromPoint);
    if (sample) select(sample);
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <Plot
        data={[
          ...linePlotTraces,
          ...(monoTrace ? [monoTrace] : []),
          ...(highlightTrace ? [highlightTrace] : []),
          ...(selectedHighlightTrace ? [selectedHighlightTrace] : []),
        ]}
        layout={{
          title: { text: title, font: { size: 13, family: "system-ui, sans-serif" } },
          xaxis: {
            title: { text: axisLabels.x, font: { size: 12 } },
            autorange: xRange ? false : "reversed",
            range: xRange ? [xRange[1], xRange[0]] : undefined,
            zeroline: false,
            gridcolor: "#cbd5e1",
            tickfont: { size: 10 },
          },
          yaxis: {
            title: { text: axisLabels.y, font: { size: 12 } },
            autorange: yRange ? false : "reversed",
            range: yRange ? [yRange[1], yRange[0]] : undefined,
            zeroline: false,
            gridcolor: "#cbd5e1",
            tickfont: { size: 10 },
          },
          margin: { l: 56, r: 16, t: 36, b: 46 },
          showlegend: false,
          plot_bgcolor: "#e8f3ff",
          paper_bgcolor: "#f8fbff",
          hovermode: "closest",
          hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff", size: 12 } },
          annotations,
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: `${height}px` }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
