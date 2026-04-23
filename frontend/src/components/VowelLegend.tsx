import { colorForVowel } from "../lib/colors";

interface Props {
  vowels: string[];
}

/**
 * Single shared legend rendered above the panel grid. Lives outside Plotly so
 * each panel can have identical margins — Plotly's per-panel legend was
 * shrinking panel 1's plot area asymmetrically.
 */
export function VowelLegend({ vowels }: Props) {
  if (vowels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vowel
      </span>
      {vowels.map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border border-slate-200"
            style={{ background: colorForVowel(v) }}
          />
          <span className="font-medium text-slate-700">{v}</span>
        </span>
      ))}
    </div>
  );
}
