import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Preferences {
  notificationsEnabled: boolean;
  notifyOnProcessingDone: boolean;
  notifyDailyBriefing: boolean;
  notifyOverdueCommitments: boolean;
  defaultRecordingMode: string;
  autoRecordContacts: string[];
  appearance: 'system' | 'light' | 'dark';
  setNotificationsEnabled: (v: boolean) => void;
  setNotifyOnProcessingDone: (v: boolean) => void;
  setNotifyDailyBriefing: (v: boolean) => void;
  setNotifyOverdueCommitments: (v: boolean) => void;
  setDefaultRecordingMode: (m: string) => void;
  setAutoRecordContacts: (ids: string[]) => void;
  setAppearance: (v: 'system' | 'light' | 'dark') => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      notifyOnProcessingDone: true,
      notifyDailyBriefing: true,
      notifyOverdueCommitments: true,
      defaultRecordingMode: 'general',
      autoRecordContacts: [],
      appearance: 'system',
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
      setNotifyOnProcessingDone: (v) => set({ notifyOnProcessingDone: v }),
      setNotifyDailyBriefing: (v) => set({ notifyDailyBriefing: v }),
      setNotifyOverdueCommitments: (v) => set({ notifyOverdueCommitments: v }),
      setDefaultRecordingMode: (m) => set({ defaultRecordingMode: m }),
      setAutoRecordContacts: (ids) => set({ autoRecordContacts: ids }),
      setAppearance: (v) => set({ appearance: v }),
    }),
    {
      name: 'recap-preferences',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
