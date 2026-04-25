import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import factoryModule from "react-plotly.js/factory";
import plotlyModule from "plotly.js-dist-min";

import {
  fetchTokens,
  fetchTrajectories,
  type GroupByDim,
  type Metadata,
  type TokenSample,
  type TrajectoriesResponse,
  type TrajectoryGroup,
} from "../lib/api";
import { colorForVowel } from "../lib/colors";
import { estimateFormants, type FormantEstimate } from "../lib/liveFormants";
import { useDebouncedValue } from "../lib/hooks";
import { useFilters } from "../store/filters";
import { LoadingBadge } from "./LoadingBadge";
import { type AxisRange } from "./PlotPanel";
import { SegmentedControl } from "./SegmentedControl";
import { AudioPlayer } from "./AudioPlayer";

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

type TargetMode = "average" | "voices";

interface Props {
  metadata: Metadata;
}

interface LivePoint extends FormantEstimate {
  elapsed: number;
}

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const DEFAULT_X_RANGE: AxisRange = [500, 3000];
const DEFAULT_Y_RANGE: AxisRange = [200, 1100];
const PADDING = 0.08;

const SPEAKER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
];

function paddedRange(values: number[], fallback: AxisRange): AxisRange {
  if (values.length === 0) return fallback;
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return fallback;
  const span = hi - lo || 1;
  return [lo - span * PADDING, hi + span * PADDING];
}

function colorForSpeaker(speaker: string): string {
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) % SPEAKER_COLORS.length;
  }
  return SPEAKER_COLORS[hash];
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function targetTraceName(group: TrajectoryGroup, targetMode: TargetMode): string {
  if (targetMode === "voices") {
    return group.dimensions.speaker ? `Voice ${group.dimensions.speaker}` : "Corpus voice";
  }
  return "Corpus average";
}

