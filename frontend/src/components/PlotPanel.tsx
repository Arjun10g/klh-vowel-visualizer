import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";
import type { PlotMouseEvent } from "plotly.js";

import type { TokenSample, TrajectoryGroup } from "../lib/api";
import { colorForVowel } from "../lib/colors";
import { useSelection } from "../store/selection";

// Vite's CJS→ESM wrapper sometimes lands these on `.default`. Unwrap so the
// factory call works regardless of how the module was bundled.
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

export type AxisRange = [number, number];

interface Props {
  title: string;
  samples: TokenSample[];
  /** Smoothed mean trajectories per vowel (one line per vowel) overlaid on the scatter. */
  trajectories?: TrajectoryGroup[];
  /** When true, plot uses normalized formants. */
  useNormalized: boolean;
  /** 0–1, applied to scatter marker opacity. */
  opacity: number;
  /** Shared x-axis range — F2 (reversed). When set, overrides autorange. */
  xRange?: AxisRange;
  /** Shared y-axis range — F1 (reversed). When set, overrides autorange. */
  yRange?: AxisRange;
  /** Pixel height for the plot. */
  height?: number;
}

interface VowelTrace {
  vowel: string;
  color: string;
  x: number[];
  y: number[];
  text: string[];
  ids: string[];
  /**
   * Indexes into x/y/ids that belong to the currently-selected token.
   * A token has multiple time-samples, all of which we highlight so the
   * user sees the full F1/F2 trajectory of what they clicked.
   */
  selectedIdxs: Set<number>;
  centroidX: number;
  centroidY: number;
}

/**
 * One scatter panel = one Plotly instance. CLAUDE.md requires one Plotly
 * component per rendered panel (not faceted) so click handlers fire reliably
 * when the data is split by speaker or stress.
 *
 * Margins are intentionally identical for every panel and the in-plot legend
 * is always disabled — the parent renders a shared legend in HTML so all
 * panels in a facet grid get the same plot area.
 */
export function PlotPanel({
  title,
  samples,
  trajectories,
  useNormalized,
  opacity,
  xRange,
  yRange,
  height = 380,
}: Props) {
  const select = useSelection((s) => s.select);
  const selectedId = useSelection((s) => s.tokenId);

  const traces = useMemo<VowelTrace[]>(() => {
    const byVowel = new Map<string, VowelTrace>();
    for (const s of samples) {
      let t = byVowel.get(s.vowel);
      if (!t) {
        t = {
          vowel: s.vowel,
          color: colorForVowel(s.vowel),
          x: [], y: [], text: [], ids: [],
          selectedIdxs: new Set(),
          centroidX: 0, centroidY: 0,
        };
        byVowel.set(s.vowel, t);
      }
      const x = useNormalized ? s.f2_normed : s.f2;
      const y = useNormalized ? s.f1_normed : s.f1;
      if (s.token_id === selectedId) t.selectedIdxs.add(t.x.length);
      t.x.push(x);
      t.y.push(y);
      t.text.push(`${s.word} (${s.vowel}) — ${s.speaker} t=${s.time}`);
      t.ids.push(s.token_id);
    }
    for (const t of byVowel.values()) {
      if (t.x.length === 0) continue;
      let sx = 0, sy = 0;
      for (let i = 0; i < t.x.length; i++) {
        sx += t.x[i];
        sy += t.y[i];
      }
      t.centroidX = sx / t.x.length;
      t.centroidY = sy / t.y.length;
    }
    return [...byVowel.values()].sort((a, b) => a.vowel.localeCompare(b.vowel));
  }, [samples, useNormalized, selectedId]);

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const curve = point.curveNumber as number | undefined;
    const idx = point.pointIndex as number | undefined;
    if (curve === undefined || idx === undefined) return;
    // Scatter traces come first; trajectory line traces come after. A click
    // landing on a line trace has no token to select, so ignore it.
    const trace = traces[curve];
    if (!trace) return;
    const tokenId = trace.ids[idx];
    if (!tokenId) return;
    const sample = samples.find((s) => s.token_id === tokenId);
    if (sample) select(sample);
  };

  const scatterTraces = traces.map((t) => {
    const sizes = t.x.map((_, i) => (t.selectedIdxs.has(i) ? 11 : 5));
    const lineWidths = t.x.map((_, i) => (t.selectedIdxs.has(i) ? 2 : 0));
    return {
      type: "scatter",
      mode: "markers",
      name: t.vowel,
      x: t.x,
      y: t.y,
      text: t.text,
      marker: {
        color: t.color,
        size: sizes,
        opacity,
        line: { color: "#111", width: lineWidths },
      },
      hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
    };
  });

  // Smoothed mean trajectories overlaid on top — one line per vowel. These
  // are rendered as `lines` traces with hoverinfo:none so clicks still resolve
  // to underlying scatter points (preserving the per-token selection model).
  const trajectoryTraces = (trajectories ?? []).map((g) => ({
    type: "scatter",
    mode: "lines",
    name: `${g.vowel} (smoothed)`,
    x: g.points.map((p) => p.f2),
    y: g.points.map((p) => p.f1),
    line: { color: colorForVowel(g.vowel), width: 2.5, shape: "spline" },
    hoverinfo: "none",
    showlegend: false,
  }));

  const data = [...scatterTraces, ...trajectoryTraces];

  const annotations = traces.map((t) => ({
    x: t.centroidX,
    y: t.centroidY,
    text: `<b>${t.vowel}</b>`,
    showarrow: false,
    font: { color: t.color, size: 16, family: "system-ui, sans-serif" },
    bgcolor: "rgba(255,255,255,0.92)",
    bordercolor: t.color,
    borderwidth: 1.5,
    borderpad: 3,
  }));

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <Plot
        data={data}
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
          margin: { l: 56, r: 16, t: 36, b: 46 },
          showlegend: false,
          plot_bgcolor: "#fafbff",
          paper_bgcolor: "#ffffff",
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
