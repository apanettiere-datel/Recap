import { create } from 'zustand';

interface UIStore {
  hasCompletedOnboarding: boolean;
  setOnboardingComplete: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  hasCompletedOnboarding: false,
  setOnboardingComplete: () => set({ hasCompletedOnboarding: true }),
}));
