import { useCallback, useEffect, useRef, useState } from "react";

import { dbfs, estimatePitch, rootMeanSquare, spectralCentroid } from "../lib/liveAudio";

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface AudioReading {
  pitch: number | null;
  pitchClarity: number | null;
  levelDb: number;
  centroid: number | null;
}

const FFT_SIZE = 2048;
const READOUT_INTERVAL_MS = 100;
const INITIAL_READING: AudioReading = {
  pitch: null,
  pitchClarity: null,
  levelDb: -120,
  centroid: null,
};

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return context;
}

function drawWaveform(canvas: HTMLCanvasElement, samples: Float32Array<ArrayBufferLike> | null): void {
  const context = prepareCanvas(canvas);
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = Math.max(1, width / 900);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  if (!samples || samples.length === 0) return;

  context.strokeStyle = "#0f766e";
  context.lineWidth = Math.max(2, width / 700);
  context.beginPath();
  for (let x = 0; x < width; x++) {
    const sampleIndex = Math.min(samples.length - 1, Math.floor((x / (width - 1 || 1)) * samples.length));
    const y = height / 2 - samples[sampleIndex] * height * 0.43;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function spectrumColor(db: number): string {
  const value = Math.max(0, Math.min(1, (db + 100) / 75));
  const stops = [
    [7, 18, 30],
    [14, 72, 133],
    [17, 142, 170],
    [247, 190, 59],
    [229, 91, 68],
  ];
  const position = value * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const mix = position - lower;
  const channel = (index: number) => Math.round(stops[lower][index] + (stops[upper][index] - stops[lower][index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function drawSpectrogram(
  canvas: HTMLCanvasElement,
  frequencyDb: Float32Array<ArrayBufferLike> | null,
  sampleRate: number,
  maxFrequency: number,
): void {
  const context = prepareCanvas(canvas);
  if (!context) return;
  const { width, height } = canvas;
  if (!frequencyDb) {
    context.fillStyle = "#07121e";
    context.fillRect(0, 0, width, height);
    return;
  }
  const columnWidth = Math.max(1, Math.round(width / 280));
  context.drawImage(canvas, -columnWidth, 0);
  context.fillStyle = "#07121e";
  context.fillRect(width - columnWidth, 0, columnWidth, height);
  const binHz = sampleRate / FFT_SIZE;
  const maxBin = Math.min(frequencyDb.length - 1, Math.floor(maxFrequency / binHz));
  for (let y = 0; y < height; y++) {
    const progress = 1 - y / Math.max(1, height - 1);
    const bin = Math.min(maxBin, Math.round(progress * maxBin));
    context.fillStyle = spectrumColor(frequencyDb[bin]);
    context.fillRect(width - columnWidth, y, columnWidth, 1);
  }
}

function formatHz(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "--" : `${value.toFixed(0)} Hz`;
}

function formatDb(value: number): string {
  return `${Math.max(-120, value).toFixed(1)} dBFS`;
}

export function LiveAudioTab() {
  const [listening, setListening] = useState(false);
  const [maxFrequency, setMaxFrequency] = useState(6000);
  const [reading, setReading] = useState<AudioReading>(INITIAL_READING);
  const [err, setErr] = useState<string | null>(null);

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastReadoutRef = useRef(0);
  const maxFrequencyRef = useRef(maxFrequency);

  const clearCanvases = useCallback(() => {
    if (waveformCanvasRef.current) drawWaveform(waveformCanvasRef.current, null);
    if (spectrogramCanvasRef.current) drawSpectrogram(spectrogramCanvasRef.current, null, 1, 1);
  }, []);

  useEffect(() => {
    maxFrequencyRef.current = maxFrequency;
  }, [maxFrequency]);

  useEffect(() => {
    const redraw = () => clearCanvases();
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [clearCanvases]);

  const stopMic = useCallback((updateState = true) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    lastReadoutRef.current = 0;
    if (updateState) setListening(false);
  }, []);

  useEffect(() => {
    return () => stopMic(false);
  }, [stopMic]);

  const clearMonitor = useCallback(() => {
    setReading(INITIAL_READING);
    clearCanvases();
  }, [clearCanvases]);

  const startMic = useCallback(async () => {
    if (listening) return;
    const AudioCtx = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtx || !navigator.mediaDevices?.getUserMedia) {
      setErr("This browser cannot open a live microphone stream.");
      return;
    }

    try {
      setErr(null);
      clearMonitor();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioContext = new AudioCtx();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const silentGain = audioContext.createGain();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = -110;
      analyser.maxDecibels = -25;
      analyser.smoothingTimeConstant = 0.45;
      silentGain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
      silentGainRef.current = silentGain;
      lastReadoutRef.current = 0;
      setListening(true);

      const timeData = new Float32Array(analyser.fftSize);
      const frequencyData = new Float32Array(analyser.frequencyBinCount);
      const tick = (now: number) => {
        const activeAnalyser = analyserRef.current;
        const activeAudioContext = audioContextRef.current;
        if (!activeAnalyser || !activeAudioContext) return;
        activeAnalyser.getFloatTimeDomainData(timeData);
        activeAnalyser.getFloatFrequencyData(frequencyData);
        if (waveformCanvasRef.current) drawWaveform(waveformCanvasRef.current, timeData);
        if (spectrogramCanvasRef.current) {
          drawSpectrogram(
            spectrogramCanvasRef.current,
            frequencyData,
            activeAudioContext.sampleRate,
            maxFrequencyRef.current,
          );
        }
        if (now - lastReadoutRef.current >= READOUT_INTERVAL_MS) {
          lastReadoutRef.current = now;
          const rms = rootMeanSquare(timeData);
          const pitch = estimatePitch(timeData, activeAudioContext.sampleRate);
          setReading({
            pitch: pitch?.hz ?? null,
            pitchClarity: pitch?.clarity ?? null,
            levelDb: dbfs(rms),
            centroid: spectralCentroid(frequencyData, activeAudioContext.sampleRate, activeAnalyser.fftSize),
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      if (audioContext.state === "suspended") await audioContext.resume().catch(() => undefined);
    } catch (error: unknown) {
      stopMic();
      setErr(error instanceof Error ? error.message : String(error));
    }
  }, [clearMonitor, listening, stopMic]);

  const voiced = reading.pitch !== null && (reading.pitchClarity ?? 0) >= 0.58;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3">
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
          onClick={clearMonitor}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
        >
          Clear monitor
        </button>

        <label className="flex min-w-40 flex-col gap-1 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Spectrum range
          </span>
          <select
            value={maxFrequency}
            onChange={(event) => {
              setMaxFrequency(Number(event.target.value));
              if (spectrogramCanvasRef.current) {
                drawSpectrogram(spectrogramCanvasRef.current, null, 1, 1);
              }
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            {[4000, 6000, 8000, 10000].map((value) => (
              <option key={value} value={value}>{value / 1000} kHz</option>
            ))}
          </select>
        </label>

        <span className="text-sm font-medium text-slate-700">
          {listening ? "Listening" : "Idle"}
        </span>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pitch</div>
          <div className="mt-1 font-mono text-xl text-slate-800">{formatHz(reading.pitch)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loudness</div>
          <div className="mt-1 font-mono text-xl text-slate-800">{formatDb(reading.levelDb)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spectral centroid</div>
          <div className="mt-1 font-mono text-xl text-slate-800">{formatHz(reading.centroid)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Voicing</div>
          <div className={"mt-1 text-xl font-semibold " + (voiced ? "text-emerald-700" : "text-slate-400")}>
            {voiced ? "Voiced" : "Unvoiced"}
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Waveform</h2>
            <span className="font-mono text-xs text-slate-400">{FFT_SIZE} samples</span>
          </div>
          <canvas
            ref={waveformCanvasRef}
            aria-label="Live voice waveform"
            className="h-56 w-full rounded border border-slate-200"
          />
        </section>

        <section className="border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Spectrogram</h2>
            <span className="font-mono text-xs text-slate-400">0-{maxFrequency / 1000} kHz</span>
          </div>
          <canvas
            ref={spectrogramCanvasRef}
            aria-label="Live voice spectrogram"
            className="h-56 w-full rounded border border-slate-200"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
            <span>{maxFrequency / 1000} kHz</span>
            <span>0 Hz</span>
          </div>
        </section>
      </div>
    </div>
  );
}