function uniqueTokenExamples(rows: TokenSample[], limit = 6): TokenSample[] {
  const out: TokenSample[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.token_id)) continue;
    seen.add(row.token_id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function LiveVoiceTab({ metadata }: Props) {
  const speakers = useFilters((s) => s.speakers);
  const stresses = useFilters((s) => s.stresses);
  const weighting = useFilters((s) => s.weighting);
  const smoothingRaw = useFilters((s) => s.smoothing);
  const smoothing = useDebouncedValue(smoothingRaw, 200);

  const [targetVowel, setTargetVowel] = useState(() =>
    metadata.vowels.includes("a") ? "a" : metadata.vowels[0] ?? "",
  );
  const [targetMode, setTargetMode] = useState<TargetMode>("average");
  const [targetData, setTargetData] = useState<TrajectoriesResponse | null>(null);
  const [exampleTokens, setExampleTokens] = useState<TokenSample[]>([]);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<FormantEstimate | null>(null);
  const [points, setPoints] = useState<LivePoint[]>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const lastTickRef = useRef(0);
  const startTimeRef = useRef(0);

  const stopMic = useCallback((updateState = true) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    bufferRef.current = null;
    lastTickRef.current = 0;
    if (updateState) setListening(false);
  }, []);

  useEffect(() => {
    return () => stopMic(false);
  }, [stopMic]);

  const targetGroupBy = useMemo<GroupByDim[]>(
    () => (targetMode === "voices" ? ["speaker"] : ["none"]),
    [targetMode],
  );

  const targetRequestKey = JSON.stringify({
    targetVowel,
    targetMode,
    speakers,
    stresses,
    weighting,
    smoothing,
  });

  useEffect(() => {
    if (!targetVowel) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoadingTarget(true);
    });
    fetchTrajectories({
      speakers,
      vowels: [targetVowel],
      stresses,
      normalize: "false",
      group_by: targetGroupBy,
      weighting,
      smoothing,
      n_eval_points: 100,
    })
      .then((data) => {
        if (!cancelled) {
          setErr(null);
          setTargetData(data);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingTarget(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetRequestKey, targetVowel, targetGroupBy, speakers, stresses, weighting, smoothing]);

  const examplesRequestKey = JSON.stringify({
    targetVowel,
    speakers,
    stresses,
  });

  useEffect(() => {
    if (!targetVowel) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setLoadingExamples(true);
    });
    fetchTokens({
      speakers,
      vowels: [targetVowel],
      stresses,
      limit: 8,
    })
      .then((data) => {
        if (!cancelled) {
          setErr(null);
          setExampleTokens(uniqueTokenExamples(data.rows));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingExamples(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examplesRequestKey, targetVowel, speakers, stresses]);

  const startMic = useCallback(async () => {
    if (listening) return;
    const AudioCtx =
      window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtx || !navigator.mediaDevices?.getUserMedia) {
      setErr("This browser cannot open a live microphone stream.");
      return;
    }

    try {
      setErr(null);
      setEstimate(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      audioCtx.createMediaStreamSource(stream).connect(analyser);

      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      bufferRef.current = new Float32Array(analyser.fftSize);
      lastTickRef.current = 0;
      startTimeRef.current = performance.now();
      setListening(true);

      const tick = (now: number) => {
        const currentAnalyser = analyserRef.current;
        const currentAudioCtx = audioCtxRef.current;
        const buffer = bufferRef.current;
        if (!currentAnalyser || !currentAudioCtx || !buffer) return;
        rafRef.current = requestAnimationFrame(tick);
        if (now - lastTickRef.current < 90) return;
        lastTickRef.current = now;
        currentAnalyser.getFloatTimeDomainData(buffer);
        const next = estimateFormants(buffer, currentAudioCtx.sampleRate);
        if (!next) return;
        setEstimate(next);
        setPoints((prev) => [
          ...prev.slice(-119),
          { ...next, elapsed: (now - startTimeRef.current) / 1000 },
        ]);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (e: unknown) {
      stopMic();
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [listening, stopMic]);

  const targetGroups = useMemo(() => {
    if (!targetData) return [];
    return targetData.groups.filter((group) => group.vowel === targetVowel && group.points.length > 0);
  }, [targetData, targetVowel]);

  const ranges = useMemo(() => {
    const xs = [...DEFAULT_X_RANGE];
    const ys = [...DEFAULT_Y_RANGE];
    for (const group of targetGroups) {
      for (const point of group.points) {
        xs.push(point.f2);
        ys.push(point.f1);
      }
    }
    for (const point of points) {
      xs.push(point.f2);
      ys.push(point.f1);
    }
    return {
      x: paddedRange(xs, DEFAULT_X_RANGE),
      y: paddedRange(ys, DEFAULT_Y_RANGE),
    };
  }, [targetGroups, points]);

  const targetTraces = useMemo(() => {
    return targetGroups.map((group) => {
      const speaker = group.dimensions.speaker ?? "";
      const color = targetMode === "voices" ? colorForSpeaker(speaker) : colorForVowel(group.vowel);
      return {
        type: "scatter",
        mode: "lines",
        name: targetTraceName(group, targetMode),
        x: group.points.map((point) => point.f2),
        y: group.points.map((point) => point.f1),
        line: {
          color,
          width: targetMode === "voices" ? 2.5 : 4,
          dash: targetMode === "voices" ? "dot" : "solid",
          shape: "spline",
        },
        opacity: targetMode === "voices" ? 0.88 : 1,
        hovertemplate:
          `${targetTraceName(group, targetMode)}<br>${group.vowel} (${group.n_tokens} tokens)` +
          "<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: true,
      };
    });
  }, [targetGroups, targetMode]);

  const liveTrailTrace = points.length > 0
    ? {
        type: "scatter",
        mode: "lines+markers",
        name: "Live voice",
        x: points.map((point) => point.f2),
        y: points.map((point) => point.f1),
        text: points.map((point) =>
          `t=${point.elapsed.toFixed(1)}s · confidence=${point.confidence.toFixed(2)}`
        ),
        line: { color: "#0f172a", width: 3, shape: "spline" },
        marker: {
          color: points.map((point) => point.confidence),
          colorscale: [
            [0, "#94a3b8"],
            [0.5, "#38bdf8"],
            [1, "#14b8a6"],
          ],
          cmin: 0,
          cmax: 1,
          size: 7,
          line: { color: "#ffffff", width: 1 },
        },
        hovertemplate: "%{text}<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: true,
      }
    : null;

  const currentPointTrace = estimate
    ? {
        type: "scatter",
        mode: "markers",
        name: "Current",
        x: [estimate.f2],
        y: [estimate.f1],
        marker: {
          color: "#ef4444",
          size: 15,
          line: { color: "#ffffff", width: 2 },
          symbol: "circle",
        },
        hovertemplate:
          `Current<br>confidence=${estimate.confidence.toFixed(2)}` +
          "<br>F2=%{x:.1f}, F1=%{y:.1f}<extra></extra>",
        showlegend: true,
      }
    : null;

  const traces = [
    ...targetTraces,
    ...(liveTrailTrace ? [liveTrailTrace] : []),
    ...(currentPointTrace ? [currentPointTrace] : []),
  ];

  const selectedSpeakerLabel =
    speakers.length === 0
      ? "All corpus voices"
      : speakers.length === 1
        ? `Corpus voice ${speakers[0]}`
        : `${speakers.length} corpus voices`;

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingBadge visible={loadingTarget || loadingExamples} />

      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3">
        <label className="flex min-w-40 flex-col gap-1 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Vowel
          </span>
          <select
            value={targetVowel}
            onChange={(event) => setTargetVowel(event.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            {metadata.vowels.map((vowel) => (
              <option key={vowel} value={vowel}>
                {vowel}
              </option>
            ))}
          </select>
        </label>

        <div className="w-64 max-w-full">
          <SegmentedControl
            label="Corpus target"
            value={targetMode}
            onChange={setTargetMode}
            options={[
              { value: "average", label: "Average" },
              { value: "voices", label: "Voices" },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={listening ? () => stopMic() : startMic}
          className={
            "rounded-md border px-4 py-2 text-sm font-semibold transition " +
            (listening
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-indigo-500 bg-indigo-500 text-white shadow-sm hover:bg-indigo-600")
          }
        >
          {listening ? "Stop mic" : "Start mic"}
        </button>

        <button
          type="button"
          onClick={() => {
            setPoints([]);
            setEstimate(null);
          }}
          disabled={points.length === 0 && !estimate}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear trail
        </button>

        <div className="min-w-64 flex-1 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{selectedSpeakerLabel}</span>
          {" · "}
          F1 {formatNumber(estimate?.f1)} Hz · F2 {formatNumber(estimate?.f2)} Hz · confidence{" "}
          {formatNumber(estimate?.confidence, 2)}
        </div>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
          <Plot
            data={traces}
            layout={{
              title: {
                text: `Live vowel: ${targetVowel || "none"}`,
                font: { size: 13, family: "system-ui, sans-serif" },
              },
              xaxis: {
                title: { text: "F2 (Hz)", font: { size: 12 } },
                autorange: false,
                range: [ranges.x[1], ranges.x[0]],
                zeroline: false,
                gridcolor: "#e5e7eb",
                tickfont: { size: 11 },
              },
              yaxis: {
                title: { text: "F1 (Hz)", font: { size: 12 } },
                autorange: false,
                range: [ranges.y[1], ranges.y[0]],
                zeroline: false,
                gridcolor: "#e5e7eb",
                tickfont: { size: 11 },
              },
              margin: { l: 58, r: 18, t: 38, b: 50 },
              showlegend: true,
              legend: {
                orientation: "h",
                x: 0,
                y: 1.08,
                font: { size: 11 },
              },
              plot_bgcolor: "#f8fafc",
              paper_bgcolor: "#ffffff",
              hovermode: "closest",
              hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff", size: 12 } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", height: "560px" }}
            useResizeHandler
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Live reading
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">F1</dt>
              <dd className="text-right font-mono text-slate-800">{formatNumber(estimate?.f1)} Hz</dd>
              <dt className="text-slate-500">F2</dt>
              <dd className="text-right font-mono text-slate-800">{formatNumber(estimate?.f2)} Hz</dd>
              <dt className="text-slate-500">RMS</dt>
              <dd className="text-right font-mono text-slate-800">{formatNumber(estimate?.rms, 3)}</dd>
              <dt className="text-slate-500">Confidence</dt>
              <dd className="text-right font-mono text-slate-800">
                {formatNumber(estimate?.confidence, 2)}
              </dd>
            </dl>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Corpus target
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span>Mode</span>
                <span className="font-medium text-slate-800">
                  {targetMode === "voices" ? "Voice paths" : "Average path"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Groups</span>
                <span className="font-mono text-slate-800">{targetGroups.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Trail</span>
                <span className="font-mono text-slate-800">{points.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Smoothing</span>
                <span className="font-mono text-slate-800">{smoothing.toFixed(0)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recorded audio
              </div>
              <span className="font-mono text-xs text-slate-400">{exampleTokens.length}</span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {exampleTokens.length === 0 && (
                <div className="text-sm text-slate-500">
                  {loadingExamples ? "Loading…" : "No recorded examples for this filter."}
                </div>
              )}
              {exampleTokens.map((token) => (
                <div key={token.token_id} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-800">{token.word}</div>
                      <div className="truncate text-xs text-slate-500">
                        {token.speaker} · {token.vowel} · {token.stress}
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {token.time.toFixed(1)}
                    </span>
                  </div>
                  <AudioPlayer src={token.audio_url} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
