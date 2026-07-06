import { useMemo, useState } from "react";

import type { Metadata } from "../lib/api";
import { parseFilterCommand, type FilterPatch } from "../lib/nlFilters";
import { parseGenerativeFilterCommand, parseSemanticFilterCommand } from "../lib/semanticFilters";
import { useFilters } from "../store/filters";
import { useUi } from "../store/ui";

interface Props {
  metadata: Metadata;
}

function patchEntries(patch: FilterPatch): string[] {
  const entries: string[] = [];
  if (patch.speakers) entries.push(`speakers: ${patch.speakers.length ? patch.speakers.join(", ") : "all"}`);
  if (patch.vowels) entries.push(`vowels: ${patch.vowels.join(", ")}`);
  if (patch.stresses) entries.push(`stress: ${patch.stresses.length ? patch.stresses.join(", ") : "all"}`);
  if (patch.speakerMode) entries.push(`speakers ${patch.speakerMode}`);
  if (patch.stressMode) entries.push(`stress ${patch.stressMode}`);
  if (patch.weighting) entries.push(patch.weighting === "pooled" ? "pooled" : "mean of means");
  if (patch.pointMode) entries.push(`${patch.pointMode} points`);
  if (patch.wordQuery) entries.push(`word: ${patch.wordQuery}`);
  if (patch.smoothing !== undefined) entries.push(`smoothing ${patch.smoothing}`);
  if (patch.trajectoryOpacity !== undefined) entries.push(`trajectory opacity ${patch.trajectoryOpacity}`);
  if (patch.contourPointOpacity !== undefined) entries.push(`contour opacity ${patch.contourPointOpacity}`);
  if (patch.tab) entries.push(`tab: ${patch.tab.replaceAll("_", " ")}`);
  if (patch.functionWordModes) {
    for (const [column, mode] of Object.entries(patch.functionWordModes)) {
      entries.push(`${mode} ${column}`);
    }
  }
  return entries;
}

function applyPatch(patch: FilterPatch): void {
  const filters = useFilters.getState();
  const ui = useUi.getState();
  if (patch.speakers !== undefined) filters.setSpeakers(patch.speakers);
  if (patch.vowels !== undefined) filters.setVowels(patch.vowels);
  if (patch.stresses !== undefined) filters.setStresses(patch.stresses);
  if (patch.speakerMode !== undefined) filters.setSpeakerMode(patch.speakerMode);
  if (patch.stressMode !== undefined) filters.setStressMode(patch.stressMode);
  if (patch.weighting !== undefined) filters.setWeighting(patch.weighting);
  if (patch.pointMode !== undefined) filters.setPointMode(patch.pointMode);
  if (patch.wordQuery !== undefined) filters.setWordQuery(patch.wordQuery);
  if (patch.smoothing !== undefined) filters.setSmoothing(patch.smoothing);
  if (patch.trajectoryOpacity !== undefined) filters.setTrajectoryOpacity(patch.trajectoryOpacity);
  if (patch.contourPointOpacity !== undefined) filters.setContourPointOpacity(patch.contourPointOpacity);
  if (patch.functionWordModes) {
    for (const [column, mode] of Object.entries(patch.functionWordModes)) {
      filters.setFunctionWordMode(column, mode);
    }
  }
  if (patch.tab !== undefined) ui.setTab(patch.tab);
}

export function NaturalLanguageFilterBar({ metadata }: Props) {
  const [query, setQuery] = useState("");
  const [semanticResult, setSemanticResult] = useState<{
    query: string;
    parsed: ReturnType<typeof parseFilterCommand>;
  } | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [generativeLoading, setGenerativeLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const deterministicParsed = useMemo(() => parseFilterCommand(query, metadata), [metadata, query]);
  const parsed = semanticResult?.query === query ? semanticResult.parsed : deterministicParsed;
  const entries = useMemo(() => patchEntries(parsed.patch), [parsed.patch]);
  const canApply = entries.length > 0;

  const submit = () => {
    if (!canApply) return;
    applyPatch(parsed.patch);
    setApplied(true);
  };

  const runSemanticAssist = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSemanticLoading(true);
    setSemanticError(null);
    try {
      const next = await parseSemanticFilterCommand(trimmed, metadata);
      setSemanticResult({ query, parsed: next });
    } catch (e: unknown) {
      setSemanticError(e instanceof Error ? e.message : String(e));
    } finally {
      setSemanticLoading(false);
    }
  };

  const runGenerativeParser = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setGenerativeLoading(true);
    setSemanticError(null);
    try {
      const next = await parseGenerativeFilterCommand(trimmed, metadata);
      setSemanticResult({ query, parsed: next });
    } catch (e: unknown) {
      setSemanticError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerativeLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Command
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSemanticResult(null);
              setSemanticError(null);
              setApplied(false);
            }}
            placeholder="unstressed LV ai"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entries.map((entry) => (
              <span
                key={entry}
                className="rounded border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"
              >
                {entry}
              </span>
            ))}
          </div>
        )}

        {parsed.warnings.length > 0 && query.trim() && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
            {parsed.warnings.join(" ")}
          </div>
        )}

        {semanticError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {semanticError}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-slate-400">
            {query.trim() ? `${Math.round(parsed.confidence * 100)}%` : ""}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={runSemanticAssist}
              disabled={!query.trim() || semanticLoading || generativeLoading}
              title="Load the open-source MiniLM embedding model for semantic intent matching"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {semanticLoading ? "Loading" : "Semantic"}
            </button>
            <button
              type="button"
              onClick={runGenerativeParser}
              disabled={!query.trim() || semanticLoading || generativeLoading}
              title="Load a local open-source text-generation model for schema-limited filter parsing"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generativeLoading ? "Loading" : "Local"}
            </button>
            <button
              type="submit"
              disabled={!canApply}
              className="rounded-md border border-indigo-500 bg-indigo-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {applied ? "Applied" : "Apply"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
