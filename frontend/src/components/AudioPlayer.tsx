import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
}

const SPEED_OPTIONS = [0.25, 0.5, 1.0] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

/**
 * Native <audio> element with a 0.25× default playback rate (per CLAUDE.md —
 * the original app shipped at 1.0× and was painful to use for analysis).
 *
 * Resetting `playbackRate` on every src change matters: <audio> resets the
 * rate to 1.0 when src changes, so we re-apply the user's selection.
 */
export function AudioPlayer({ src }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState<Speed>(0.25);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed, src]);

  // Reset error state on every new src so a transient failure on one token
  // doesn't shadow the next one.
  useEffect(() => {
    setErrMsg(null);
  }, [src]);

  return (
    <div className="flex flex-col gap-2">
      <audio
        ref={audioRef}
        controls
        src={src}
        preload="metadata"
        className="w-full"
        onError={(e) => {
          const code = (e.currentTarget.error?.code ?? 0) as number;
          // 1 ABORTED, 2 NETWORK, 3 DECODE, 4 SRC_NOT_SUPPORTED
          const labels: Record<number, string> = {
            1: "Loading aborted",
            2: "Network error",
            3: "Decode error",
            4: "Audio not available (404 or unsupported format)",
          };
          setErrMsg(labels[code] ?? `Audio failed (code ${code})`);
        }}
      />
      {errMsg && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {errMsg}.{" "}
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open file ↗
          </a>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Speed
        </span>
        <div className="ml-2 flex rounded-md border border-slate-200 bg-white p-0.5">
          {SPEED_OPTIONS.map((s) => {
            const active = s === speed;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={
                  "rounded px-2 py-0.5 text-xs transition " +
                  (active
                    ? "bg-indigo-500 text-white"
                    : "text-slate-600 hover:bg-slate-50")
                }
              >
                {s}×
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
