import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { useNoteAudio, formatTimestamp } from '@/lib/useNoteAudio'
import { parseTerms } from '@/lib/searchTerms'
import { formatRelativeDate, formatDuration, sentimentColor } from '@/lib/format'
import AudioPlayer from './AudioPlayer'
import NoteCard, { NoteCardSkeleton } from './NoteCard'

const INITIAL_VISIBLE = 5

/**
 * Everything recorded with one person: search their conversations, play each one
 * inline, jump to the full analysis, and hear what they said.
 */
export default function PersonConversations({ person }) {
  const api = useApi()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState(null)
  const firstName = (person.name || '').split(' ')[0] || 'them'

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  const search = useQuery({
    queryKey: ['search', 'person', person.id, q],
    queryFn: ({ signal }) => api.get(`/notes/search?${new URLSearchParams({ q, personId: person.id, archived: 'include', limit: '20' })}`, { signal }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  })
  const terms = useMemo(() => parseTerms(q), [q])

  const notes = person.notes || []
  const visible = showAll ? notes : notes.slice(0, INITIAL_VISIBLE)
  const openAt = (noteId, t) => navigate(`/note/${noteId}${t != null ? `?t=${Math.floor(t)}` : ''}`)

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="section-label">Conversations with {firstName}</h2>
        {notes.length > 0 && <span className="text-xs text-neutral-400">{notes.length} total</span>}
      </div>

      {notes.length > 0 && (
        <div className="relative mb-3">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setInput('')}
            placeholder={`Search what you discussed with ${firstName}…`}
            aria-label={`Search conversations with ${person.name}`}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition"
          />
        </div>
      )}

      {q ? (
        search.isLoading ? (
          <div className="flex flex-col gap-3"><NoteCardSkeleton /><NoteCardSkeleton /></div>
        ) : search.isError ? (
          <p className="text-sm text-red-500 py-4">{search.error?.message}</p>
        ) : (search.data?.notes?.length ?? 0) === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 py-6 text-center">
            Nothing about &ldquo;{q}&rdquo; in your conversations with {firstName}.
          </p>
        ) : (
          <div className={`flex flex-col gap-3 ${search.isPlaceholderData ? 'opacity-60' : ''}`}>
            {search.data.notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                terms={terms}
                onClick={() => navigate(`/note/${note.id}?q=${encodeURIComponent(q)}`)}
                onOpenAt={(t) => openAt(note.id, t)}
              />
            ))}
          </div>
        )
      ) : notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">No recorded conversations with {firstName} yet.</p>
          <button type="button" onClick={() => navigate(`/recording?personId=${person.id}`)} className="btn-primary !bg-red-500 hover:!bg-red-600">
            Record a conversation
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
            {visible.map((note) => (
              <ConversationRow
                key={note.id}
                note={note}
                open={openId === note.id}
                onToggle={() => setOpenId(openId === note.id ? null : note.id)}
                onAnalysis={() => navigate(`/note/${note.id}`)}
              />
            ))}
          </div>
          {notes.length > INITIAL_VISIBLE && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400">
              {showAll ? 'Show fewer' : `Show all ${notes.length} conversations`}
            </button>
          )}
        </>
      )}

      {!q && person.quotes?.length > 0 && (
        <div className="mt-6">
          <h3 className="section-label mb-3">What {firstName} said</h3>
          <div className="flex flex-col gap-3">
            {person.quotes.slice(0, 6).map((quote) => (
              <blockquote key={quote.id} className="border-l-[3px] border-purple-500 pl-4 py-0.5">
                <p className="text-[15px] text-neutral-700 dark:text-neutral-300 italic leading-relaxed">&ldquo;{quote.text}&rdquo;</p>
                <div className="flex items-center gap-3 mt-1 text-xs">
                  <button type="button" onClick={() => openAt(quote.noteId)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 truncate">
                    {quote.noteTitle || 'Conversation'} · {formatRelativeDate(quote.recordedAt)}
                  </button>
                  {quote.start != null && (
                    <button
                      type="button"
                      onClick={() => openAt(quote.noteId, quote.start)}
                      className="shrink-0 inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                      Hear it at {formatTimestamp(quote.start)}
                    </button>
                  )}
                </div>
              </blockquote>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ConversationRow({ note, open, onToggle, onAnalysis }) {
  const audio = useNoteAudio(note.id, open && note.hasAudio)
  const failed = !note.isProcessing && note.processingError

  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={note.hasAudio ? onToggle : onAnalysis}
          aria-label={note.hasAudio ? (open ? 'Hide player' : 'Listen') : 'Open'}
          className={`mt-0.5 w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            open ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
          }`}
        >
          {note.hasAudio ? (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          )}
        </button>
        <button type="button" onClick={onAnalysis} className="flex-1 min-w-0 text-left group">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
              {note.title || (note.isProcessing ? 'New recording' : 'Untitled')}
            </p>
            <span className="text-xs text-neutral-400 shrink-0">{formatRelativeDate(note.recordedAt)}</span>
          </div>
          {note.isProcessing ? (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Processing…</p>
          ) : failed ? (
            <p className="text-xs text-red-500 mt-0.5">Processing failed — open to retry</p>
          ) : note.summary ? (
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5 leading-relaxed">{note.summary}</p>
          ) : null}
          <div className="flex items-center gap-2 mt-1.5">
            {note.sentiment && !note.isProcessing && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${sentimentColor(note.sentiment)}`}>{note.sentiment}</span>
            )}
            {note.duration > 0 && <span className="text-xs text-neutral-400">{formatDuration(note.duration)}</span>}
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 ml-auto">View analysis →</span>
          </div>
        </button>
      </div>
      {open && (
        <div className="mt-3 pl-12">
          {audio.status === 'ready' ? (
            <AudioPlayer audioUrl={audio.url} duration={note.duration} compact />
          ) : audio.status === 'loading' ? (
            <p className="text-xs text-neutral-400 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" /> Loading audio…
            </p>
          ) : (
            <p className="text-xs text-neutral-500">
              {audio.status === 'missing' ? 'The audio for this conversation is unavailable.' : "Couldn't load the audio."}{' '}
              {audio.status === 'error' && <button type="button" onClick={audio.retry} className="text-blue-600 dark:text-blue-400 font-medium">Retry</button>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
