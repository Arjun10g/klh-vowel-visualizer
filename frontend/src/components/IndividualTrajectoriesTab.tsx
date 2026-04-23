import { useEffect, useMemo, useState } from "react";

import {
  fetchTokens,
  fetchTrajectories,
  type GroupByDim,
  type TokensResponse,
  type TrajectoriesResponse,
  type TrajectoryGroup,
} from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { buildPanels } from "../lib/panels";
import { useFilters } from "../store/filters";
import { IndividualTrajectoryPanel } from "./IndividualTrajectoryPanel";
import { LoadingBadge } from "./LoadingBadge";
import { type AxisRange } from "./PlotPanel";
import { VowelLegend } from "./VowelLegend";

const PADDING = 0.08;
const TOKEN_LIMIT = 1500;

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

export function IndividualTrajectoriesTab() {
  const speakers = useFilters((s) => s.speakers);
  const vowels = useFilters((s) => s.vowels);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const opacity = useFilters((s) => s.trajectoryOpacity);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);
  const weighting = useFilters((s) => s.weighting);

  const [tokens, setTokens] = useState<TokensResponse | null>(null);
  const [traj, setTraj] = useState<TrajectoriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Higher token limit than the Raw Contours tab — individual trajectories
  // are the whole point of this view, so we want as many lines per panel as
  // practical (still capped to keep Plotly responsive).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchTokens({ speakers, vowels, stresses, limit: TOKEN_LIMIT })
      .then((d) => {
        if (!cancelled) setTokens(d);
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

  useEffect(() => {
    let cancelled = false;
    const groupBy: GroupByDim[] = speakerMode === "separate" ? ["speaker"] : ["none"];
    fetchTrajectories({
      speakers,
      vowels,
      stresses,
      normalize: useNormalized ? "true" : "false",
      group_by: groupBy,
      weighting,
      smoothing,
    })
      .then((t) => {
        if (!cancelled) setTraj(t);
      })
      .catch(() => {
        if (!cancelled) setTraj(null);
      });
    return () => {
      cancelled = true;
    };
  }, [speakers, vowels, stresses, useNormalized, speakerMode, weighting, smoothing]);

  const panels = useMemo(
    () => (tokens ? buildPanels(tokens.rows, speakerMode) : []),
    [tokens, speakerMode],
  );

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
    if (!tokens || panels.length <= 1) return { x: null as AxisRange | null, y: null as AxisRange | null };
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of tokens.rows) {
      xs.push(useNormalized ? r.f2_normed : r.f2);
      ys.push(useNormalized ? r.f1_normed : r.f1);
    }
    return { x: paddedRange(xs), y: paddedRange(ys) };
  }, [tokens, panels.length, useNormalized]);

  const presentVowels = useMemo(() => {
    if (!tokens) return [];
    return [...new Set(tokens.rows.map((r) => r.vowel))].sort();
  }, [tokens]);

  if (err) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Failed to load tokens: {err}
      </div>
    );
  }
  if (!tokens) {
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
          {tokens.n_tokens} tokens · {tokens.n_rows} samples
          {tokens.rows.length === TOKEN_LIMIT
            ? ` (limit ${TOKEN_LIMIT} reached — narrow filters for full set)`
            : ""}
        </span>
        <span>
          {useNormalized ? "Normalized formants" : "Raw formants (Hz)"} · line opacity={opacity.toFixed(2)}
        </span>
      </div>
      <VowelLegend vowels={presentVowels} />
      <div
        key={`grid-${cols}`}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {panels.map((p) => {
          const trajKey = speakerMode === "separate" ? p.key : "all";
          return (
            <IndividualTrajectoryPanel
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
