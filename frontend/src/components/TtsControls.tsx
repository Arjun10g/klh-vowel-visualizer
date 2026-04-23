import { useEffect, useState } from "react";

import { isSpeechSupported, subscribeVoices } from "../lib/speech";
import { useTts } from "../store/tts";

export function TtsControls() {
  const supported = isSpeechSupported();
  const enabled = useTts((s) => s.enabled);
  const setEnabled = useTts((s) => s.setEnabled);
  const rate = useTts((s) => s.rate);
  const setRate = useTts((s) => s.setRate);
  const voiceURI = useTts((s) => s.voiceURI);
  const setVoice = useTts((s) => s.setVoice);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => subscribeVoices(setVoices), []);

  if (!supported) {
    return (
      <p className="text-xs text-slate-400">
        Text-to-speech not supported in this browser.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between text-sm text-slate-700">
        <span className="font-semibold">Speak on click</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-indigo-500"
        />
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wide text-slate-500">
            Rate
          </span>
          <span className="font-mono text-slate-600">{rate.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={rate}
          onChange={(e) => setRate(parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500"
          disabled={!enabled}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Voice
        </span>
        <select
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
          value={voiceURI ?? ""}
          onChange={(e) => setVoice(e.target.value || null)}
          disabled={!enabled || voices.length === 0}
        >
          <option value="">System default</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
