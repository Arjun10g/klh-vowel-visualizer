export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
      <div className="flex items-center justify-between">
        <span>
          Ka Leo Hawaiʻi Vowel Visualizer ·{" "}
          <a
            href="https://github.com/Arjun10g/klh-vowel-visualizer"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 hover:underline"
          >
            source
          </a>
          {" · data: "}
          <a
            href="https://github.com/tkettig/KLHData"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 hover:underline"
          >
            tkettig/KLHData
          </a>
        </span>
        <span className="font-mono text-slate-400">
          press <kbd className="rounded border border-slate-300 bg-white px-1">1</kbd>–
          <kbd className="rounded border border-slate-300 bg-white px-1">4</kbd> to switch tabs
        </span>
      </div>
    </footer>
  );
}
