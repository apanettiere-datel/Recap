import { ApiError } from './api'

const PART_INTERVAL_MS = 15000
const PART_MAX_BYTES = 4 * 1024 * 1024
const MAX_BACKOFF_MS = 30000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Streams a recording to the server while it is being made ("cloud backup").
 *
 * MediaRecorder chunks are grouped into numbered parts (~every 15s) and uploaded in
 * order, retrying forever with backoff while recording. Parts concatenate into the
 * complete file, so finishing only needs the last part plus a finalize call — and if
 * this device dies mid-recording, the server already has everything up to the last
 * part and recovers the note by itself.
 */
export class LiveUploader {
  /**
   * @param {object} api       useApi() client
   * @param {object} session   { id, mimeType, mode, personId, startedAt }
   * @param {(status: object) => void} onStatus
   */
  constructor(api, session, onStatus) {
    this.api = api
    this.session = session
    this.onStatus = onStatus || (() => {})
    this.pending = []          // chunks not yet cut into a part
    this.pendingBytes = 0
    this.parts = []            // index -> Blob (released after upload)
    this.acked = new Set()
    this.uploadedBytes = 0
    this.lastAckAt = null
    this.lastError = null
    this.duration = 0
    this.closed = false
    this.stopped = false
    this.timer = setInterval(() => this.cut(), PART_INTERVAL_MS)
    this.pump = this.run()
  }

  status() {
    return {
      partsTotal: this.parts.length,
      partsUploaded: this.acked.size,
      uploadedBytes: this.uploadedBytes,
      lastAckAt: this.lastAckAt,
      lastError: this.lastError,
      behind: this.parts.length - this.acked.size,
    }
  }

  emit() {
    this.onStatus(this.status())
  }

  /** Feed a MediaRecorder chunk. */
  add(blob, durationSecs) {
    if (this.closed || !blob?.size) return
    this.pending.push(blob)
    this.pendingBytes += blob.size
    if (durationSecs != null) this.duration = durationSecs
    if (this.pendingBytes >= PART_MAX_BYTES) this.cut()
  }

  /** Close the current group of chunks into a numbered part. */
  cut() {
    if (this.pending.length === 0) return
    const blob = new Blob(this.pending, { type: this.session.mimeType })
    this.pending = []
    this.pendingBytes = 0
    this.parts.push(blob)
    this.wake?.()
    this.emit()
  }

  partUrl(index) {
    const q = new URLSearchParams({
      mime: this.session.mimeType,
      mode: 'conversation',
      recordedAt: this.session.startedAt,
      duration: String(Math.round(this.duration || 0)),
    })
    if (this.session.personId) q.set('personId', this.session.personId)
    return `/recordings/${this.session.id}/parts/${index}?${q}`
  }

  async uploadPart(index) {
    const blob = this.parts[index]
    if (!blob) return
    await this.api.putRaw(this.partUrl(index), blob)
    this.acked.add(index)
    this.uploadedBytes += blob.size
    this.lastAckAt = Date.now()
    this.lastError = null
    // Keep memory flat on long recordings; the full copy lives in IndexedDB
    this.parts[index] = null
    this.emit()
  }

  async run() {
    let backoff = 1000
    while (!this.closed) {
      const next = this.parts.findIndex((p, i) => p && !this.acked.has(i))
      if (next === -1) {
        if (this.stopped) return
        await new Promise((resolve) => {
          this.wake = resolve
          setTimeout(resolve, 2000)
        })
        continue
      }
      try {
        await this.uploadPart(next)
        backoff = 1000
      } catch (err) {
        this.lastError = err?.message || 'Upload failed'
        this.emit()
        // Stop hammering on non-retryable errors (e.g. auth); finish() falls back
        if (err instanceof ApiError && !err.retryable && err.status !== 401) {
          this.fatal = err
          return
        }
        await sleep(backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  }

  /**
   * Upload whatever is left and create the note. Resolves to the API response
   * ({ id }); throws if the server can't be reached, so the caller can fall back to
   * uploading the whole file.
   */
  async finish(durationSecs, { timeoutMs = 45000, onProgress } = {}) {
    if (durationSecs != null) this.duration = durationSecs
    clearInterval(this.timer)
    this.cut()
    this.stopped = true
    this.wake?.()

    const started = Date.now()
    const deadline = started + timeoutMs
    while (this.acked.size < this.parts.length) {
      if (this.fatal) throw this.fatal
      if (Date.now() > deadline) throw new ApiError(this.lastError || 'Timed out finishing the upload', { network: true })
      // Failing with no progress: give up early so the caller can fall back
      const lastProgress = Math.max(this.lastAckAt || 0, started)
      if (this.lastError && Date.now() - lastProgress > 12000) {
        throw new ApiError(this.lastError, { network: true })
      }
      onProgress?.(this.parts.length ? this.acked.size / this.parts.length : 1)
      await sleep(300)
    }
    onProgress?.(1)

    const body = { parts: this.parts.length, duration: Math.round(this.duration || 0) }
    try {
      return await this.api.post(`/recordings/${this.session.id}/finalize`, body, { timeout: 120000 })
    } finally {
      this.close()
    }
  }

  /** Flush the last few seconds to the server (e.g. when the page is being hidden). */
  flush() {
    this.cut()
  }

  close() {
    this.closed = true
    clearInterval(this.timer)
    this.wake?.()
  }

  /** Discard: stop uploading and delete what the server has. */
  async discard() {
    this.close()
    await this.api.del(`/recordings/${this.session.id}`).catch(() => {})
  }
}
