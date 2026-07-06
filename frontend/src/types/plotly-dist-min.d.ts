declare module "plotly.js/lib/core" {
  import type * as Plotly from "plotly.js";

  const value: typeof Plotly;
  export default value;
}

declare module "plotly.js/lib/contour" {
  import type { PlotlyModule } from "plotly.js";

  const value: PlotlyModule;
  export default value;
}

declare module "plotly.js/lib/scatter" {
  import type { PlotlyModule } from "plotly.js";

  const value: PlotlyModule;
  export default value;
}
