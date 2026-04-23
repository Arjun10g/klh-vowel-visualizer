import { create } from "zustand";

export interface TtsState {
  enabled: boolean;
  rate: number;
  voiceURI: string | null;
  setEnabled: (b: boolean) => void;
  setRate: (n: number) => void;
  setVoice: (uri: string | null) => void;
}

export const useTts = create<TtsState>((set) => ({
  enabled: false,
  rate: 1.0,
  voiceURI: null,
  setEnabled: (enabled) => set({ enabled }),
  setRate: (rate) => set({ rate }),
  setVoice: (voiceURI) => set({ voiceURI }),
}));
