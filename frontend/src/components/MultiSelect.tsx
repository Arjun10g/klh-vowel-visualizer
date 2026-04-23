interface Props {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function MultiSelect({ label, options, selected, onChange }: Props) {
  const selectedSet = new Set(selected);
  const toggle = (opt: string) => {
    const next = new Set(selectedSet);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    // Preserve options order so the active set is deterministic for the API.
    onChange(options.filter((o) => next.has(o)));
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}{" "}
          {selected.length > 0 && (
            <span className="font-normal text-slate-400">({selected.length})</span>
          )}
        </span>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700"
            onClick={() => onChange(options)}
          >
            all
          </button>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700"
            onClick={() => onChange([])}
          >
            none
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = selectedSet.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={
                "rounded-md border px-2 py-1 text-sm transition " +
                (active
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
