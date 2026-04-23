import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TabId =
  | "overall"
  | "individual"
  | "raw_contours"
  | "contours_only";

interface UiState {
  tab: TabId;
  setTab: (t: TabId) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      tab: "overall",
      setTab: (tab) => set({ tab }),
    }),
    {
      name: "klh-ui-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tab: s.tab }),
    },
  ),
);
