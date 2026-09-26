import { useEffect, useState } from 'react'

const STUCK_AFTER_MS = 20 * 60 * 1000

function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function elapsedLabel(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Live processing banner for a note, with stage, elapsed time, and stuck/failed recovery. */
export default function ProcessingStatus({ note, onRetry, retrying }) {
  const processing = note.isProcessing || retrying
  const now = useNow(processing)

  if (processing) {
    const startedAt = note.processingStartedAt ? new Date(note.processingStartedAt).getTime() : null
    const running = startedAt ? now - startedAt : 0
    const stuck = startedAt && running > STUCK_AFTER_MS && note.isQueued === false
    const stage = retrying && !note.isProcessing ? 'Queued' : note.processingStage || (startedAt ? 'Processing' : 'Waiting to start')

    return (
      <div className="mb-6 rounded-2xl bg-blue-500/10 border border-blue-500/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{stage}…</p>
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
              {startedAt ? `${elapsedLabel(running)} elapsed · ` : ''}Long recordings can take a few minutes. You can leave this page.
            </p>
          </div>
        </div>
        {stuck && (
          <div className="mt-3 pl-8 flex items-center gap-3">
            <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">This is taking much longer than usual.</p>
            <button type="button" onClick={() => onRetry(false)} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              Restart
            </button>
          </div>
        )}
      </div>
    )
  }

  if (note.processingError) {
    const hasTranscript = (note.transcript || '').trim().length > 0
    return (
      <div className="mb-6 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Processing failed</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5 leading-relaxed">{note.processingError}</p>
            {hasTranscript && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">The transcript was saved — retrying will only redo the analysis.</p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => onRetry(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Retry
              </button>
              {hasTranscript && note.audioUrl !== '' && (
                <button
                  type="button"
                  onClick={() => onRetry(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-700 dark:text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  Re-transcribe from audio
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
