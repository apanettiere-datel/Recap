import { ApiError } from './api'

const RETRY_DELAYS_MS = [2000, 5000, 15000]

export function extensionForMime(mimeType = '') {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ApiError('Upload cancelled')) })
  })
}

/**
 * Upload a recording, retrying transient failures (network drops, timeouts, 5xx).
 * `clientId` makes the upload idempotent: if a retry follows an upload whose
 * response was lost, the server returns the note it already created.
 */
export async function uploadRecording(api, { blob, clientId, mode = 'conversation', duration = 0, personId, recordedAt }, { onProgress, onRetry, signal } = {}) {
  if (!blob || blob.size === 0) throw new ApiError('The recording is empty — no audio was captured.', { status: 400 })

  let lastError
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      // Wait for connectivity rather than burning retries while offline
      if (!navigator.onLine) await waitForOnline(signal)
      onRetry?.(attempt, lastError)
      await sleep(RETRY_DELAYS_MS[attempt - 1], signal)
    }

    const formData = new FormData()
    formData.append('audio', blob, `recording.${extensionForMime(blob.type)}`)
    formData.append('mode', mode)
    formData.append('duration', String(Math.round(duration || 0)))
    if (clientId) formData.append('clientId', clientId)
    if (recordedAt) formData.append('recordedAt', recordedAt)
    if (personId) formData.append('personId', personId)

    try {
      onProgress?.(0)
      return await api.upload('/notes', formData, { onProgress, signal })
    } catch (err) {
      lastError = err
      if (err?.cancelled || signal?.aborted) throw err
      if (!(err instanceof ApiError) || !err.retryable) throw err
    }
  }
  throw lastError
}

function waitForOnline(signal) {
  return new Promise((resolve, reject) => {
    if (navigator.onLine) return resolve()
    const done = () => { window.removeEventListener('online', done); resolve() }
    window.addEventListener('online', done)
    signal?.addEventListener('abort', () => { window.removeEventListener('online', done); reject(new ApiError('Upload cancelled')) })
  })
}

/** Save a recording to the user's device as a last resort. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
