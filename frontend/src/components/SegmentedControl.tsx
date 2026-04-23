interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                "flex-1 rounded px-2 py-1 text-sm transition " +
                (active
                  ? "bg-indigo-500 text-white"
                  : "text-slate-600 hover:bg-slate-50")
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
