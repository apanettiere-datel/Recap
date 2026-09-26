/**
 * Durable local backup for recordings.
 *
 * Every chunk the MediaRecorder emits is written to IndexedDB as it arrives, so a
 * recording survives a crashed tab, a closed window, a dead battery, or a failed
 * upload. Anything left here that isn't actively recording is offered for upload
 * again by <PendingRecordings />.
 */

const DB_NAME = 'recap-recordings'
const DB_VERSION = 1
const SESSIONS = 'sessions'
const CHUNKS = 'chunks'

// A session whose heartbeat is older than this is no longer being recorded by any tab
const STALE_AFTER_MS = 15000

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] })
        chunks.createIndex('sessionId', 'sessionId')
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Recording storage is blocked by another tab'))
  })
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode)
    let result
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('Transaction aborted'))
    result = fn(t)
  })
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function newSessionId() {
  if (crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * @param {{ id: string, mimeType: string, mode: string, personId?: string|null, startedAt: string }} session
 */
export async function createSession(session) {
  const db = await openDb()
  const now = Date.now()
  await tx(db, [SESSIONS], 'readwrite', (t) => {
    t.objectStore(SESSIONS).put({
      status: 'recording',
      duration: 0,
      bytes: 0,
      chunkCount: 0,
      error: null,
      ...session,
      updatedAt: now,
    })
  })
}

/** Append a chunk and bump the session heartbeat in one transaction. */
export async function appendChunk(sessionId, seq, blob, duration) {
  const db = await openDb()
  await tx(db, [SESSIONS, CHUNKS], 'readwrite', (t) => {
    t.objectStore(CHUNKS).put({ sessionId, seq, blob })
    const sessions = t.objectStore(SESSIONS)
    const get = sessions.get(sessionId)
    get.onsuccess = () => {
      const s = get.result
      if (!s) return
      s.bytes = (s.bytes || 0) + blob.size
      s.chunkCount = Math.max(s.chunkCount || 0, seq + 1)
      if (duration != null) s.duration = duration
      s.updatedAt = Date.now()
      sessions.put(s)
    }
  })
}

export async function updateSession(sessionId, patch) {
  const db = await openDb()
  await tx(db, [SESSIONS], 'readwrite', (t) => {
    const store = t.objectStore(SESSIONS)
    const get = store.get(sessionId)
    get.onsuccess = () => {
      if (!get.result) return
      store.put({ ...get.result, ...patch, updatedAt: Date.now() })
    }
  })
}

export async function getSession(sessionId) {
  const db = await openDb()
  return reqToPromise(db.transaction(SESSIONS).objectStore(SESSIONS).get(sessionId))
}

/** Reassemble the recorded audio from its chunks, in order. */
export async function getSessionBlob(sessionId) {
  const db = await openDb()
  const session = await reqToPromise(db.transaction(SESSIONS).objectStore(SESSIONS).get(sessionId))
  const chunks = await reqToPromise(
    db.transaction(CHUNKS).objectStore(CHUNKS).index('sessionId').getAll(IDBKeyRange.only(sessionId)),
  )
  chunks.sort((a, b) => a.seq - b.seq)
  return new Blob(chunks.map((c) => c.blob), { type: session?.mimeType || chunks[0]?.blob?.type || 'audio/webm' })
}

export async function deleteSession(sessionId) {
  const db = await openDb()
  await tx(db, [SESSIONS, CHUNKS], 'readwrite', (t) => {
    t.objectStore(SESSIONS).delete(sessionId)
    t.objectStore(CHUNKS).delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]))
  })
}

/**
 * Recordings that need attention: stopped-but-not-uploaded, failed uploads, and
 * recordings whose tab died mid-recording (stale heartbeat).
 */
export async function listRecoverableSessions() {
  let db
  try {
    db = await openDb()
  } catch {
    return []
  }
  const all = await reqToPromise(db.transaction(SESSIONS).objectStore(SESSIONS).getAll())
  const now = Date.now()
  return all
    .filter((s) => s.status !== 'recording' || now - (s.updatedAt || 0) > STALE_AFTER_MS)
    .filter((s) => (s.bytes || 0) > 0 || (s.chunkCount || 0) > 0)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
}

/** Remove empty or abandoned sessions that have no audio at all. */
export async function pruneEmptySessions() {
  let db
  try {
    db = await openDb()
  } catch {
    return
  }
  const all = await reqToPromise(db.transaction(SESSIONS).objectStore(SESSIONS).getAll())
  const now = Date.now()
  for (const s of all) {
    const stale = s.status !== 'recording' || now - (s.updatedAt || 0) > STALE_AFTER_MS
    if (stale && !(s.bytes > 0)) await deleteSession(s.id).catch(() => {})
  }
}

export async function isStorageAvailable() {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}

// Let other parts of the app (the pending-recordings banner) know something changed
const CHANGE_EVENT = 'recap:recordings-changed'
export function notifyRecordingsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
export function onRecordingsChanged(fn) {
  window.addEventListener(CHANGE_EVENT, fn)
  return () => window.removeEventListener(CHANGE_EVENT, fn)
}

// Sessions being uploaded by this tab right now (so the banner doesn't offer them twice)
const uploadingHere = new Set()
export function markUploading(id) { uploadingHere.add(id) }
export function unmarkUploading(id) { uploadingHere.delete(id) }
export function isUploadingHere(id) { return uploadingHere.has(id) }
