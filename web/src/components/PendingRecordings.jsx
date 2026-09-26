import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { formatClock, formatBytes, formatRelativeDate } from '@/lib/format'
import {
  listRecoverableSessions, getSessionBlob, deleteSession, updateSession, pruneEmptySessions,
  onRecordingsChanged, notifyRecordingsChanged, markUploading, unmarkUploading, isUploadingHere,
} from '@/lib/recordingStore'
import { uploadRecording, downloadBlob, extensionForMime } from '@/lib/uploadRecording'

/**
 * Recordings saved on this device that never reached the server — because the tab
 * closed mid-recording, the upload failed, or the user chose "upload later".
 */
export default function PendingRecordings() {
  const [sessions, setSessions] = useState([])
  const [busy, setBusy] = useState({}) // id -> { progress, attempt }

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const list = await listRecoverableSessions()
        if (!cancelled) setSessions(list.filter((s) => !isUploadingHere(s.id)))
      } catch {
        // storage unavailable — nothing to recover
      }
    }
    pruneEmptySessions().finally(refresh)
    const off = onRecordingsChanged(refresh)
    // A recording in another tab that dies shows up once its heartbeat goes stale
    const interval = setInterval(refresh, 5000)
    return () => { cancelled = true; off(); clearInterval(interval) }
  }, [])

  if (sessions.length === 0) return null

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 space-y-2">
      {sessions.map((s) => (
        <PendingItem
          key={s.id}
          session={s}
          state={busy[s.id]}
          setState={(v) => setBusy((b) => ({ ...b, [s.id]: v }))}
        />
      ))}
    </div>
  )
}

function PendingItem({ session, state, setState }) {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const uploading = !!state

  const interrupted = session.status === 'recording'
  const headline = interrupted
    ? 'A recording was interrupted'
    : session.status === 'failed'
      ? "A recording didn't upload"
      : 'A recording is waiting to upload'

  const upload = async () => {
    setState({ progress: 0, attempt: 0 })
    markUploading(session.id)
    try {
      const blob = await getSessionBlob(session.id)
      if (!blob.size) throw new Error('No audio was saved for this recording.')
      const note = await uploadRecording(api, {
        blob,
        clientId: session.id,
        mode: 'conversation',
        duration: session.duration || 0,
        personId: session.personId,
        recordedAt: session.startedAt,
        myNotes: session.myNotes,
      }, {
        onProgress: (progress) => setState({ progress, attempt: 0 }),
        onRetry: (attempt) => setState({ progress: 0, attempt }),
      })
      await deleteSession(session.id)
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success('Recording uploaded. Processing has started.', {
        action: note?.id ? { label: 'View', onClick: () => navigate(`/note/${note.id}`) } : undefined,
      })
    } catch (err) {
      await updateSession(session.id, { status: 'failed', error: err?.message }).catch(() => {})
      toast.error(err?.message || 'Upload failed. Your recording is still saved on this device.')
    } finally {
      unmarkUploading(session.id)
      setState(null)
      notifyRecordingsChanged()
    }
  }

  const download = async () => {
    try {
      const blob = await getSessionBlob(session.id)
      const stamp = (session.startedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
      downloadBlob(blob, `recap-recording-${stamp}.${extensionForMime(blob.type)}`)
    } catch {
      toast.error("Couldn't read the saved recording.")
    }
  }

  const discard = async () => {
    if (!window.confirm('Delete this saved recording from this device? This cannot be undone.')) return
    await deleteSession(session.id).catch(() => {})
    notifyRecordingsChanged()
  }

  const pct = Math.round((state?.progress || 0) * 100)

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">{headline}</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            {formatRelativeDate(session.startedAt)}
            {session.duration ? ` · ${formatClock(session.duration)}` : ''}
            {session.bytes ? ` · ${formatBytes(session.bytes)}` : ''}
            {' · saved on this device'}
          </p>
          {session.error && !uploading && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{session.error}</p>
          )}
          {uploading && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-amber-500/20 overflow-hidden">
                <div className="h-full bg-amber-500 transition-[width] duration-300" style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {state.attempt > 0 ? `Connection problem — retrying (attempt ${state.attempt + 1})…` : `Uploading… ${pct}%`}
              </p>
            </div>
          )}
        </div>
      </div>
      {!uploading && (
        <div className="flex flex-wrap gap-2 mt-3 pl-12">
          <button type="button" onClick={upload} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors">
            Upload now
          </button>
          <button type="button" onClick={download} className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-amber-500/15 transition-colors">
            Download
          </button>
          <button type="button" onClick={discard} className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
