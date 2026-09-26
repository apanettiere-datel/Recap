import { useAuthFetch, useAuthHeaders } from './authFetch'
import { useMemo } from 'react'

export const API_BASE = import.meta.env.VITE_API_URL || ''

const DEFAULT_TIMEOUT_MS = 30000

/** An API failure with the HTTP status and the server's own error message when available. */
export class ApiError extends Error {
  constructor(message, { status = 0, network = false, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.network = network
    this.data = data
  }

  /** Worth retrying: network trouble, timeouts, rate limits and server errors. */
  get retryable() {
    return this.network || this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500
  }
}

const STATUS_MESSAGES = {
  400: 'The request was invalid.',
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have access to that.",
  404: "That couldn't be found. It may have been deleted.",
  409: 'That is already in progress.',
  413: 'That file is too large to upload.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our end. Please try again.',
  502: 'The server is temporarily unavailable. Please try again.',
  503: 'The server is temporarily unavailable. Please try again.',
  504: 'The server took too long to respond. Please try again.',
}

async function errorFromResponse(r) {
  let message = ''
  let data = null
  try {
    const text = await r.text()
    try {
      data = JSON.parse(text)
      message = data?.error || ''
    } catch {
      // Proxies (nginx) return HTML error pages; don't show those
      if (text && text.length < 200 && !text.trim().startsWith('<')) message = text.trim()
    }
  } catch {
    // body unreadable
  }
  return new ApiError(message || STATUS_MESSAGES[r.status] || `Request failed (${r.status})`, { status: r.status, data })
}

function toNetworkError(err) {
  if (err instanceof ApiError) return err
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new ApiError('The request timed out. Check your connection and try again.', { network: true })
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ApiError("You're offline. Check your connection and try again.", { network: true })
  }
  return new ApiError(err?.message && !/failed to fetch|networkerror|load failed/i.test(err.message)
    ? err.message
    : "Couldn't reach the server. Check your connection and try again.", { network: true })
}

async function request(authFetch, path, { method = 'GET', body, raw, timeout = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let r
  try {
    r = await authFetch(`${API_BASE}/api${path}`, {
      method,
      signal: controller.signal,
      ...(body !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      ...(raw !== undefined && {
        headers: { 'Content-Type': 'application/octet-stream' },
        body: raw,
      }),
    })
  } catch (err) {
    throw toNetworkError(err)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!r.ok) throw await errorFromResponse(r)
  if (r.status === 204) return null
  return r.json().catch(() => null)
}

/**
 * Multipart upload via XHR so we can report progress for long recordings.
 * `onProgress` receives a 0..1 fraction.
 */
function uploadWithProgress(getHeaders, path, formData, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    Promise.resolve(getHeaders?.() ?? {}).then((headers) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/api${path}`)
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
      xhr.timeout = 30 * 60 * 1000

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total)
      }
      xhr.onload = () => {
        let data = null
        try { data = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data)
        reject(new ApiError(data?.error || STATUS_MESSAGES[xhr.status] || `Upload failed (${xhr.status})`, { status: xhr.status }))
      }
      xhr.onerror = () => reject(toNetworkError(new Error('Failed to fetch')))
      xhr.ontimeout = () => reject(new ApiError('The upload timed out. Check your connection and try again.', { network: true }))
      xhr.onabort = () => reject(Object.assign(new ApiError('Upload cancelled'), { cancelled: true }))
      signal?.addEventListener('abort', () => xhr.abort())
      xhr.send(formData)
    }, (err) => reject(new ApiError(err?.message || 'Could not authenticate the upload', { status: 401 })))
  })
}

export function useApi() {
  const authFetch = useAuthFetch()
  const getHeaders = useAuthHeaders()
  return useMemo(() => ({
    get: (path, opts) => request(authFetch, path, opts),
    post: (path, body, opts) => request(authFetch, path, { ...opts, method: 'POST', body: body ?? {} }),
    patch: (path, body, opts) => request(authFetch, path, { ...opts, method: 'PATCH', body }),
    put: (path, body, opts) => request(authFetch, path, { ...opts, method: 'PUT', body }),
    del: (path, opts) => request(authFetch, path, { ...opts, method: 'DELETE' }),
    upload: (path, formData, opts) => uploadWithProgress(getHeaders, path, formData, opts),
    putRaw: (path, blob, opts) => request(authFetch, path, { timeout: 120000, ...opts, method: 'PUT', raw: blob }),
  }), [authFetch, getHeaders])
}
