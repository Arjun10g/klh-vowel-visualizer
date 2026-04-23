import type { Metadata } from "../lib/api";
import { useFilters } from "../store/filters";

interface Props {
  metadata: Metadata;
}

/**
 * Quick filter presets for vowels: monophthongs only, diphthongs only, the
 * four canonical diphthongs from CLAUDE.md's reference chart, or all.
 */
export function VowelPresets({ metadata }: Props) {
  const setVowels = useFilters((s) => s.setVowels);
  const presets: { label: string; vowels: string[]; title: string }[] = [
    {
      label: "Monoph.",
      title: "All monophthongs (a, ā, e, ē, i, ī, o, ō, u, ū)",
      vowels: metadata.vowels.filter((v) => metadata.vowel_types[v] === "monophthong"),
    },
    {
      label: "Diphth.",
      title: "All diphthongs",
      vowels: metadata.vowels.filter((v) => metadata.vowel_types[v] === "diphthong"),
    },
    {
      label: "ai/ae/ao/au",
      title: "The reference-chart diphthongs (LV smoothing target)",
      vowels: ["ai", "ae", "ao", "au"].filter((v) => metadata.vowels.includes(v)),
    },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          title={p.title}
          onClick={() => setVowels(p.vowels)}
          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
