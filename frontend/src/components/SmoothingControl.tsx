import { useFilters } from "../store/filters";

const PRESETS = [
  { value: 0, label: "exact" },
  { value: 50, label: "lo" },
  { value: 500, label: "med" },
  { value: 2000, label: "hi" },
] as const;

const MAX = 10000;

/**
 * Smoothing-`s` control. SciPy's UnivariateSpline `s` is a sum-of-squared-
 * residuals tolerance — for Hz-scale formant data the useful range spans
 * 0–~5000, with most of the visual difference happening in 0–500. The slider
 * is logarithmic-feeling for that reason; a numeric input lets you dial in
 * an exact value, and presets jump to the four most-used regimes.
 */
export function SmoothingControl() {
  const value = useFilters((s) => s.smoothing);
  const setValue = useFilters((s) => s.setSmoothing);

  const sliderToS = (slider: number): number => Math.round((slider * slider) / 1000);
  const sToSlider = (s: number): number => Math.round(Math.sqrt(s * 1000));
  const sliderMax = sToSlider(MAX);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-500">
          Smoothing (s)
        </span>
        <input
          type="number"
          min={0}
          max={MAX}
          step={1}
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) setValue(Math.max(0, Math.min(MAX, n)));
          }}
          className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-xs"
        />
      </div>
      <input
        type="range"
        min={0}
        max={sliderMax}
        step={1}
        value={sToSlider(value)}
        onChange={(e) => setValue(sliderToS(parseInt(e.target.value, 10)))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500"
      />
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setValue(p.value)}
            className={
              "flex-1 rounded border px-1 py-0.5 text-[11px] transition " +
              (value === p.value
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
            }
          >
            {p.label}
            <span className="ml-1 text-slate-400">{p.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
