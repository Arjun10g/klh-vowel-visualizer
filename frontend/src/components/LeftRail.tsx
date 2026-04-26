import { useMemo, useState } from "react";

import type { Metadata } from "../lib/api";
import { useFilters, type FunctionFilterMode } from "../store/filters";
import { MultiSelect } from "./MultiSelect";
import { SegmentedControl } from "./SegmentedControl";
import { Slider } from "./Slider";
import { SmoothingControl } from "./SmoothingControl";
import { VowelPresets } from "./VowelPresets";

interface Props {
  metadata: Metadata;
}

function FilterSection({
  title,
  summary,
  children,
  open = false,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="group rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>{title}</span>
        <span className="flex items-center gap-2 normal-case tracking-normal text-slate-400">
          {summary && <span className="max-w-28 truncate text-[11px]">{summary}</span>}
          <span className="text-sm transition group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-slate-100 p-3">
        {children}
      </div>
    </details>
  );
}

export function LeftRail({ metadata }: Props) {
  const f = useFilters();
  const [selectedFunctionColumn, setSelectedFunctionColumn] = useState("");
  const activeFunctionFilters = useMemo(
    () => Object.entries(f.functionWordModes).sort(([a], [b]) => a.localeCompare(b)),
    [f.functionWordModes],
  );
  const functionColumn =
    selectedFunctionColumn || metadata.function_word_columns[0] || "";
  const functionModeClass = (mode: FunctionFilterMode, active: boolean) =>
    "rounded px-1.5 py-0.5 text-[10px] font-semibold transition " +
    (active
      ? mode === "include"
        ? "bg-emerald-600 text-white"
        : mode === "exclude"
          ? "bg-rose-600 text-white"
          : "bg-slate-600 text-white"
      : "bg-white text-slate-500 hover:bg-slate-100");
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
        Filters
      </h2>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Word search
        </span>
        <input
          type="search"
          value={f.wordQuery}
          onChange={(event) => f.setWordQuery(event.target.value)}
          placeholder="mahalo"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </label>

      <FilterSection
        title="Corpus"
        summary={`${f.speakers.length || "all"} sp · ${f.vowels.length || "all"} v`}
        open
      >
        <MultiSelect
          label="Speakers"
          options={metadata.speakers}
          selected={f.speakers}
          onChange={f.setSpeakers}
        />
        <MultiSelect
          label="Vowels"
          options={metadata.vowels}
          selected={f.vowels}
          onChange={f.setVowels}
        />
        <VowelPresets metadata={metadata} />
        <MultiSelect
          label="Stress"
          options={metadata.stresses}
          selected={f.stresses}
          onChange={f.setStresses}
        />
      </FilterSection>

      {metadata.function_word_columns.length > 0 && (
        <FilterSection
          title="Function Columns"
          summary={activeFunctionFilters.length ? `${activeFunctionFilters.length} active` : "none"}
        >
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Column
            </span>
            <select
              value={functionColumn}
              onChange={(event) => setSelectedFunctionColumn(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {metadata.function_word_columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          {functionColumn && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Mode
              </span>
              <div className="flex rounded-md border border-slate-200 bg-slate-50 p-1">
                {(["ignore", "include", "exclude"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    title={`${mode} ${functionColumn}`}
                    onClick={() => f.setFunctionWordMode(functionColumn, mode)}
                    className={
                      "flex-1 " +
                      functionModeClass(mode, (f.functionWordModes[functionColumn] ?? "ignore") === mode)
                    }
                  >
                    {mode === "ignore" ? "Any" : mode === "include" ? "Include" : "Exclude"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeFunctionFilters.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeFunctionFilters.map(([column, mode]) => (
                <button
                  key={column}
                  type="button"
                  title={`Clear ${column}`}
                  onClick={() => f.setFunctionWordMode(column, "ignore")}
                  className={
                    "rounded border px-2 py-1 text-xs font-medium " +
                    (mode === "include"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700")
                  }
                >
                  {mode === "include" ? "+" : "-"} {column}
                </button>
              ))}
            </div>
          )}
        </FilterSection>
      )}

      <FilterSection title="Display" summary={`${f.speakerMode} · ${f.pointMode}`} open>
        <SegmentedControl
          label="Speaker mode"
          value={f.speakerMode}
          onChange={f.setSpeakerMode}
          options={[
            { value: "merged", label: "Merged" },
            { value: "separate", label: "Separate" },
          ]}
        />
        <SegmentedControl
          label="Stress mode"
          value={f.stressMode}
          onChange={f.setStressMode}
          options={[
            { value: "off", label: "Off" },
            { value: "overlay", label: "Overlay" },
            { value: "separate", label: "Separate" },
          ]}
        />
        <SegmentedControl
          label="Weighting"
          value={f.weighting}
          onChange={f.setWeighting}
          options={[
            { value: "mean_of_means", label: "Mean of means" },
            { value: "pooled", label: "Pooled" },
          ]}
        />
        <SegmentedControl
          label="Time points"
          value={f.pointMode}
          onChange={f.setPointMode}
          options={[
            { value: "auto", label: "Auto" },
            { value: "single", label: "Single" },
            { value: "nine", label: "9 pts" },
          ]}
        />
        <Slider
          label="Trajectory opacity"
          min={0.05}
          max={1}
          step={0.05}
          value={f.trajectoryOpacity}
          onChange={f.setTrajectoryOpacity}
        />
        <Slider
          label="Contour-point opacity"
          min={0.05}
          max={1}
          step={0.05}
          value={f.contourPointOpacity}
          onChange={f.setContourPointOpacity}
        />
        <SmoothingControl />
      </FilterSection>
    </aside>
  );
}
