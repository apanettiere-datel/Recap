import { useState, useEffect, useCallback } from 'react'

export const light = {
  bg: '#ffffff',
  bgGrouped: '#f2f2f7',
  bgElevated: '#ffffff',
  bgTinted: 'rgba(118,118,128,0.12)',
  bgCard: '#ffffff',
  text: '#000000',
  textSecondary: 'rgba(60,60,67,0.6)',
  textTertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.18)',
  red: '#ff3b30',
  blue: '#007aff',
  orange: '#ff9500',
  green: '#34c759',
  purple: '#af52de',
  pink: '#ff2d55',
  yellow: '#ffcc00',
  teal: '#5ac8fa',
  indigo: '#5856d6',
}

export const dark = {
  bg: '#000000',
  bgGrouped: '#000000',
  bgElevated: '#1c1c1e',
  bgTinted: 'rgba(118,118,128,0.24)',
  bgCard: '#1c1c1e',
  text: '#ffffff',
  textSecondary: 'rgba(235,235,245,0.6)',
  textTertiary: 'rgba(235,235,245,0.3)',
  separator: 'rgba(84,84,88,0.6)',
  red: '#ff453a',
  blue: '#0a84ff',
  orange: '#ff9f0a',
  green: '#30d158',
  purple: '#bf5af2',
  pink: '#ff375f',
  yellow: '#ffd60a',
  teal: '#64d2ff',
  indigo: '#5e5ce6',
}

const STORAGE_KEY = 'recap-theme'

function getSystemDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function resolveAppearance(mode) {
  if (mode === 'dark') return 'dark'
  if (mode === 'light') return 'light'
  return getSystemDark() ? 'dark' : 'light'
}

function applyDarkClass(appearance) {
  if (appearance === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

function getInitialMode() {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  return 'system'
}

export function useTheme() {
  const [mode, setModeState] = useState(() => {
    const m = getInitialMode()
    applyDarkClass(resolveAppearance(m))
    return m
  })

  const appearance = resolveAppearance(mode)

  const setMode = useCallback((newMode) => {
    setModeState(newMode)
    localStorage.setItem(STORAGE_KEY, newMode)
    applyDarkClass(resolveAppearance(newMode))
  }, [])

  const toggle = useCallback(() => {
    const next = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
  }, [mode, setMode])

  useEffect(() => {
    applyDarkClass(appearance)
  }, [appearance])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored || stored === 'system') {
        const a = getSystemDark() ? 'dark' : 'light'
        applyDarkClass(a)
        setModeState((prev) => prev === 'system' ? 'system' : prev)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const theme = appearance === 'dark' ? dark : light

  return { mode, setMode, toggle, theme, appearance }
}
