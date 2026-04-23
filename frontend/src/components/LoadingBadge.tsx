interface Props {
  visible: boolean;
}

/**
 * Pill-shaped "Loading…" badge that floats over the plot area without
 * blanking the existing data. Use during refetches so the user can keep
 * seeing the prior state while the new one's in flight.
 */
export function LoadingBadge({ visible }: Props) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed right-[21rem] top-20 z-10 flex items-center gap-2 rounded-full border border-indigo-200 bg-white/90 px-3 py-1 text-xs text-indigo-700 shadow-sm backdrop-blur">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
      Loading…
    </div>
  );
}
