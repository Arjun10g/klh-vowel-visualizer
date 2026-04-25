import { useMemo } from "react";

import { useKeyboardShortcuts } from "../lib/hooks";
import { useUi, type TabId } from "../store/ui";

interface TabSpec {
  id: TabId;
  label: string;
  shortcut: string;
}

const TABS: TabSpec[] = [
  { id: "overall", label: "Overall Trajectories", shortcut: "1" },
  { id: "individual", label: "Individual Trajectories", shortcut: "2" },
  { id: "raw_contours", label: "Raw Contours", shortcut: "3" },
  { id: "contours_only", label: "Contours Only", shortcut: "4" },
  // Corpus Word is paused for now; keep the tab spec here so it is easy to restore.
  // { id: "corpus_word", label: "Corpus Word", shortcut: "5" },
  { id: "live_voice", label: "Live Voice", shortcut: "6" },
];

export function TabNav() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);

  const shortcutMap = useMemo(() => {
    const m: Record<string, () => void> = {};
    for (const t of TABS) m[t.shortcut] = () => setTab(t.id);
    return m;
  }, [setTab]);
  useKeyboardShortcuts(shortcutMap);

  return (
    <nav className="flex border-b border-slate-200 bg-slate-50 text-sm">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            title={`Press ${t.shortcut} to switch`}
            className={
              "border-b-2 px-4 py-2 transition " +
              (active
                ? "border-indigo-500 text-indigo-700"
                : "border-transparent text-slate-600 hover:text-slate-900")
            }
          >
            {t.label}
            <span className="ml-2 rounded border border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-400">
              {t.shortcut}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
