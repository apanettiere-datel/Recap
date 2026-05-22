import { create } from 'zustand';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (token: string, userId: string, email: string, displayName: string | null) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  email: null,
  displayName: null,
  isAuthenticated: false,
  isLoading: true,
  setAuth: (token, userId, email, displayName) =>
    set({ token, userId, email, displayName, isAuthenticated: true, isLoading: false }),
  clearAuth: () =>
    set({ token: null, userId: null, email: null, displayName: null, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));
