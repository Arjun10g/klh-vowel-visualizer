import type { FunctionFilterMode } from "../store/filters";

export function functionFilterParams(modes: Record<string, FunctionFilterMode>): {
  function_include?: string[];
  function_exclude?: string[];
} {
  const function_include = Object.entries(modes)
    .filter(([, mode]) => mode === "include")
    .map(([column]) => column);
  const function_exclude = Object.entries(modes)
    .filter(([, mode]) => mode === "exclude")
    .map(([column]) => column);
  return {
    function_include: function_include.length > 0 ? function_include : undefined,
    function_exclude: function_exclude.length > 0 ? function_exclude : undefined,
  };
}
