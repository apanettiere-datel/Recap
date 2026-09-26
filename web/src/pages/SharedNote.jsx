import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE } from '@/lib/api'
import { formatFullDate, formatDuration } from '@/lib/format'
import { findQuoteTime, formatTimestamp } from '@/lib/useNoteAudio'
import AudioPlayer from '@/components/AudioPlayer'
import TranscriptViewer from '@/components/TranscriptViewer'

/** Read-only public view of a shared conversation (no account needed). */
export default function SharedNote() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [playTime, setPlayTime] = useState(null)
  const playerRef = useRef(null)
  const lastTimeRef = useRef(-1)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/public/shares/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || "This link isn't available.")
        return body
      })
      .then((data) => !cancelled && setState({ status: 'ready', data, error: null }))
      .catch((err) => !cancelled && setState({ status: 'error', data: null, error: err.message }))
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  if (state.status === 'loading') {
    return (
      <Shell>
        <div className="py-24 flex justify-center">
          <div className="w-6 h-6 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
        </div>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <div className="py-24 text-center">
          <p className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">Link unavailable</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{state.error} It may have been turned off by the person who shared it.</p>
        </div>
      </Shell>
    )
  }

  const note = state.data
  const audioUrl = note.hasAudio ? `${API_BASE}/public/shares/${encodeURIComponent(token)}/audio` : null
  const seek = (t) => {
    playerRef.current?.seek(t, { play: true })
    document.getElementById('shared-audio')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const onTime = (t) => {
    if (Math.abs(t - lastTimeRef.current) < 0.25) return
    lastTimeRef.current = t
    setPlayTime(t)
  }

  return (
    <Shell>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">{note.title || 'Conversation'}</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
        {formatFullDate(note.recordedAt)}
        {note.duration > 0 && ` · ${formatDuration(note.duration)}`}
        {note.people?.length > 0 && ` · with ${note.people.join(', ')}`}
      </p>

      {audioUrl && (
        <div id="shared-audio" className="mt-6 sticky top-0 z-10 py-2 bg-neutral-50/90 dark:bg-black/90 backdrop-blur">
          <AudioPlayer ref={playerRef} audioUrl={audioUrl} duration={note.duration} onTimeUpdate={onTime} />
        </div>
      )}

      {note.summary && (
        <section className="mt-8">
          <h2 className="section-label mb-2">Summary</h2>
          <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed">{note.summary}</p>
        </section>
      )}

      {note.commitments?.length > 0 && (
        <section className="mt-8">
          <h2 className="section-label mb-2">Action items</h2>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
            {note.commitments.map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${c.status === 'completed' ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                <div className="flex-1">
                  <p className={`text-[15px] ${c.status === 'completed' ? 'line-through text-neutral-400' : 'text-neutral-900 dark:text-white'}`}>{c.description}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {c.owner === 'me' ? 'Owner: the person who shared this' : `Owner: ${c.personName || 'other participant'}`}
                    {c.dueDate && ` · due ${new Date(c.dueDate).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {note.quotes?.length > 0 && (
        <section className="mt-8">
          <h2 className="section-label mb-3">Key quotes</h2>
          <div className="space-y-3">
            {note.quotes.map((q, i) => {
              const t = audioUrl ? findQuoteTime(q.text, note.segments) : null
              return (
                <blockquote key={i} className="border-l-[3px] border-blue-500 pl-4 py-0.5">
                  <p className="text-[15px] italic text-neutral-700 dark:text-neutral-300">&ldquo;{q.text}&rdquo;</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-neutral-400">
                    {q.speaker && <span>&mdash; {q.speaker}</span>}
                    {t != null && (
                      <button type="button" onClick={() => seek(t)} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        ▶ {formatTimestamp(t)}
                      </button>
                    )}
                  </div>
                </blockquote>
              )
            })}
          </div>
        </section>
      )}

      {note.topics?.length > 0 && (
        <section className="mt-8">
          <h2 className="section-label mb-2">Topics</h2>
          <div className="flex flex-wrap gap-2">
            {note.topics.map((t) => <span key={t} className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 text-sm">{t}</span>)}
          </div>
        </section>
      )}

      {note.transcript && (
        <section className="mt-8">
          <h2 className="section-label mb-3">Transcript</h2>
          <TranscriptViewer
            transcript={note.transcript}
            segments={note.segments}
            speakers={note.speakers}
            title={note.title}
            currentTime={playTime}
            onSeek={audioUrl ? seek : undefined}
            stickyTop={audioUrl ? 96 : 0}
          />
        </section>
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-[100dvh] bg-neutral-50 dark:bg-black">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-16">
        <div className="flex items-center gap-2 mb-8 text-sm font-semibold text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Shared from Recap
        </div>
        {children}
        <p className="mt-16 text-center text-xs text-neutral-400">
          This is a read-only copy shared by a Recap user. <a href="/" className="underline">What is Recap?</a>
        </p>
      </div>
    </div>
  )
}
