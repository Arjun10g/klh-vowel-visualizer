import { useEffect, useState } from "react";

/**
 * Returns `value` clamped to update at most once every `delayMs`.
 * Use this to drive expensive effects (like /api/trajectories fetches that
 * recompute splines server-side) from rapidly-changing inputs like sliders.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Bind keyboard shortcuts. Map: key (single char or 'Escape' etc.) → handler.
 * Ignores events whose target is an editable element so typing in inputs
 * doesn't accidentally fire shortcuts.
 */
export function useKeyboardShortcuts(map: Record<string, () => void>): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [map]);
}
