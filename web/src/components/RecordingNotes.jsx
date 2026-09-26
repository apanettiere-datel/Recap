import { useEffect, useRef, useState } from 'react'
import { formatTimestamp } from '@/lib/useNoteAudio'

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Type notes and bookmark moments while recording. Each entry is stamped with the
 * recording time: typed notes with the moment you started typing (what you were
 * reacting to), bookmarks with the moment you pressed the button.
 */
export default function RecordingNotes({ notes, onChange, getTime, disabled }) {
  const [draft, setDraft] = useState('')
  const startedAtRef = useRef(null)
  const listRef = useRef(null)
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes })

  const add = (entry) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    onChange([...notesRef.current, { id, ...entry }])
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))
  }

  const bookmark = () => {
    if (disabled) return
    add({ t: Math.round(getTime() * 10) / 10, text: '', mark: true })
  }

  const submit = (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    add({ t: Math.round((startedAtRef.current ?? getTime()) * 10) / 10, text })
    setDraft('')
    startedAtRef.current = null
  }

  // "B" bookmarks the current moment (when you're not typing)
  const bookmarkRef = useRef(bookmark)
  useEffect(() => { bookmarkRef.current = bookmark })
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'b' || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return
      e.preventDefault()
      bookmarkRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="w-full max-w-md mt-8">
      {notes.length > 0 && (
        <ul ref={listRef} className="max-h-44 overflow-y-auto mb-3 space-y-1.5 text-left" aria-label="Your notes">
          {notes.map((n) => (
            <li key={n.id} className="group flex items-start gap-2 text-sm">
              <span className="shrink-0 mt-0.5 text-[11px] font-mono tabular-nums text-neutral-400 w-11 text-right">{n.t != null ? formatTimestamp(n.t) : ''}</span>
              {n.mark ? (
                <span className="flex-1 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                  <BookmarkIcon className="w-3.5 h-3.5" filled /> Bookmarked moment
                </span>
              ) : (
                <span className="flex-1 text-neutral-800 dark:text-neutral-200 break-words">{n.text}</span>
              )}
              <button
                type="button"
                onClick={() => onChange(notes.filter((x) => x.id !== n.id))}
                className="shrink-0 p-0.5 text-neutral-300 hover:text-red-500 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                aria-label="Remove note"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => {
            if (!draft && e.target.value) startedAtRef.current = getTime()
            if (!e.target.value) startedAtRef.current = null
            setDraft(e.target.value)
          }}
          disabled={disabled}
          maxLength={1000}
          placeholder="Type a note, press Enter"
          aria-label="Add a note"
          className="input flex-1 !py-2.5"
          enterKeyHint="done"
        />
        <button
          type="button"
          onClick={bookmark}
          disabled={disabled}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-40"
          title="Bookmark this moment (B)"
        >
          <BookmarkIcon className="w-4 h-4" />
          Mark
        </button>
      </form>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2 text-center">
        Your notes steer the summary and link to their moment in the audio.<span className="hidden sm:inline"> Press B to bookmark.</span>
      </p>
    </div>
  )
}

function BookmarkIcon({ className, filled }) {
  return (
    <svg className={className} fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </svg>
  )
}
