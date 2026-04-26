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
  pointMode: PointMode;
  wordQuery?: string;
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
  matchedIdxs: Set<number>;
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

  const traces = useMemo<VowelTrace[]>(() => {
    const byVowel = new Map<string, VowelTrace>();
    const byToken = new Map<string, TokenSample[]>();
    for (const sample of samples) {
      const arr = byToken.get(sample.token_id);
      if (arr) arr.push(sample);
      else byToken.set(sample.token_id, [sample]);
    }
    const displaySamples = [...byToken.values()].flatMap((rows) =>
      samplesForPointMode(rows.sort((a, b) => a.time - b.time), pointMode)
    );
    for (const s of displaySamples) {
      let t = byVowel.get(s.vowel);
      if (!t) {
        t = {
          vowel: s.vowel,
          color: colorForVowel(s.vowel),
          x: [], y: [], text: [], ids: [],
          matchedIdxs: new Set(),
          centroidX: 0, centroidY: 0,
        };
        byVowel.set(s.vowel, t);
      }
      const x = useNormalized ? s.f2_normed : s.f2;
      const y = useNormalized ? s.f1_normed : s.f1;
      if (wordMatches(s.word, wordQuery)) t.matchedIdxs.add(t.x.length);
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
  }, [samples, useNormalized, pointMode, wordQuery]);

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  const selectedRows = useMemo(() => {
    if (!selectedId) return [];
    const rows = samples
      .filter((sample) => sample.token_id === selectedId)
      .sort((a, b) => a.time - b.time);
    return samplesForPointMode(rows, pointMode);
  }, [pointMode, samples, selectedId]);

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const tokenIdFromPoint = (point as unknown as { customdata?: unknown }).customdata;
    if (typeof tokenIdFromPoint === "string") {
      const sample = sampleByTokenId.get(tokenIdFromPoint);
      if (sample) select(sample);
      return;
    }
    const curve = point.curveNumber as number | undefined;
    const idx = point.pointIndex as number | undefined;
    if (curve === undefined || idx === undefined) return;
    const trace = traces[curve - (trajectories?.length ?? 0)];
    if (!trace) return;
    const tokenId = trace.ids[idx];
    if (!tokenId) return;
    const sample = sampleByTokenId.get(tokenId);
    if (sample) select(sample);
  };

  const scatterTraces = useMemo(
    () =>
      traces.map((t) => {
        const sizes = t.x.map((_, i) => (t.matchedIdxs.has(i) ? 9 : 5));
        const lineWidths = t.x.map((_, i) => (t.matchedIdxs.has(i) ? 2 : 0));
        const lineColors = t.x.map((_, i) => (t.matchedIdxs.has(i) ? WORD_MATCH_COLOR : "#111"));
        return {
          type: "scatter",
          mode: "markers",
          name: t.vowel,
          x: t.x,
          y: t.y,
          text: t.text,
          customdata: t.ids,
          marker: {
            color: t.color,
            size: sizes.map((size) => Math.max(7, size)),
            opacity: t.x.map((_, i) => (t.matchedIdxs.has(i) ? 1 : opacity)),
            line: { color: lineColors, width: lineWidths },
          },
          hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        };
      }),
    [opacity, traces],
  );

  // Smoothed mean trajectories overlaid on top — one line per vowel. These
  // are rendered as `lines` traces with hoverinfo:none so clicks still resolve
  // to underlying scatter points (preserving the per-token selection model).
  const trajectoryTraces = useMemo(
    () =>
      (trajectories ?? []).map((g) => ({
        type: "scatter",
        mode: "lines",
        name: `${g.vowel} (smoothed)`,
        x: g.points.map((p) => p.f2),
        y: g.points.map((p) => p.f1),
        line: { color: colorForVowel(g.vowel), width: 2.5, shape: "spline" },
        hoverinfo: "skip",
        showlegend: false,
      })),
    [trajectories],
  );

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
          size: 11,
          line: { color: SELECTED_TOKEN_OUTLINE, width: 2 },
        },
        hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: false,
      }
    : null;

  const hitTrace = useMemo(() => ({
    type: "scatter",
    mode: "markers",
    name: "Click targets",
    x: traces.flatMap((t) => t.x),
    y: traces.flatMap((t) => t.y),
    text: traces.flatMap((t) => t.text),
    customdata: traces.flatMap((t) => t.ids),
    marker: {
      color: "rgba(17, 24, 39, 0.001)",
      size: 18,
      line: { width: 0 },
    },
    hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
    showlegend: false,
  }), [traces]);

  const data = useMemo(
    () => [
      ...trajectoryTraces,
      ...scatterTraces,
      ...(selectedTrace ? [selectedTrace] : []),
      hitTrace,
    ],
    [hitTrace, scatterTraces, selectedTrace, trajectoryTraces],
  );

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
    captureevents: false,
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
