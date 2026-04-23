import { useMemo } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";

import type { TrajectoryGroup } from "../lib/api";
import { colorForVowel } from "../lib/colors";
import { dashForStress } from "../lib/dashes";
import { classifyVowel } from "../lib/vowels";
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
  /** Trajectories belonging to this panel (already filtered by panel's group). */
  trajectories: TrajectoryGroup[];
  /** When set, locks axis ranges so panels are visually comparable. */
  xRange?: AxisRange;
  yRange?: AxisRange;
  height?: number;
  /** When true, the trajectories within this panel differ by stress; render
   * with per-stress line dashes. Otherwise lines are solid. */
  stressOverlay: boolean;
  useNormalized: boolean;
}

interface DipthTrace {
  vowel: string;
  stress?: string;
  color: string;
  dash: string;
  x: number[];
  y: number[];
}

interface MonoMarker {
  vowel: string;
  stress?: string;
  color: string;
  x: number;
  y: number;
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
  xRange,
  yRange,
  height = 380,
  stressOverlay,
  useNormalized,
}: Props) {
  const { monoMarkers, dipthTraces } = useMemo(() => {
    const monos: MonoMarker[] = [];
    const dipths: DipthTrace[] = [];
    for (const g of trajectories) {
      if (g.points.length === 0) continue;
      const stress = g.dimensions.stress;
      const color = colorForVowel(g.vowel);
      const dash = stressOverlay ? dashForStress(stress) : "solid";
      const kind = classifyVowel(g.vowel);
      if (kind === "monophthong") {
        // Centroid of the smoothed curve. For a steady vowel this is roughly
        // the steady-state target.
        let sx = 0, sy = 0;
        for (const p of g.points) { sx += p.f2; sy += p.f1; }
        monos.push({
          vowel: g.vowel,
          stress,
          color,
          x: sx / g.points.length,
          y: sy / g.points.length,
        });
      } else {
        dipths.push({
          vowel: g.vowel,
          stress,
          color,
          dash,
          x: g.points.map((p) => p.f2),
          y: g.points.map((p) => p.f1),
        });
      }
    }
    return { monoMarkers: monos, dipthTraces: dipths };
  }, [trajectories, stressOverlay]);

  // One line trace per diphthong group; stress-overlay produces one trace per
  // (vowel, stress) pair so dashes can differ. Hide tracenames in the legend
  // — the parent renders the shared HTML legend.
  const dipthLineTraces = dipthTraces.map((t) => ({
    type: "scatter",
    mode: "lines",
    name: t.stress ? `${t.vowel} (${t.stress})` : t.vowel,
    x: t.x,
    y: t.y,
    line: { color: t.color, width: 2.5, dash: t.dash, shape: "spline" },
    hoverinfo: "name",
    showlegend: false,
  }));

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
    })),
    ...dipthTraces.map((t) => {
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
      };
    }),
    // Arrow at the diphthong terminus pointing along the trajectory.
    ...dipthTraces.map((t) => {
      const n = t.x.length;
      if (n < 2) return null;
      const xEnd = t.x[n - 1];
      const yEnd = t.y[n - 1];
      // Use a point a bit upstream as the arrow tail so the arrow has a clear
      // direction. Plotly draws arrows from (ax, ay) → (x, y).
      const upstream = Math.max(0, n - 8);
      return {
        x: xEnd,
        y: yEnd,
        ax: t.x[upstream],
        ay: t.y[upstream],
        xref: "x",
        yref: "y",
        axref: "x",
        ayref: "y",
        showarrow: true,
        arrowhead: 3,
        arrowsize: 1.2,
        arrowwidth: 2,
        arrowcolor: t.color,
        text: "",
        standoff: 0,
      };
    }).filter(Boolean),
  ];

  const axisLabels = useNormalized
    ? { x: "F2 (normed)", y: "F1 (normed)" }
    : { x: "F2 (Hz)", y: "F1 (Hz)" };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <Plot
        data={monoTrace ? [...dipthLineTraces, monoTrace] : dipthLineTraces}
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
      />
    </div>
  );
}
