import { useEffect, useState } from 'react'
import { API_BASE } from './api'
import { useAuthFetch } from './authFetch'

/**
 * Load a note's audio (authenticated) as an object URL.
 * status: idle | loading | ready | missing | error
 */
export function useNoteAudio(noteId, enabled) {
  const authFetch = useAuthFetch()
  const [attempt, setAttempt] = useState(0)
  // Results are tagged with the request they belong to; anything else reads as "loading"
  const key = `${noteId}:${attempt}`
  const [result, setResult] = useState({ key: null, url: null, status: 'idle' })

  useEffect(() => {
    if (!enabled) return
    let url = null
    let cancelled = false
    const controller = new AbortController()
    authFetch(`${API_BASE}/api/notes/${noteId}/audio`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'missing' : `HTTP ${r.status}`)
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setResult({ key, url, status: 'ready' })
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, url: null, status: err.message === 'missing' ? 'missing' : 'error' })
      })
    return () => {
      cancelled = true
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [noteId, enabled, key, authFetch])

  const current = result.key === key ? result : { url: null, status: enabled ? 'loading' : 'idle' }
  return { ...current, retry: () => setAttempt((a) => a + 1) }
}

/** "1:05" / "1:02:03" */
export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * Find when a quote was said by matching its opening words against the timed
 * segments. Returns seconds or null.
 */
export function findQuoteTime(quote, segments) {
  if (!quote || !segments?.length) return null
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  const words = norm(quote).split(' ')
  for (const len of [6, 4, 3]) {
    if (words.length < len) continue
    const probe = words.slice(0, len).join(' ')
    const hit = segments.find((seg) => norm(seg.t).includes(probe))
    if (hit) return hit.s
  }
  // Quote may span a segment boundary: check pairs
  const probe = words.slice(0, 4).join(' ')
  for (let i = 0; i < segments.length - 1; i++) {
    if (norm(`${segments[i].t} ${segments[i + 1].t}`).includes(probe)) return segments[i].s
  }
  return null
}
