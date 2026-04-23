import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";
import type { PlotMouseEvent } from "plotly.js";

import type { TokenSample, TrajectoryGroup } from "../lib/api";
import { colorForVowel } from "../lib/colors";
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
  samples: TokenSample[];
  /** Smoothed mean trajectories overlaid on top of the faint per-token lines. */
  trajectories?: TrajectoryGroup[];
  useNormalized: boolean;
  /** 0–1, applied to the per-token line opacity. */
  opacity: number;
  xRange?: AxisRange;
  yRange?: AxisRange;
  height?: number;
}

interface VowelLineBundle {
  vowel: string;
  color: string;
  /** Combined x with NaN separators between tokens. */
  x: (number | null)[];
  y: (number | null)[];
  /** Token id at each point; null at the NaN separator slots. */
  ids: (string | null)[];
  /** Hover label per point. */
  text: (string | null)[];
  /** Index in the selected token's id sequence (for highlight). */
  selectedIdxs: Set<number>;
}

/**
 * One Plotly instance per panel. Per CLAUDE.md, panels stay as separate
 * Plotly components so click events fire reliably.
 *
 * Each vowel gets one line trace built by joining all its tokens' tracks with
 * NaN separators — visually that draws each token as a disconnected path,
 * but it's only N traces (one per vowel) instead of one per token. Clicks
 * still resolve to a specific token via per-point customdata.
 */
export function IndividualTrajectoryPanel({
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

  const bundles = useMemo<VowelLineBundle[]>(() => {
    // Group samples by (vowel, token_id), preserving time order within token.
    const byVowel = new Map<string, Map<string, TokenSample[]>>();
    for (const s of samples) {
      let byTok = byVowel.get(s.vowel);
      if (!byTok) {
        byTok = new Map();
        byVowel.set(s.vowel, byTok);
      }
      const arr = byTok.get(s.token_id);
      if (arr) arr.push(s);
      else byTok.set(s.token_id, [s]);
    }
    const result: VowelLineBundle[] = [];
    for (const [vowel, byTok] of byVowel) {
      const xs: (number | null)[] = [];
      const ys: (number | null)[] = [];
      const ids: (string | null)[] = [];
      const texts: (string | null)[] = [];
      const sel = new Set<number>();
      let i = 0;
      const tokens = [...byTok.entries()];
      for (let ti = 0; ti < tokens.length; ti++) {
        const [tokenId, rows] = tokens[ti];
        rows.sort((a, b) => a.time - b.time);
        for (const r of rows) {
          xs.push(useNormalized ? r.f2_normed : r.f2);
          ys.push(useNormalized ? r.f1_normed : r.f1);
          ids.push(tokenId);
          texts.push(`${r.word} (${r.vowel}) — ${r.speaker} t=${r.time}`);
          if (tokenId === selectedId) sel.add(i);
          i++;
        }
        // NaN separator so Plotly doesn't connect this token to the next.
        if (ti < tokens.length - 1) {
          xs.push(null); ys.push(null); ids.push(null); texts.push(null);
          i++;
        }
      }
      result.push({
        vowel,
        color: colorForVowel(vowel),
        x: xs, y: ys, ids, text: texts,
        selectedIdxs: sel,
      });
    }
    return result.sort((a, b) => a.vowel.localeCompare(b.vowel));
  }, [samples, selectedId, useNormalized]);

  // Build a per-vowel pair of traces:
  //   1) faint base lines (all tokens of the vowel)
  //   2) bold highlight lines for the selected token (if in this panel)
  // The highlight is drawn from the same data with a mask: non-selected
  // points get NaN, so only the selected token's segment is rendered.
  const data = bundles.flatMap((b) => {
    const traces: unknown[] = [
      {
        type: "scatter",
        mode: "lines",
        name: b.vowel,
        x: b.x,
        y: b.y,
        text: b.text,
        customdata: b.ids,
        line: { color: b.color, width: 1, shape: "spline" },
        opacity,
        hovertemplate: "%{text}<extra></extra>",
        showlegend: false,
      },
    ];
    if (b.selectedIdxs.size > 0) {
      const xx = b.x.map((v, i) => (b.selectedIdxs.has(i) ? v : null));
      const yy = b.y.map((v, i) => (b.selectedIdxs.has(i) ? v : null));
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        x: xx,
        y: yy,
        line: { color: "#0f172a", width: 3 },
        marker: { color: "#0f172a", size: 6 },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
    return traces;
  });

  // Smoothed mean overlay — one per (vowel, stress?) trajectory group.
  const trajectoryTraces = (trajectories ?? []).map((g) => ({
    type: "scatter",
    mode: "lines",
    name: `${g.vowel} mean`,
    x: g.points.map((p) => p.f2),
    y: g.points.map((p) => p.f1),
    line: { color: colorForVowel(g.vowel), width: 3, shape: "spline" },
    hoverinfo: "skip",
    showlegend: false,
  }));

  const allData = [...data, ...trajectoryTraces];

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const curve = point.curveNumber as number | undefined;
    const idx = point.pointIndex as number | undefined;
    if (curve === undefined || idx === undefined) return;
    // The data array is laid out as: per-vowel base trace, optional highlight
    // trace, repeat — then trailing smoothed-mean traces. Walk the prefix to
    // find which base trace was clicked; ignore highlight/mean clicks.
    let bIdx = 0;
    let traceCursor = 0;
    for (; bIdx < bundles.length; bIdx++) {
      if (traceCursor === curve) break;
      traceCursor += 1 + (bundles[bIdx].selectedIdxs.size > 0 ? 1 : 0);
    }
    if (bIdx >= bundles.length) return;
    const bundle = bundles[bIdx];
    const tokenId = bundle.ids[idx];
    if (!tokenId) return;
    const sample = samples.find((s) => s.token_id === tokenId);
    if (sample) select(sample);
  };

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <Plot
        data={allData}
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
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: `${height}px` }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
