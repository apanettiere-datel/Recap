import { useAuthFetch } from './authFetch'
import { useMemo } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

export function useApi() {
  const authFetch = useAuthFetch()
  return useMemo(() => ({
    get: async (path) => {
      const r = await authFetch(`${API_BASE}/api${path}`)
      if (!r.ok) throw new Error(`API ${r.status}`)
      return r.json()
    },
    post: async (path, body) => {
      const r = await authFetch(`${API_BASE}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      return r.json()
    },
    patch: async (path, body) => {
      const r = await authFetch(`${API_BASE}/api${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      return r.json()
    },
    del: async (path) => {
      const r = await authFetch(`${API_BASE}/api${path}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`API ${r.status}`)
      return r.json()
    },
    upload: async (path, formData) => {
      const r = await authFetch(`${API_BASE}/api${path}`, { method: 'POST', body: formData })
      if (!r.ok) throw new Error(`API ${r.status}`)
      return r.json()
    },
  }), [authFetch])
}
