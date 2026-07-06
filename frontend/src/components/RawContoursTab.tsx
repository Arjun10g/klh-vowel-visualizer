import { useEffect, useMemo, useState } from "react";

import {
  fetchTokens,
  fetchTrajectories,
  type GroupByDim,
  type Metadata,
  type TokensResponse,
  type TrajectoriesResponse,
  type TrajectoryGroup,
} from "../lib/api";
import { functionFilterParams } from "../lib/functionFilters";
import { useDebouncedValue } from "../lib/hooks";
import { buildPanels, projectedPanelCount, useNormalizedForPanelCount } from "../lib/panels";
import { useFilters } from "../store/filters";
import { LoadingBadge } from "./LoadingBadge";
import { PlotPanel, type AxisRange } from "./PlotPanel";
import { VowelLegend } from "./VowelLegend";

const PADDING = 0.08;

function paddedRange(values: number[]): AxisRange | null {
  if (values.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  return [lo - span * PADDING, hi + span * PADDING];
}

interface Props {
  metadata: Metadata;
}

export function RawContoursTab({ metadata }: Props) {
  const speakers = useFilters((s) => s.speakers);
  const vowels = useFilters((s) => s.vowels);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const stressMode = useFilters((s) => s.stressMode);
  const pointMode = useFilters((s) => s.pointMode);
  const wordQuery = useFilters((s) => s.wordQuery);
  const functionWordModes = useFilters((s) => s.functionWordModes);
  const opacity = useFilters((s) => s.contourPointOpacity);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);
  const weighting = useFilters((s) => s.weighting);
  const functionParams = useMemo(() => functionFilterParams(functionWordModes), [functionWordModes]);
  const functionKey = JSON.stringify(functionParams);

  const [data, setData] = useState<TokensResponse | null>(null);
  const [traj, setTraj] = useState<TrajectoriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Tokens fetch — driven by filters only.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setErr(null);
      }
    });
    fetchTokens({ speakers, vowels, stresses, ...functionParams, limit: 800 })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [speakers, vowels, stresses, functionKey, functionParams]);

  const useNormalized = useNormalizedForPanelCount(
    projectedPanelCount(metadata, speakers, speakerMode, stresses, stressMode),
  );

  // Trajectories fetch — also depends on smoothing/weighting/normalize.
  useEffect(() => {
    let cancelled = false;
    const groupBy: GroupByDim[] = [];
    if (speakerMode === "separate") groupBy.push("speaker");
    if (stressMode === "separate") groupBy.push("stress");
    fetchTrajectories({
      speakers,
      vowels,
      stresses,
      ...functionParams,
      normalize: useNormalized ? "true" : "false",
      group_by: groupBy.length > 0 ? groupBy : ["none"],
      weighting,
      smoothing,
    })
      .then((t) => {
        if (!cancelled) setTraj(t);
      })
      .catch(() => {
        // Trajectory failure shouldn't block the scatter from rendering.
        if (!cancelled) setTraj(null);
      });
    return () => {
      cancelled = true;
    };
  }, [speakers, vowels, stresses, functionKey, useNormalized, speakerMode, stressMode, weighting, smoothing, functionParams]);

  const panels = useMemo(
    () => (data ? buildPanels(data.rows, speakerMode, stressMode) : []),
    [data, speakerMode, stressMode],
  );

  const panelTrajectories = useMemo(() => {
    const m = new Map<string, TrajectoryGroup[]>();
    if (!traj) return m;
    for (const p of panels) {
      m.set(
        p.key,
        traj.groups.filter((g) => {
          if (p.filter.speaker && g.dimensions.speaker !== p.filter.speaker) return false;
          if (p.filter.stress && g.dimensions.stress !== p.filter.stress) return false;
          return true;
        }),
      );
    }
    return m;
  }, [traj, panels]);

  const sharedRanges = useMemo(() => {
    if (!data || panels.length <= 1) return { x: null as AxisRange | null, y: null as AxisRange | null };
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of data.rows) {
      xs.push(useNormalized ? r.f2_normed : r.f2);
      ys.push(useNormalized ? r.f1_normed : r.f1);
    }
    return { x: paddedRange(xs), y: paddedRange(ys) };
  }, [data, panels.length, useNormalized]);

  const presentVowels = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map((r) => r.vowel))].sort();
  }, [data]);

  if (err) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Failed to load tokens: {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="m-4 text-sm text-slate-500">
        {loading ? "Loading…" : "Pick filters to see data."}
      </div>
    );
  }

  const cols = panels.length === 1 ? 1 : panels.length <= 4 ? 2 : 3;

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingBadge visible={loading} />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {data.n_tokens} tokens · {data.n_rows} samples
          {data.rows.length === 800 ? " (limit reached — narrow filters for full set)" : ""}
        </span>
        <span>{useNormalized ? "Normalized formants" : "Raw formants (Hz)"} · {pointMode === "nine" ? "9 pts" : pointMode === "single" ? "single point" : "auto points"} · smoothing s={smoothing.toFixed(0)}</span>
      </div>
      <VowelLegend vowels={presentVowels} />
      <div
        // key includes cols so collapsing N→1 forces Plotly panels to remount
        // and recompute their bounding box — without this, Plotly caches the
        // narrow width from the prior layout.
        key={`grid-${cols}`}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {panels.map((p) => {
          return (
            <PlotPanel
              key={`${cols}-${p.key}`}
              title={p.title}
              samples={p.samples}
              trajectories={panelTrajectories.get(p.key)}
              useNormalized={useNormalized}
              pointMode={pointMode}
              wordQuery={wordQuery}
              opacity={opacity}
              xRange={sharedRanges.x ?? undefined}
              yRange={sharedRanges.y ?? undefined}
              height={panels.length === 1 ? 480 : 360}
            />
          );
        })}
      </div>
    </div>
  );
}
