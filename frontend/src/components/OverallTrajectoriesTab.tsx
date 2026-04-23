import { useEffect, useMemo, useState } from "react";

import {
  fetchTrajectories,
  type GroupByDim,
  type TrajectoriesResponse,
  type TrajectoryGroup,
} from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { useFilters } from "../store/filters";
import { LoadingBadge } from "./LoadingBadge";
import { OverallTrajectoryPanel } from "./OverallTrajectoryPanel";
import { type AxisRange } from "./PlotPanel";
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

interface PanelSpec {
  key: string;
  title: string;
  /** Dimension values that must match for a trajectory to land in this panel. */
  filter: Partial<Record<"speaker" | "stress", string>>;
}

export function OverallTrajectoriesTab() {
  const speakers = useFilters((s) => s.speakers);
  const vowels = useFilters((s) => s.vowels);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const stressMode = useFilters((s) => s.stressMode);
  const weighting = useFilters((s) => s.weighting);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);

  const [traj, setTraj] = useState<TrajectoriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Compute n_rendered_plots first so we know whether to normalize.
  const speakerPanelCount = speakerMode === "separate" ? Math.max(1, speakers.length) : 1;
  // Stress is computed from data; but we know which stresses are filtered in.
  // If user didn't filter, we'll discover from response. Simpler: assume all 3.
  const stressPanelCount =
    stressMode === "separate" ? (stresses.length > 0 ? stresses.length : 3) : 1;
  const nPanels = speakerPanelCount * stressPanelCount;
  const useNormalized = nPanels > 1;

  // Backend grouping dims: include speaker iff splitting (separate) or stress
  // is engaged (overlay/separate). Stress is included for both overlay and
  // separate modes so we can render dashes / split panels respectively.
  const groupBy = useMemo<GroupByDim[]>(() => {
    const dims: GroupByDim[] = [];
    if (speakerMode === "separate") dims.push("speaker");
    if (stressMode !== "off") dims.push("stress");
    return dims.length === 0 ? ["none"] : dims;
  }, [speakerMode, stressMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchTrajectories({
      speakers,
      vowels,
      stresses,
      normalize: useNormalized ? "true" : "false",
      group_by: groupBy,
      weighting,
      smoothing,
    })
      .then((d) => {
        if (!cancelled) setTraj(d);
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
  }, [speakers, vowels, stresses, useNormalized, groupBy, weighting, smoothing]);

  // Build panel specs based on the actual dimensions present in the response.
  const panels: PanelSpec[] = useMemo(() => {
    if (!traj) return [];
    const speakerVals = speakerMode === "separate"
      ? [...new Set(traj.groups.map((g) => g.dimensions.speaker).filter(Boolean) as string[])].sort()
      : [null];
    const stressVals = stressMode === "separate"
      ? [...new Set(traj.groups.map((g) => g.dimensions.stress).filter(Boolean) as string[])].sort()
      : [null];

    const out: PanelSpec[] = [];
    for (const sp of speakerVals) {
      for (const st of stressVals) {
        const parts: string[] = [];
        if (sp) parts.push(`Speaker ${sp}`);
        if (st) parts.push(`${st} stress`);
        const filter: PanelSpec["filter"] = {};
        if (sp) filter.speaker = sp;
        if (st) filter.stress = st;
        out.push({
          key: `${sp ?? "all"}-${st ?? "all"}`,
          title: parts.length ? parts.join(" · ") : "All",
          filter,
        });
      }
    }
    return out;
  }, [traj, speakerMode, stressMode]);

  // Group trajectories per panel based on dimension matching.
  const panelTrajectories = useMemo(() => {
    const m = new Map<string, TrajectoryGroup[]>();
    if (!traj) return m;
    for (const p of panels) {
      const matched = traj.groups.filter((g) => {
        if (p.filter.speaker && g.dimensions.speaker !== p.filter.speaker) return false;
        if (p.filter.stress && g.dimensions.stress !== p.filter.stress) return false;
        return true;
      });
      m.set(p.key, matched);
    }
    return m;
  }, [traj, panels]);

  const sharedRanges = useMemo(() => {
    if (!traj || panels.length <= 1) return { x: null as AxisRange | null, y: null as AxisRange | null };
    const xs: number[] = [];
    const ys: number[] = [];
    for (const g of traj.groups) {
      for (const p of g.points) {
        xs.push(p.f2);
        ys.push(p.f1);
      }
    }
    return { x: paddedRange(xs), y: paddedRange(ys) };
  }, [traj, panels.length]);

  const presentVowels = useMemo(() => {
    if (!traj) return [];
    return [...new Set(traj.groups.map((g) => g.vowel))].sort();
  }, [traj]);

  if (err) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Failed to load trajectories: {err}
      </div>
    );
  }
  if (!traj) {
    return (
      <div className="m-4 text-sm text-slate-500">
        {loading ? "Loading…" : "Pick filters to see data."}
      </div>
    );
  }
  if (panels.length === 0) {
    return <div className="m-4 text-sm text-slate-500">No data for the current filters.</div>;
  }

  const cols = panels.length === 1 ? 1 : panels.length <= 4 ? 2 : 3;

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingBadge visible={loading} />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {traj.groups.length} smoothed groups · vowels: {presentVowels.length}
        </span>
        <span>
          {useNormalized ? "Normalized formants" : "Raw formants (Hz)"} · s={smoothing.toFixed(0)}
          {stressMode === "overlay" && " · stress overlay (solid=primary, dashed=secondary, dotted=unstressed)"}
        </span>
      </div>
      <VowelLegend vowels={presentVowels} />
      <div
        key={`grid-${cols}`}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {panels.map((p) => (
          <OverallTrajectoryPanel
            key={`${cols}-${p.key}`}
            title={p.title}
            trajectories={panelTrajectories.get(p.key) ?? []}
            xRange={sharedRanges.x ?? undefined}
            yRange={sharedRanges.y ?? undefined}
            stressOverlay={stressMode === "overlay"}
            useNormalized={useNormalized}
            height={panels.length === 1 ? 480 : 360}
          />
        ))}
      </div>
    </div>
  );
}
