import { lazy, Suspense, type CSSProperties, type ComponentType } from "react";
import type { PlotMouseEvent } from "plotly.js";

export interface LazyPlotProps {
  data: unknown[];
  layout: unknown;
  config?: unknown;
  style?: CSSProperties;
  useResizeHandler?: boolean;
  onClick?: (e: Readonly<PlotMouseEvent>) => void;
}

const PlotImpl = lazy(async () => {
  const [factoryModule, plotlyModule] = await Promise.all([
    import("react-plotly.js/factory.js"),
    import("../lib/plotlyBundle"),
  ]);
  const createPlotlyComponent = unwrapDefault(factoryModule) as (
    p: unknown,
  ) => ComponentType<LazyPlotProps>;
  const plotly = unwrapDefault(plotlyModule);
  return { default: createPlotlyComponent(plotly) };
});

function unwrapDefault(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth++) {
    if (
      typeof current !== "object" ||
      current === null ||
      !("default" in current)
    ) {
      return current;
    }
    const next = (current as { default?: unknown }).default;
    if (next === undefined || next === current) return current;
    current = next;
  }
  return current;
}

export function LazyPlot(props: LazyPlotProps) {
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center rounded bg-slate-50 text-xs text-slate-400"
          style={props.style}
        >
          Loading plot…
        </div>
      }
    >
      <PlotImpl {...props} />
    </Suspense>
  );
}
