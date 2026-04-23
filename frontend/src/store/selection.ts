import { create } from "zustand";

import type { TokenSample } from "../lib/api";

export interface SelectionState {
  tokenId: string | null;
  sample: TokenSample | null;
  select: (sample: TokenSample) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  tokenId: null,
  sample: null,
  select: (sample) => set({ tokenId: sample.token_id, sample }),
  clear: () => set({ tokenId: null, sample: null }),
}));
