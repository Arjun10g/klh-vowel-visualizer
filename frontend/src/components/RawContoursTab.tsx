import { useEffect, useMemo, useState } from "react";

import {
  fetchTokens,
  fetchTrajectories,
  type TokensResponse,
  type TrajectoriesResponse,
  type TrajectoryGroup,
} from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { buildPanels } from "../lib/panels";
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

export function RawContoursTab() {
  const speakers = useFilters((s) => s.speakers);
  const vowels = useFilters((s) => s.vowels);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const opacity = useFilters((s) => s.contourPointOpacity);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);
  const weighting = useFilters((s) => s.weighting);

  const [data, setData] = useState<TokensResponse | null>(null);
  const [traj, setTraj] = useState<TrajectoriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Tokens fetch — driven by filters only.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchTokens({ speakers, vowels, stresses, limit: 800 })
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
  }, [speakers, vowels, stresses]);

  const useNormalized = speakerMode === "separate" && speakers.length > 1;

  // Trajectories fetch — also depends on smoothing/weighting/normalize.
  useEffect(() => {
    let cancelled = false;
    fetchTrajectories({
      speakers,
      vowels,
      stresses,
      normalize: useNormalized ? "true" : "false",
      group_by: speakerMode === "separate" ? ["speaker"] : ["none"],
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
  }, [speakers, vowels, stresses, useNormalized, speakerMode, weighting, smoothing]);

  const panels = useMemo(
    () => (data ? buildPanels(data.rows, speakerMode) : []),
    [data, speakerMode],
  );

  // Index trajectories by group_key so each panel gets its own subset.
  const trajByGroup = useMemo(() => {
    const m = new Map<string, TrajectoryGroup[]>();
    if (!traj) return m;
    for (const g of traj.groups) {
      const arr = m.get(g.group_key);
      if (arr) arr.push(g);
      else m.set(g.group_key, [g]);
    }
    return m;
  }, [traj]);

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
        <span>{useNormalized ? "Normalized formants" : "Raw formants (Hz)"} · smoothing s={smoothing.toFixed(0)}</span>
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
          // group_by=none → trajectories live under "all"; group_by=speaker
          // → under each speaker code, which matches our panel keys.
          const trajKey = speakerMode === "separate" ? p.key : "all";
          return (
            <PlotPanel
              key={`${cols}-${p.key}`}
              title={p.title}
              samples={p.samples}
              trajectories={trajByGroup.get(trajKey)}
              useNormalized={useNormalized}
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
