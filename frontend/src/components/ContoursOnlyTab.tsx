import { useEffect, useMemo, useState } from "react";

import {
  fetchContours,
  type ContourGroup,
  type ContoursResponse,
  type GroupByDim,
} from "../lib/api";
import { useFilters } from "../store/filters";
import { ContoursOnlyPanel } from "./ContoursOnlyPanel";
import { LoadingBadge } from "./LoadingBadge";
import { type AxisRange } from "./PlotPanel";
import { VowelLegend } from "./VowelLegend";

const PADDING = 0.08;

// Higher bin count vs the standard Raw Contours overlay, per CLAUDE.md.
const N_LEVELS = 12;
const GRID_SIZE = 80;

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
  filter: Partial<Record<"speaker" | "stress", string>>;
}

export function ContoursOnlyTab() {
  const speakers = useFilters((s) => s.speakers);
  const vowels = useFilters((s) => s.vowels);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const stressMode = useFilters((s) => s.stressMode);

  const [data, setData] = useState<ContoursResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Mirror Overall Trajectories' panel logic. Contours don't have a stress
  // overlay analog (overlapping rings would be unreadable), but Separate is
  // useful for comparing stress shapes side by side.
  const groupBy = useMemo<GroupByDim[]>(() => {
    const dims: GroupByDim[] = [];
    if (speakerMode === "separate") dims.push("speaker");
    if (stressMode === "separate") dims.push("stress");
    return dims.length === 0 ? ["none"] : dims;
  }, [speakerMode, stressMode]);

  const speakerPanelCount = speakerMode === "separate" ? Math.max(1, speakers.length) : 1;
  const stressPanelCount =
    stressMode === "separate" ? (stresses.length > 0 ? stresses.length : 3) : 1;
  const useNormalized = speakerPanelCount * stressPanelCount > 1;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchContours({
      speakers,
      vowels,
      stresses,
      normalize: useNormalized ? "true" : "false",
      group_by: groupBy,
      grid_size: GRID_SIZE,
    })
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
  }, [speakers, vowels, stresses, useNormalized, groupBy]);

  const panels: PanelSpec[] = useMemo(() => {
    if (!data) return [];
    const speakerVals = speakerMode === "separate"
      ? [...new Set(data.groups.map((g) => g.dimensions.speaker).filter(Boolean) as string[])].sort()
      : [null];
    const stressVals = stressMode === "separate"
      ? [...new Set(data.groups.map((g) => g.dimensions.stress).filter(Boolean) as string[])].sort()
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
  }, [data, speakerMode, stressMode]);

  const panelGroups = useMemo(() => {
    const m = new Map<string, ContourGroup[]>();
    if (!data) return m;
    for (const p of panels) {
      const matched = data.groups.filter((g) => {
        if (p.filter.speaker && g.dimensions.speaker !== p.filter.speaker) return false;
        if (p.filter.stress && g.dimensions.stress !== p.filter.stress) return false;
        return true;
      });
      m.set(p.key, matched);
    }
    return m;
  }, [data, panels]);

  const sharedRanges = useMemo(() => {
    if (!data || panels.length <= 1) return { x: null as AxisRange | null, y: null as AxisRange | null };
    const xs: number[] = [];
    const ys: number[] = [];
    for (const g of data.groups) {
      if (g.status !== "ok" || !g.x || !g.y) continue;
      xs.push(...g.x);
      ys.push(...g.y);
    }
    return { x: paddedRange(xs), y: paddedRange(ys) };
  }, [data, panels.length]);

  const presentVowels = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.groups.filter((g) => g.status === "ok").map((g) => g.vowel))].sort();
  }, [data]);

  if (err) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Failed to load contours: {err}
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
  if (panels.length === 0) {
    return <div className="m-4 text-sm text-slate-500">No data for the current filters.</div>;
  }

  const cols = panels.length === 1 ? 1 : panels.length <= 4 ? 2 : 3;

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingBadge visible={loading} />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {data.groups.length} groups · vowels with KDE: {presentVowels.length}
        </span>
        <span>
          {useNormalized ? "Normalized formants" : "Raw formants (Hz)"} · grid={GRID_SIZE}
        </span>
      </div>
      <VowelLegend vowels={presentVowels} />
      <div
        key={`grid-${cols}`}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {panels.map((p) => (
          <ContoursOnlyPanel
            key={`${cols}-${p.key}`}
            title={p.title}
            groups={panelGroups.get(p.key) ?? []}
            nLevels={N_LEVELS}
            useNormalized={useNormalized}
            xRange={sharedRanges.x ?? undefined}
            yRange={sharedRanges.y ?? undefined}
            height={panels.length === 1 ? 480 : 360}
          />
        ))}
      </div>
    </div>
  );
}
