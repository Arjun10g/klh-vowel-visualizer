import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";
import type { PlotMouseEvent } from "plotly.js";

import type { TokenSample, WordPlotOccurrence } from "../lib/api";
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
  occurrences: WordPlotOccurrence[];
  overlays: CorpusWordOverlay[];
  useNormalized: boolean;
  opacity: number;
  xRange?: AxisRange;
  yRange?: AxisRange;
  height?: number;
}

interface OccurrenceBundle {
  x: (number | null)[];
  y: (number | null)[];
  text: (string | null)[];
  samples: (TokenSample | null)[];
  selectedIdxs: Set<number>;
}

export interface CorpusWordOverlay {
  id: string;
  label: string;
  kind: "selected" | "corpus" | "speaker";
  speaker?: string;
  slot: number;
  vowel: string;
  nTokens: number;
  points: { time: number; f1: number; f2: number }[];
}

const SPEAKER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
];

export function colorForCorpusSpeaker(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) % SPEAKER_COLORS.length;
  }
  return SPEAKER_COLORS[hash];
}

function tokenSampleFromPoint(
  occurrence: WordPlotOccurrence,
  token: WordPlotOccurrence["vowels"][number],
  sample: WordPlotOccurrence["vowels"][number]["samples"][number],
): TokenSample {
  return {
    token_id: token.token_id,
    speaker: occurrence.speaker,
    filename: token.filename,
    vowel: token.vowel,
    word: occurrence.word,
    stress: token.stress,
    previous_sound: token.previous_sound,
    next_sound: token.next_sound,
    time: sample.time,
    f1: sample.f1,
    f2: sample.f2,
    f1_normed: sample.f1_normed,
    f2_normed: sample.f2_normed,
    start: token.start,
    original_order: token.original_order,
    audio_url: token.audio_url,
  };
}

export function CorpusWordPanel({
  title,
  occurrences,
  overlays,
  useNormalized,
  opacity,
  xRange,
  yRange,
  height = 420,
}: Props) {
  const select = useSelection((s) => s.select);
  const selectedId = useSelection((s) => s.tokenId);

  const bundle = useMemo<OccurrenceBundle>(() => {
    const x: (number | null)[] = [];
    const y: (number | null)[] = [];
    const text: (string | null)[] = [];
    const samples: (TokenSample | null)[] = [];
    const selectedIdxs = new Set<number>();

    for (let oi = 0; oi < occurrences.length; oi++) {
      const occurrence = occurrences[oi];
      for (const token of occurrence.vowels) {
        for (const sample of token.samples) {
          const selectionSample = tokenSampleFromPoint(occurrence, token, sample);
          if (selectionSample.token_id === selectedId) selectedIdxs.add(x.length);
          x.push(useNormalized ? sample.f2_normed : sample.f2);
          y.push(useNormalized ? sample.f1_normed : sample.f1);
          text.push(
            `${occurrence.word} (${token.vowel}) — ${occurrence.speaker}, ${token.stress} stress, t=${sample.time}`,
          );
          samples.push(selectionSample);
        }
      }
      if (oi < occurrences.length - 1) {
        x.push(null);
        y.push(null);
        text.push(null);
        samples.push(null);
      }
    }
    return { x, y, text, samples, selectedIdxs };
  }, [occurrences, selectedId, useNormalized]);

  const baseTrace = {
    type: "scatter",
    mode: "lines+markers",
    name: "Recorded occurrences",
    x: bundle.x,
    y: bundle.y,
    text: bundle.text,
    line: { color: "#334155", width: 1.9, shape: "spline" },
    marker: { color: "#334155", size: 3.5, opacity: Math.max(0.4, opacity) },
    opacity: Math.max(0.42, opacity),
    hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
    showlegend: false,
  };

  const highlightTrace = bundle.selectedIdxs.size > 0
    ? {
        type: "scatter",
        mode: "lines+markers",
        x: bundle.x.map((value, index) => (bundle.selectedIdxs.has(index) ? value : null)),
        y: bundle.y.map((value, index) => (bundle.selectedIdxs.has(index) ? value : null)),
        line: { color: "#0f172a", width: 3 },
        marker: { color: "#0f172a", size: 6 },
        hoverinfo: "skip",
        showlegend: false,
      }
    : null;

  const overlayTraces = overlays.map((overlay) => {
    const color = overlay.kind === "speaker"
      ? colorForCorpusSpeaker(overlay.speaker ?? overlay.label)
      : overlay.kind === "corpus"
        ? "#0f172a"
        : colorForVowel(overlay.vowel);
    const dash = overlay.kind === "corpus" ? "dash" : overlay.kind === "speaker" ? "dot" : "solid";
    const width = overlay.kind === "speaker" ? 3 : overlay.kind === "corpus" ? 4 : 4.5;
    return {
      type: "scatter",
      mode: "lines",
      name: overlay.label,
      x: overlay.points.map((point) => point.f2),
      y: overlay.points.map((point) => point.f1),
      line: { color, width, dash, shape: "spline" },
      opacity: overlay.kind === "speaker" ? 0.95 : 1,
      hovertemplate:
        `${overlay.label}<br>Slot ${overlay.slot}: ${overlay.vowel} (${overlay.nTokens} tokens)` +
        "<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
      showlegend: false,
    };
  });

  const annotations = overlays
    .filter((overlay) => overlay.kind !== "speaker")
    .map((overlay) => {
      const last = overlay.points.at(-1);
      if (!last) return null;
      const color = overlay.kind === "corpus" ? "#0f172a" : colorForVowel(overlay.vowel);
      return {
        x: last.f2,
        y: last.f1,
        text: `<b>${overlay.label}</b>`,
        showarrow: false,
        xshift: -12,
        yshift: -12,
        font: { color, size: 14, family: "system-ui, sans-serif" },
        bgcolor: "rgba(255,255,255,0.88)",
        bordercolor: color,
        borderwidth: 1,
        borderpad: 2,
      };
    })
    .filter(Boolean);

  const data = highlightTrace
    ? [baseTrace, highlightTrace, ...overlayTraces]
    : [baseTrace, ...overlayTraces];

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    const point = e.points?.[0];
    if (!point) return;
    const curve = point.curveNumber as number | undefined;
    const idx = point.pointIndex as number | undefined;
    if (curve !== 0 || idx === undefined) return;
    const sample = bundle.samples[idx];
    if (sample) select(sample);
  };

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

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
