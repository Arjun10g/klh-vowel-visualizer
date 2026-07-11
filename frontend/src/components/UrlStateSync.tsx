import { useEffect, useMemo, useRef } from "react";

import type { Metadata } from "../lib/api";
import type { FunctionFilterMode } from "../store/filters";
import { useFilters } from "../store/filters";
import { useUi, type TabId } from "../store/ui";

interface Props {
  metadata: Metadata;
}

const TAB_IDS: readonly TabId[] = [
  "overall",
  "individual",
  "raw_contours",
  "contours_only",
  "corpus_word",
  "live_voice",
  "live_audio",
];

const FUNCTION_MODES = new Set<FunctionFilterMode>(["ignore", "include", "exclude"]);

function splitList(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validList(values: string[] | undefined, allowed: readonly string[]): string[] | undefined {
  if (values === undefined) return undefined;
  const allowedSet = new Set(allowed);
  return values.filter((value) => allowedSet.has(value));
}

function validNumber(value: string | null, min: number, max: number): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function parseFunctionModes(
  value: string | null,
  allowedColumns: readonly string[],
): Record<string, FunctionFilterMode> | undefined {
  if (!value) return undefined;
  const allowed = new Set(allowedColumns);
  const out: Record<string, FunctionFilterMode> = {};
  for (const item of value.split(",")) {
    const [column, rawMode] = item.split(":");
    if (!column || !rawMode || !allowed.has(column)) continue;
    if (!FUNCTION_MODES.has(rawMode as FunctionFilterMode)) continue;
    const mode = rawMode as FunctionFilterMode;
    if (mode !== "ignore") out[column] = mode;
  }
  return out;
}

function parseUrl(metadata: Metadata): {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  functionWordModes?: Record<string, FunctionFilterMode>;
  tab?: TabId;
  speakerMode?: "merged" | "separate";
  stressMode?: "off" | "overlay" | "separate";
  weighting?: "mean_of_means" | "pooled";
  pointMode?: "auto" | "single" | "nine";
  wordQuery?: string;
  trajectoryOpacity?: number;
  contourPointOpacity?: number;
  smoothing?: number;
} {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") as TabId | null;
  const speakerMode = params.get("speakerMode");
  const stressMode = params.get("stressMode");
  const weighting = params.get("weighting");
  const pointMode = params.get("pointMode");
  return {
    speakers: validList(splitList(params.get("speakers") ?? params.get("sp")), metadata.speakers),
    vowels: validList(splitList(params.get("vowels") ?? params.get("v")), metadata.vowels),
    stresses: validList(splitList(params.get("stresses") ?? params.get("st")), metadata.stresses),
    functionWordModes: parseFunctionModes(params.get("functionModes") ?? params.get("fn"), metadata.function_word_columns),
    tab: tab && TAB_IDS.includes(tab) ? tab : undefined,
    speakerMode: speakerMode === "merged" || speakerMode === "separate" ? speakerMode : undefined,
    stressMode:
      stressMode === "off" || stressMode === "overlay" || stressMode === "separate"
        ? stressMode
        : undefined,
    weighting: weighting === "mean_of_means" || weighting === "pooled" ? weighting : undefined,
    pointMode: pointMode === "auto" || pointMode === "single" || pointMode === "nine" ? pointMode : undefined,
    wordQuery: params.get("word") ?? undefined,
    trajectoryOpacity: validNumber(params.get("trajectoryOpacity"), 0.05, 1),
    contourPointOpacity: validNumber(params.get("contourPointOpacity"), 0.05, 1),
    smoothing: validNumber(params.get("smoothing"), 0, 100000),
  };
}

function serializeFunctionModes(modes: Record<string, FunctionFilterMode>): string | null {
  const entries = Object.entries(modes)
    .filter(([, mode]) => mode !== "ignore")
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return entries.map(([column, mode]) => `${column}:${mode}`).join(",");
}

function setList(params: URLSearchParams, key: string, values: string[]): void {
  if (values.length > 0) params.set(key, values.join(","));
}

function serializeUrlState(tab: TabId, filters: ReturnType<typeof useFilters.getState>): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  setList(params, "speakers", filters.speakers);
  setList(params, "vowels", filters.vowels);
  setList(params, "stresses", filters.stresses);
  params.set("speakerMode", filters.speakerMode);
  params.set("stressMode", filters.stressMode);
  params.set("weighting", filters.weighting);
  params.set("pointMode", filters.pointMode);
  if (filters.wordQuery.trim()) params.set("word", filters.wordQuery.trim());
  params.set("trajectoryOpacity", filters.trajectoryOpacity.toFixed(2));
  params.set("contourPointOpacity", filters.contourPointOpacity.toFixed(2));
  params.set("smoothing", String(filters.smoothing));
  const functionModes = serializeFunctionModes(filters.functionWordModes);
  if (functionModes) params.set("functionModes", functionModes);
  return `?${params.toString()}`;
}

export function UrlStateSync({ metadata }: Props) {
  const hydrated = useRef(false);
  const filters = useFilters();
  const setTab = useUi((state) => state.setTab);
  const tab = useUi((state) => state.tab);

  useEffect(() => {
    if (hydrated.current || !window.location.search) {
      hydrated.current = true;
      return;
    }
    const patch = parseUrl(metadata);
    if (patch.speakers !== undefined) filters.setSpeakers(patch.speakers);
    if (patch.vowels !== undefined) filters.setVowels(patch.vowels);
    if (patch.stresses !== undefined) filters.setStresses(patch.stresses);
    if (patch.speakerMode !== undefined) filters.setSpeakerMode(patch.speakerMode);
    if (patch.stressMode !== undefined) filters.setStressMode(patch.stressMode);
    if (patch.weighting !== undefined) filters.setWeighting(patch.weighting);
    if (patch.pointMode !== undefined) filters.setPointMode(patch.pointMode);
    if (patch.wordQuery !== undefined) filters.setWordQuery(patch.wordQuery);
    if (patch.trajectoryOpacity !== undefined) filters.setTrajectoryOpacity(patch.trajectoryOpacity);
    if (patch.contourPointOpacity !== undefined) filters.setContourPointOpacity(patch.contourPointOpacity);
    if (patch.smoothing !== undefined) filters.setSmoothing(patch.smoothing);
    if (patch.functionWordModes !== undefined) {
      for (const column of metadata.function_word_columns) filters.setFunctionWordMode(column, "ignore");
      for (const [column, mode] of Object.entries(patch.functionWordModes)) {
        filters.setFunctionWordMode(column, mode);
      }
    }
    if (patch.tab !== undefined) setTab(patch.tab);
    hydrated.current = true;
  }, [filters, metadata, setTab]);

  const serialized = useMemo(
    () => serializeUrlState(tab, filters),
    [filters, tab],
  );

  useEffect(() => {
    if (!hydrated.current) return;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = `${window.location.pathname}${serialized}${window.location.hash}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [serialized]);

  return null;
}
