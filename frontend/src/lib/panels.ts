import type { TokenSample } from "./api";
import type { SpeakerMode } from "../store/filters";

export interface Panel {
  key: string;
  title: string;
  samples: TokenSample[];
}

/**
 * Group rows into the panels that should render. Implements the n_rendered_plots
 * rule from CLAUDE.md: separate-speakers mode → one panel per speaker; merged
 * → one panel total. (Stress-mode panel logic is added in step 5; for step 2
 * we render the un-grouped speaker view only.)
 */
export function buildPanels(rows: TokenSample[], speakerMode: SpeakerMode): Panel[] {
  if (speakerMode === "merged") {
    return [{ key: "all", title: "All speakers", samples: rows }];
  }
  const bySpeaker = new Map<string, TokenSample[]>();
  for (const r of rows) {
    const arr = bySpeaker.get(r.speaker);
    if (arr) arr.push(r);
    else bySpeaker.set(r.speaker, [r]);
  }
  return [...bySpeaker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([speaker, samples]) => ({
      key: speaker,
      title: `Speaker ${speaker}`,
      samples,
    }));
}
