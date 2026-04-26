import { useCallback, useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";
import type { PlotMouseEvent } from "plotly.js";

import type { TokenSample, TrajectoryGroup } from "../lib/api";
import {
  colorForVowel,
  SELECTED_TOKEN_COLOR,
  SELECTED_TOKEN_OUTLINE,
  WORD_MATCH_COLOR,
} from "../lib/colors";
import { samplesForPointMode } from "../lib/pointMode";
import { wordMatches } from "../lib/wordMatch";
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
  samples: TokenSample[];
  /** Smoothed mean trajectories overlaid on top of the faint per-token lines. */
  trajectories?: TrajectoryGroup[];
  useNormalized: boolean;
  pointMode: PointMode;
  wordQuery?: string;
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
  matchedIdxs: Set<number>;
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
  pointMode,
  wordQuery = "",
  opacity,
  xRange,
  yRange,
  height = 380,
}: Props) {
  const select = useSelection((s) => s.select);
  const sampleByTokenId = useMemo(() => {
    const byToken = new Map<string, TokenSample>();
    for (const sample of samples) {
      if (!byToken.has(sample.token_id)) byToken.set(sample.token_id, sample);
    }
    return byToken;
  }, [samples]);
  const selectedId = useSelection(
    useCallback(
      (s) => (s.tokenId && sampleByTokenId.has(s.tokenId) ? s.tokenId : null),
      [sampleByTokenId],
    ),
  );

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
      const matches = new Set<number>();
      let i = 0;
      const tokens = [...byTok.entries()];
      for (let ti = 0; ti < tokens.length; ti++) {
        const [tokenId, rows] = tokens[ti];
        rows.sort((a, b) => a.time - b.time);
        const displayRows = samplesForPointMode(rows, pointMode);
        for (const r of displayRows) {
          xs.push(useNormalized ? r.f2_normed : r.f2);
          ys.push(useNormalized ? r.f1_normed : r.f1);
          ids.push(tokenId);
          texts.push(`${r.word} (${r.vowel}) — ${r.speaker} t=${r.time}`);
          if (wordMatches(r.word, wordQuery)) matches.add(i);
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
        matchedIdxs: matches,
      });
    }
    return result.sort((a, b) => a.vowel.localeCompare(b.vowel));
  }, [samples, useNormalized, pointMode, wordQuery]);

  // Keep the large per-vowel traces independent of selection. Clicked-token
  // highlight is a tiny overlay trace below, which keeps selection responsive.
  const data = useMemo(
    () =>
      bundles.flatMap((b) => {
        const traces: unknown[] = [
          {
            type: "scatter",
            mode: "lines+markers",
            name: b.vowel,
            x: b.x,
            y: b.y,
            text: b.text,
            customdata: b.ids,
            line: { color: b.color, width: 1, shape: "spline" },
            marker: { color: b.color, size: 5, line: { color: "#ffffff", width: 0.4 } },
            opacity,
            hovertemplate: "%{text}<extra></extra>",
            showlegend: false,
          },
        ];
        if (b.matchedIdxs.size > 0) {
          const xx = b.x.map((v, i) => (b.matchedIdxs.has(i) ? v : null));
          const yy = b.y.map((v, i) => (b.matchedIdxs.has(i) ? v : null));
          traces.push({
            type: "scatter",
            mode: pointMode === "single" ? "markers" : "lines+markers",
            x: xx,
            y: yy,
            text: b.text,
            customdata: b.ids,
            line: { color: "#0f172a", width: 3 },
            marker: { color: WORD_MATCH_COLOR, size: 7, line: { color: "#0f172a", width: 1.2 } },
            hovertemplate: "%{text}<extra></extra>",
            showlegend: false,
          });
        }
        return traces;
      }),
    [bundles, opacity, pointMode],
  );

  // Smoothed mean overlay — one per (vowel, stress?) trajectory group.
  const trajectoryTraces = useMemo(
    () =>
      (trajectories ?? []).map((g) => ({
        type: "scatter",
        mode: "lines",
        name: `${g.vowel} mean`,
        x: g.points.map((p) => p.f2),
        y: g.points.map((p) => p.f1),
        line: { color: colorForVowel(g.vowel), width: 3, shape: "spline" },
        hoverinfo: "skip",
        showlegend: false,
      })),
    [trajectories],
  );

  const selectedRows = useMemo(() => {
    if (!selectedId) return [];
    const rows = samples
      .filter((sample) => sample.token_id === selectedId)
      .sort((a, b) => a.time - b.time);
    return samplesForPointMode(rows, pointMode);
  }, [pointMode, samples, selectedId]);

  const selectedTrace = selectedRows.length > 0
    ? {
        type: "scatter",
        mode: selectedRows.length > 1 ? "lines+markers" : "markers",
        name: "Selected token",
        x: selectedRows.map((sample) => (useNormalized ? sample.f2_normed : sample.f2)),
        y: selectedRows.map((sample) => (useNormalized ? sample.f1_normed : sample.f1)),
        text: selectedRows.map((sample) => `${sample.word} (${sample.vowel}) — ${sample.speaker} t=${sample.time}`),
        customdata: selectedRows.map((sample) => sample.token_id),
        line: { color: SELECTED_TOKEN_COLOR, width: 4.5, shape: "spline" },
        marker: {
          color: SELECTED_TOKEN_COLOR,
          size: 10,
          line: { color: SELECTED_TOKEN_OUTLINE, width: 2 },
        },
        hovertemplate: "%{text}<extra></extra>",
        showlegend: false,
      }
    : null;

  const hitTrace = useMemo(() => ({
    type: "scatter",
    mode: "markers",
    name: "Click targets",
    x: bundles.flatMap((b) => b.x),
    y: bundles.flatMap((b) => b.y),
    text: bundles.flatMap((b) => b.text),
    customdata: bundles.flatMap((b) => b.ids),
    marker: {
      color: "rgba(17, 24, 39, 0.001)",
      size: 18,
      line: { width: 0 },
    },
    hovertemplate: "%{text}<extra></extra>",
    showlegend: false,
  }), [bundles]);

  const allData = useMemo(
    () => [
      ...trajectoryTraces,
      ...data,
      ...(selectedTrace ? [selectedTrace] : []),
      hitTrace,
    ],
    [data, hitTrace, selectedTrace, trajectoryTraces],
  );

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const tokenIdFromPoint = (point as unknown as { customdata?: unknown }).customdata;
    if (typeof tokenIdFromPoint === "string") {
      const sample = sampleByTokenId.get(tokenIdFromPoint);
      if (sample) select(sample);
      return;
    }
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
          clickmode: "event",
          hoverdistance: 18,
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
