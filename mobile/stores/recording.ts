import { create } from 'zustand';

type RecordingState = 'idle' | 'recording' | 'paused' | 'processing';

interface RecordingStore {
  state: RecordingState;
  seconds: number;
  mode: string;
  uri: string | null;
  setState: (state: RecordingState) => void;
  setSeconds: (s: number) => void;
  setMode: (m: string) => void;
  setUri: (u: string | null) => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingStore>((set) => ({
  state: 'idle',
  seconds: 0,
  mode: 'general',
  uri: null,
  setState: (state) => set({ state }),
  setSeconds: (seconds) => set({ seconds }),
  setMode: (mode) => set({ mode }),
  setUri: (uri) => set({ uri }),
  reset: () => set({ state: 'idle', seconds: 0, mode: 'general', uri: null }),
}));
