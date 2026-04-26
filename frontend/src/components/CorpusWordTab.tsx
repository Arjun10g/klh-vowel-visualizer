import { useEffect, useMemo, useState } from "react";

import {
  fetchWordPlot,
  fetchWords,
  type Metadata,
  type WordPlotOccurrence,
  type WordPlotResponse,
  type WordSpeakerSlotTrajectory,
  type WordSlotTrajectory,
  type WordsResponse,
} from "../lib/api";
import { functionFilterParams } from "../lib/functionFilters";
import { useDebouncedValue } from "../lib/hooks";
import { useFilters } from "../store/filters";
import { AudioPlayer } from "./AudioPlayer";
import { CorpusWordPanel, type CorpusWordOverlay } from "./CorpusWordPanel";
import { LoadingBadge } from "./LoadingBadge";
import { type AxisRange } from "./PlotPanel";
import { SegmentedControl } from "./SegmentedControl";
import { VowelLegend } from "./VowelLegend";

const PADDING = 0.08;
const WORD_LIMIT = 500;

type ComparisonMode = "selected" | "corpus" | "speakers";

interface PanelSpec {
  key: string;
  title: string;
  occurrences: WordPlotOccurrence[];
}

interface WordsState {
  key: string;
  data: WordsResponse;
}

interface PlotState {
  key: string;
  data: WordPlotResponse;
}

interface WordAudioExample {
  key: string;
  word: string;
  speaker: string;
  vowel: string;
  stress: string;
  filename: string;
  audioUrl: string;
}

interface Props {
  metadata: Metadata;
}

function normalizeWordInput(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replaceAll("'", "ʻ")
    .replaceAll("`", "ʻ")
    .replaceAll("’", "ʻ")
    .toLocaleLowerCase();
}

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

function collectValues(
  occurrences: WordPlotOccurrence[],
  useNormalized: boolean,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const occurrence of occurrences) {
    for (const token of occurrence.vowels) {
      for (const sample of token.samples) {
        xs.push(useNormalized ? sample.f2_normed : sample.f2);
        ys.push(useNormalized ? sample.f1_normed : sample.f1);
      }
    }
  }
  return { xs, ys };
}

function appendTrajectoryValues(
  trajectories: WordSlotTrajectory[],
  xs: number[],
  ys: number[],
): void {
  for (const trajectory of trajectories) {
    for (const point of trajectory.points) {
      xs.push(point.f2);
      ys.push(point.f1);
    }
  }
}

function overlayFromTrajectory(
  trajectory: WordSlotTrajectory,
  kind: CorpusWordOverlay["kind"],
  label: string,
  idPrefix: string,
  speaker?: string,
): CorpusWordOverlay {
  return {
    id: `${idPrefix}-${trajectory.slot}-${trajectory.vowel}`,
    label,
    kind,
    speaker,
    slot: trajectory.slot,
    vowel: trajectory.vowel,
    nTokens: trajectory.n_tokens,
    points: trajectory.points,
  };
}

