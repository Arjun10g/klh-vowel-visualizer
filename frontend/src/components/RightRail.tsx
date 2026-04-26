import { useEffect, useRef, useState } from "react";

import { fetchTokenDetail, type TokenDetail } from "../lib/api";
import { speak } from "../lib/speech";
import { useSelection } from "../store/selection";
import { useTts } from "../store/tts";
import { AudioPlayer } from "./AudioPlayer";
import { TtsControls } from "./TtsControls";

type SelectedSample = NonNullable<ReturnType<typeof useSelection.getState>["sample"]>;

function formatHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function ttsSentence(d: TokenDetail): string {
  // Per CLAUDE.md: "Speaker {Speaker}, vowel {vowel}, word {word}, {stress} stress."
  return `Speaker ${d.speaker}, vowel ${d.vowel}, word ${d.word}, ${d.stress} stress.`;
}

function detailPreview(sample: SelectedSample): TokenDetail {
  return {
    token_id: sample.token_id,
    speaker: sample.speaker,
    filename: sample.filename,
    word: sample.word,
    vowel: sample.vowel,
    stress: sample.stress,
    previous_sound: sample.previous_sound,
    next_sound: sample.next_sound,
    start: sample.start,
    audio_url: sample.audio_url,
    interview_url: null,
    interview_seconds: null,
    interview_offset_available: false,
  };
}

export function RightRail() {
  const tokenId = useSelection((s) => s.tokenId);
  const selectedSample = useSelection((s) => s.sample);
  const clear = useSelection((s) => s.clear);
  const ttsEnabled = useTts((s) => s.enabled);
  const ttsRate = useTts((s) => s.rate);
  const ttsVoice = useTts((s) => s.voiceURI);

  const [detail, setDetail] = useState<TokenDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastSpokenId = useRef<string | null>(null);

  useEffect(() => {
    if (!tokenId) {
      setDetail(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setErr(null);
    if (selectedSample?.token_id === tokenId) {
      setDetail(detailPreview(selectedSample));
    } else {
      setDetail(null);
    }
    fetchTokenDetail(tokenId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        // Speak only once per token selection. Voice list may not be loaded
        // on the very first call — speak() handles that by falling back to
        // the system default.
        if (ttsEnabled && lastSpokenId.current !== d.token_id) {
          lastSpokenId.current = d.token_id;
          speak(ttsSentence(d), { rate: ttsRate, voiceURI: ttsVoice });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // ttsEnabled / ttsRate / ttsVoice deliberately omitted from deps —
    // changing them shouldn't re-speak the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, selectedSample]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Selection
        </h2>
        {tokenId && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            clear
          </button>
        )}
      </div>

      {!tokenId && (
        <p className="text-sm text-slate-400">Click a token to select it.</p>
      )}

      {err && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {detail && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-slate-700">
            <dt className="font-semibold">Speaker</dt>
            <dd>{detail.speaker}</dd>
            <dt className="font-semibold">Filename</dt>
            <dd className="truncate font-mono text-xs">{detail.filename}</dd>
            <dt className="font-semibold">Word</dt>
            <dd>{detail.word}</dd>
            <dt className="font-semibold">Vowel</dt>
            <dd>{detail.vowel}</dd>
            <dt className="font-semibold">Stress</dt>
            <dd>{detail.stress}</dd>
            <dt className="font-semibold">Prev / Next</dt>
            <dd>
              {detail.previous_sound ?? "∅"} / {detail.next_sound ?? "∅"}
            </dd>
          </dl>

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Audio
            </span>
            <AudioPlayer src={detail.audio_url} />
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Interview
            </span>
            {detail.interview_url && (
              <a
                href={detail.interview_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-600 hover:underline"
              >
                Open episode
              </a>
            )}
            {detail.interview_offset_available && detail.interview_seconds !== null ? (
              <a
                href={`#interview/${encodeURIComponent(detail.filename)}?t=${Math.floor(detail.interview_seconds)}`}
                className="text-sm text-indigo-600 hover:underline"
              >
                @ {formatHMS(detail.interview_seconds)}
              </a>
            ) : (
              <span
                className="cursor-not-allowed text-sm text-slate-400"
                title="Interview offset not available for this speaker."
              >
                @ —:— (offset not available)
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Text-to-speech
            </span>
            <TtsControls />
          </div>
        </>
      )}
    </aside>
  );
}
