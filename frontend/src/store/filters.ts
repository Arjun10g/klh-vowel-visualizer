import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SpeakerMode = "merged" | "separate";
export type StressMode = "off" | "overlay" | "separate";
export type Weighting = "mean_of_means" | "pooled";
export type PointMode = "auto" | "single" | "nine";
export type FunctionFilterMode = "ignore" | "include" | "exclude";

export interface FiltersState {
  speakers: string[];
  vowels: string[];
  stresses: string[];
  speakerMode: SpeakerMode;
  stressMode: StressMode;
  weighting: Weighting;
  pointMode: PointMode;
  wordQuery: string;
  functionWordModes: Record<string, FunctionFilterMode>;
  trajectoryOpacity: number;
  contourPointOpacity: number;
  smoothing: number;

  setSpeakers: (next: string[]) => void;
  setVowels: (next: string[]) => void;
  setStresses: (next: string[]) => void;
  setSpeakerMode: (m: SpeakerMode) => void;
  setStressMode: (m: StressMode) => void;
  setWeighting: (w: Weighting) => void;
  setPointMode: (m: PointMode) => void;
  setWordQuery: (q: string) => void;
  setFunctionWordMode: (column: string, mode: FunctionFilterMode) => void;
  setTrajectoryOpacity: (o: number) => void;
  setContourPointOpacity: (o: number) => void;
  setSmoothing: (s: number) => void;
}

export const useFilters = create<FiltersState>()(
  persist(
    (set) => ({
      // Sensible defaults: one speaker, two vowels — small fast filter so
      // the first render doesn't pull tens of thousands of points.
      speakers: ["LV"],
      vowels: ["ai", "ae"],
      stresses: [],
      speakerMode: "merged",
      stressMode: "off",
      weighting: "mean_of_means",
      pointMode: "auto",
      wordQuery: "",
      functionWordModes: {},
      trajectoryOpacity: 0.25,
      contourPointOpacity: 0.4,
      smoothing: 500,

      setSpeakers: (speakers) => set({ speakers }),
      setVowels: (vowels) => set({ vowels }),
      setStresses: (stresses) => set({ stresses }),
      setSpeakerMode: (speakerMode) => set({ speakerMode }),
      setStressMode: (stressMode) => set({ stressMode }),
      setWeighting: (weighting) => set({ weighting }),
      setPointMode: (pointMode) => set({ pointMode }),
      setWordQuery: (wordQuery) => set({ wordQuery }),
      setFunctionWordMode: (column, mode) =>
        set((state) => {
          const next = { ...state.functionWordModes };
          if (mode === "ignore") delete next[column];
          else next[column] = mode;
          return { functionWordModes: next };
        }),
      setTrajectoryOpacity: (trajectoryOpacity) => set({ trajectoryOpacity }),
      setContourPointOpacity: (contourPointOpacity) => set({ contourPointOpacity }),
      setSmoothing: (smoothing) => set({ smoothing }),
    }),
    {
      name: "klh-filters-v1",
      storage: createJSONStorage(() => localStorage),
      // Only persist the configuration, not the setter functions (Zustand
      // handles that automatically with partialize, but being explicit here
      // protects against future shape changes).
      partialize: (s) => ({
        speakers: s.speakers,
        vowels: s.vowels,
        stresses: s.stresses,
        speakerMode: s.speakerMode,
        stressMode: s.stressMode,
        weighting: s.weighting,
        pointMode: s.pointMode,
        wordQuery: s.wordQuery,
        functionWordModes: s.functionWordModes,
        trajectoryOpacity: s.trajectoryOpacity,
        contourPointOpacity: s.contourPointOpacity,
        smoothing: s.smoothing,
      }),
    },
  ),
);