function collectWordAudioExamples(plot: WordPlotResponse, limit = 6): WordAudioExample[] {
  const out: WordAudioExample[] = [];
  const seen = new Set<string>();
  for (const occurrence of plot.occurrences) {
    for (const token of occurrence.vowels) {
      if (seen.has(token.token_id)) continue;
      seen.add(token.token_id);
      out.push({
        key: token.token_id,
        word: occurrence.word,
        speaker: occurrence.speaker,
        vowel: token.vowel,
        stress: token.stress,
        filename: token.filename,
        audioUrl: token.audio_url,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function voiceButtonClass(active: boolean): string {
  return (
    "rounded-md border px-2.5 py-1.5 text-sm font-medium transition " +
    (active
      ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"
      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-700")
  );
}

function PlotKey({ mode }: { mode: ComparisonMode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-6 rounded bg-slate-700" />
        Recorded
      </span>
      {mode === "selected" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-6 rounded bg-indigo-500" />
          Selected avg
        </span>
      )}
      {mode === "corpus" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-6 border-t-2 border-dashed border-slate-950" />
          All avg
        </span>
      )}
      {mode === "speakers" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-6 border-t-2 border-dotted border-blue-600" />
          Speaker avgs
        </span>
      )}
    </div>
  );
}

export function CorpusWordTab({ metadata }: Props) {
  const speakers = useFilters((s) => s.speakers);
  const stresses = useFilters((s) => s.stresses);
  const speakerMode = useFilters((s) => s.speakerMode);
  const functionWordModes = useFilters((s) => s.functionWordModes);
  const setSpeakers = useFilters((s) => s.setSpeakers);
  const setSpeakerMode = useFilters((s) => s.setSpeakerMode);
  const opacity = useFilters((s) => s.trajectoryOpacity);
  const weighting = useFilters((s) => s.weighting);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);
  const functionParams = useMemo(() => functionFilterParams(functionWordModes), [functionWordModes]);
  const functionKey = JSON.stringify(functionParams);

  const [wordInput, setWordInput] = useState("");
  const debouncedWord = useDebouncedValue(wordInput, 180);
  const queryKey = normalizeWordInput(debouncedWord);
  const searchRequestKey = JSON.stringify({ q: queryKey, speakers, stresses, functionParams });
  const allWordsRequestKey = JSON.stringify({ speakers, stresses, functionParams });
  const [allWordsState, setAllWordsState] = useState<WordsState | null>(null);
  const [wordsState, setWordsState] = useState<WordsState | null>(null);
  const [plotState, setPlotState] = useState<PlotState | null>(null);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("selected");
  const [err, setErr] = useState<string | null>(null);
  const [loadingWords, setLoadingWords] = useState(false);
  const [loadingPlot, setLoadingPlot] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoadingWords(true);
    });
    fetchWords({ q: "", speakers, stresses, ...functionParams, limit: 2000 })
      .then((data) => {
        if (!cancelled) {
          setErr(null);
          setAllWordsState({ key: allWordsRequestKey, data });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingWords(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allWordsRequestKey, speakers, stresses, functionKey, functionParams]);

  useEffect(() => {
    const q = debouncedWord.trim();
    if (!q) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoadingWords(true);
    });
    fetchWords({ q, speakers, stresses, ...functionParams, limit: 8 })
      .then((data) => {
        if (!cancelled) {
          setErr(null);
          setWordsState({ key: searchRequestKey, data });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingWords(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedWord, searchRequestKey, speakers, stresses, functionKey, functionParams]);

  const allWords = allWordsState?.key === allWordsRequestKey ? allWordsState.data : null;
  const words = queryKey
    ? wordsState?.key === searchRequestKey ? wordsState.data : null
    : allWords;

  const exactMatch = useMemo(() => {
    if (!queryKey || !words) return null;
    return words.matches.find((match) => normalizeWordInput(match.word) === queryKey) ?? null;
  }, [queryKey, words]);

  const useNormalized = speakerMode === "merged";
  const plotRequestKey = JSON.stringify({
    word: exactMatch?.word ?? "",
    speakers,
    stresses,
    functionParams,
    normalize: useNormalized,
    weighting,
    smoothing,
  });

  useEffect(() => {
    if (!exactMatch) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoadingPlot(true);
    });
    fetchWordPlot({
      word: exactMatch.word,
      speakers,
      stresses,
      ...functionParams,
      normalize: useNormalized ? "true" : "false",
      weighting,
      smoothing,
      limit: WORD_LIMIT,
    })
      .then((data) => {
        if (!cancelled) {
          setErr(null);
          setPlotState({ key: plotRequestKey, data });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingPlot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exactMatch, plotRequestKey, speakers, stresses, functionKey, useNormalized, weighting, smoothing, functionParams]);

  const plot = plotState?.key === plotRequestKey ? plotState.data : null;
  const audioExamples = useMemo(() => (plot ? collectWordAudioExamples(plot) : []), [plot]);

  const panels = useMemo<PanelSpec[]>(() => {
    if (!plot) return [];
    if (speakerMode === "merged") {
      return [{ key: "all", title: "All speakers", occurrences: plot.occurrences }];
    }
    const bySpeaker = new Map<string, WordPlotOccurrence[]>();
    for (const occurrence of plot.occurrences) {
      const arr = bySpeaker.get(occurrence.speaker);
      if (arr) arr.push(occurrence);
      else bySpeaker.set(occurrence.speaker, [occurrence]);
    }
    return [...bySpeaker.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([speaker, occurrences]) => ({
        key: speaker,
        title: `Speaker ${speaker}`,
        occurrences,
      }));
  }, [plot, speakerMode]);

  const sharedRanges = useMemo(() => {
    if (!plot || panels.length <= 1) {
      return { x: null as AxisRange | null, y: null as AxisRange | null };
    }
    const { xs, ys } = collectValues(plot.occurrences, useNormalized);
    if (comparisonMode === "corpus") {
      appendTrajectoryValues(plot.corpus_slot_trajectories, xs, ys);
    } else if (comparisonMode === "speakers") {
      appendTrajectoryValues(plot.speaker_slot_trajectories, xs, ys);
    } else {
      appendTrajectoryValues(plot.slot_trajectories, xs, ys);
    }
    return { x: paddedRange(xs), y: paddedRange(ys) };
  }, [plot, panels.length, useNormalized, comparisonMode]);

  const presentVowels = useMemo(() => {
    if (!plot) return [];
    const vowels = new Set<string>();
    for (const occurrence of plot.occurrences) {
      for (const token of occurrence.vowels) vowels.add(token.vowel);
    }
    return [...vowels].sort();
  }, [plot]);

  const cols = panels.length === 1 ? 1 : panels.length <= 4 ? 2 : 3;
  const showSuggestions = words && words.matches.length > 0 && !exactMatch;
  const showNoMatches = debouncedWord.trim() && words && words.matches.length === 0;
  const activeVoiceLabel =
    speakers.length === 0
      ? "All voices"
      : speakers.length === 1
        ? `Voice ${speakers[0]}`
        : `${speakers.length} voices`;

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingBadge visible={loadingWords || loadingPlot} />

      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3">
        <label className="flex min-w-72 flex-col gap-1 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recorded word
          </span>
          <input
            type="text"
            value={wordInput}
            onChange={(event) => setWordInput(event.target.value)}
            placeholder="hānau"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <label className="flex min-w-72 flex-col gap-1 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Word dropdown
          </span>
          <select
            value={
              allWords?.matches.some((match) => normalizeWordInput(match.word) === queryKey)
                ? allWords.matches.find((match) => normalizeWordInput(match.word) === queryKey)?.word
                : ""
            }
            onChange={(event) => setWordInput(event.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Select recorded word</option>
            {allWords?.matches.map((match) => (
              <option key={match.word} value={match.word}>
                {match.word} ({match.n_occurrences})
              </option>
            ))}
          </select>
        </label>

        {plot && (
          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{plot.word}</span>{" "}
            {plot.n_returned_occurrences}/{plot.n_occurrences} occurrences ·{" "}
            {plot.n_returned_vowel_tokens}/{plot.n_vowel_tokens} vowel tokens ·{" "}
            {plot.normalize ? "normalized" : "raw Hz"}
          </div>
        )}

        <div className="w-96 max-w-full">
          <SegmentedControl
            label="Compare"
            value={comparisonMode}
            onChange={setComparisonMode}
            options={[
              { value: "selected", label: "Selected avg" },
              { value: "corpus", label: "All avg" },
              { value: "speakers", label: "Speakers" },
            ]}
          />
        </div>

        <div className="flex min-w-[20rem] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Voice to graph
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSpeakers([]);
                setSpeakerMode("merged");
              }}
              className={voiceButtonClass(speakers.length === 0 && speakerMode === "merged")}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeakers([]);
                setSpeakerMode("separate");
              }}
              className={voiceButtonClass(speakers.length === 0 && speakerMode === "separate")}
            >
              Compare
            </button>
            {metadata.speakers.map((speaker) => (
              <button
                key={speaker}
                type="button"
                onClick={() => {
                  setSpeakers([speaker]);
                  setSpeakerMode("merged");
                }}
                className={voiceButtonClass(
                  speakers.length === 1 && speakers[0] === speaker && speakerMode === "merged",
                )}
              >
                {speaker}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {showSuggestions && (
        <div className="flex flex-wrap gap-2">
          {words.matches.map((match) => (
            <button
              key={match.word}
              type="button"
              onClick={() => setWordInput(match.word)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
            >
              {match.word}
              <span className="ml-2 font-mono text-[11px] text-slate-400">
                {match.n_occurrences}
              </span>
            </button>
          ))}
        </div>
      )}

      {showNoMatches && (
        <div className="text-sm text-slate-500">No recorded corpus words match this input.</div>
      )}

      {!plot && !debouncedWord.trim() && <div className="text-sm text-slate-500">No word selected.</div>}

      {plot && panels.length === 0 && (
        <div className="text-sm text-slate-500">No data for this word under the current filters.</div>
      )}

      {plot && audioExamples.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recorded audio
            </span>
            <span className="font-mono text-xs text-slate-400">{audioExamples.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {audioExamples.map((example) => (
              <div key={example.key} className="rounded-md border border-slate-100 p-3">
                <div className="mb-2 min-w-0 text-sm">
                  <div className="truncate font-semibold text-slate-800">{example.word}</div>
                  <div className="truncate text-xs text-slate-500">
                    {example.speaker} · {example.vowel} · {example.stress}
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-400">
                    {example.filename}
                  </div>
                </div>
                <AudioPlayer src={example.audioUrl} />
              </div>
            ))}
          </div>
        </div>
      )}

      {plot && panels.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <VowelLegend vowels={presentVowels} />
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {activeVoiceLabel}
              </span>
              <PlotKey mode={comparisonMode} />
            </div>
          </div>
          <div
            key={`grid-${cols}`}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {panels.map((panel) => (
              <CorpusWordPanel
                key={`${cols}-${panel.key}`}
                title={panel.title}
                occurrences={panel.occurrences}
                overlays={
                  comparisonMode === "corpus"
                    ? plot.corpus_slot_trajectories.map((trajectory) =>
                        overlayFromTrajectory(
                          trajectory,
                          "corpus",
                          `All avg ${trajectory.slot}. ${trajectory.vowel}`,
                          "corpus",
                        )
                      )
                    : comparisonMode === "speakers"
                      ? plot.speaker_slot_trajectories.map((trajectory) =>
                          overlayFromTrajectory(
                            trajectory,
                            "speaker",
                            `${trajectory.speaker} ${trajectory.slot}. ${trajectory.vowel}`,
                            `speaker-${trajectory.speaker}`,
                            trajectory.speaker,
                          )
                        )
                      : (speakerMode === "merged"
                          ? plot.slot_trajectories
                          : plot.speaker_slot_trajectories.filter(
                              (trajectory) => trajectory.speaker === panel.key,
                            )
                        ).map((trajectory) =>
                          overlayFromTrajectory(
                            trajectory,
                            "selected",
                            `${trajectory.slot}. ${trajectory.vowel}`,
                            "selected",
                            (trajectory as WordSpeakerSlotTrajectory).speaker,
                          )
                        )
                }
                useNormalized={plot.normalize}
                opacity={opacity}
                xRange={sharedRanges.x ?? undefined}
                yRange={sharedRanges.y ?? undefined}
                height={panels.length === 1 ? 500 : 360}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
