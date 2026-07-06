import type { Metadata, TokenSample } from "./api";
import type { SpeakerMode, StressMode } from "../store/filters";

export interface Panel {
  key: string;
  title: string;
  samples: TokenSample[];
  filter: Partial<Record<"speaker" | "stress", string>>;
}

/**
 * Group rows into the panels that should render. Implements the n_rendered_plots
 * rule from CLAUDE.md: speaker/stress separate modes create panels; merged/off
 * modes keep data in one panel.
 */
export function buildPanels(
  rows: TokenSample[],
  speakerMode: SpeakerMode,
  stressMode: StressMode = "off",
): Panel[] {
  const splitSpeaker = speakerMode === "separate";
  const splitStress = stressMode === "separate";
  if (!splitSpeaker && !splitStress) {
    return [{ key: "all", title: "All speakers", samples: rows, filter: {} }];
  }

  const byPanel = new Map<string, Panel>();
  for (const r of rows) {
    const speaker = splitSpeaker ? r.speaker : undefined;
    const stress = splitStress ? r.stress : undefined;
    const key =
      splitSpeaker && splitStress
        ? `${speaker}|${stress}`
        : splitSpeaker
          ? speaker ?? "all"
          : `stress:${stress}`;
    const existing = byPanel.get(key);
    if (existing) {
      existing.samples.push(r);
      continue;
    }
    const parts: string[] = [];
    if (speaker) parts.push(`Speaker ${speaker}`);
    if (stress) parts.push(`${stress} stress`);
    const filter: Panel["filter"] = {};
    if (speaker) filter.speaker = speaker;
    if (stress) filter.stress = stress;
    byPanel.set(key, {
      key,
      title: parts.length ? parts.join(" · ") : "All speakers",
      samples: [r],
      filter,
    });
  }
  return [...byPanel.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function selectedOrAllCount(selected: string[], all: string[]): number {
  return Math.max(1, selected.length > 0 ? selected.length : all.length);
}

export function projectedPanelCount(
  metadata: Pick<Metadata, "speakers" | "stresses">,
  speakers: string[],
  speakerMode: SpeakerMode,
  stresses: string[],
  stressMode: StressMode = "off",
): number {
  const speakerPanels =
    speakerMode === "separate" ? selectedOrAllCount(speakers, metadata.speakers) : 1;
  const stressPanels =
    stressMode === "separate" ? selectedOrAllCount(stresses, metadata.stresses) : 1;
  return speakerPanels * stressPanels;
}

export function useNormalizedForPanelCount(panelCount: number): boolean {
  return panelCount > 1;
}
