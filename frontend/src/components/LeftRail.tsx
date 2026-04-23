import type { Metadata } from "../lib/api";
import { useFilters } from "../store/filters";
import { MultiSelect } from "./MultiSelect";
import { SegmentedControl } from "./SegmentedControl";
import { Slider } from "./Slider";
import { SmoothingControl } from "./SmoothingControl";
import { VowelPresets } from "./VowelPresets";

interface Props {
  metadata: Metadata;
}

export function LeftRail({ metadata }: Props) {
  const f = useFilters();
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
        Filters
      </h2>

      <MultiSelect
        label="Speakers"
        options={metadata.speakers}
        selected={f.speakers}
        onChange={f.setSpeakers}
      />
      <MultiSelect
        label="Vowels"
        options={metadata.vowels}
        selected={f.vowels}
        onChange={f.setVowels}
      />
      <VowelPresets metadata={metadata} />
      <MultiSelect
        label="Stress"
        options={metadata.stresses}
        selected={f.stresses}
        onChange={f.setStresses}
      />

      <SegmentedControl
        label="Speaker mode"
        value={f.speakerMode}
        onChange={f.setSpeakerMode}
        options={[
          { value: "merged", label: "Merged" },
          { value: "separate", label: "Separate" },
        ]}
      />
      <SegmentedControl
        label="Stress mode"
        value={f.stressMode}
        onChange={f.setStressMode}
        options={[
          { value: "off", label: "Off" },
          { value: "overlay", label: "Overlay" },
          { value: "separate", label: "Separate" },
        ]}
      />
      <SegmentedControl
        label="Weighting"
        value={f.weighting}
        onChange={f.setWeighting}
        options={[
          { value: "mean_of_means", label: "Mean of means" },
          { value: "pooled", label: "Pooled" },
        ]}
      />

      <Slider
        label="Trajectory opacity"
        min={0.05}
        max={1}
        step={0.05}
        value={f.trajectoryOpacity}
        onChange={f.setTrajectoryOpacity}
      />
      <Slider
        label="Contour-point opacity"
        min={0.05}
        max={1}
        step={0.05}
        value={f.contourPointOpacity}
        onChange={f.setContourPointOpacity}
      />
      <SmoothingControl />
    </aside>
  );
}
