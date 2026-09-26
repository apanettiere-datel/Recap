import { useState } from 'react'
import { formatTimestamp } from '@/lib/useNoteAudio'

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * The notes and bookmarks you added while recording (or afterwards). Each one jumps
 * to its moment in the audio; edits can be folded into the summary with one click.
 */
export default function MyNotesSection({ notes, currentTime, canSeek, onSeek, onSave, saving, onUpdateSummary, updatingSummary }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null) // { id, text }
  const [changed, setChanged] = useState(false)
  const [adding, setAdding] = useState(false)
  const list = notes || []

  const save = (next) => {
    onSave(next)
    setChanged(true)
  }

  const add = (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    // While listening, a new note belongs to the moment you're at
    const t = currentTime != null ? Math.round(currentTime * 10) / 10 : null
    save([...list, { id: newId(), t, text }])
    setDraft('')
  }

  const markHere = () => {
    if (currentTime == null) return
    save([...list, { id: newId(), t: Math.round(currentTime * 10) / 10, text: '', mark: true }])
  }

  const commitEdit = () => {
    if (!editing) return
    const text = editing.text.trim()
    const target = list.find((n) => n.id === editing.id)
    setEditing(null)
    if (!target || text === target.text) return
    if (!text && !target.mark) save(list.filter((n) => n.id !== target.id))
    else save(list.map((n) => (n.id === target.id ? { ...n, text } : n)))
  }

  if (list.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mb-7 w-full flex items-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-500 dark:text-neutral-400 hover:border-amber-500 hover:text-amber-600 transition-colors"
      >
        <PencilIcon className="w-4 h-4" />
        Add your own notes to this conversation
      </button>
    )
  }

  const sorted = [...list].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity))

  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-label">My notes</h2>
        {canSeek && currentTime != null && (
          <button type="button" onClick={markHere} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">
            <BookmarkIcon className="w-3.5 h-3.5" /> Mark {formatTimestamp(currentTime)}
          </button>
        )}
      </div>
      <div className="bg-amber-50/60 dark:bg-amber-500/[.06] rounded-2xl border border-amber-200/70 dark:border-amber-500/20 divide-y divide-amber-200/60 dark:divide-amber-500/15">
        {sorted.map((n) => (
          <div key={n.id} className="group flex items-start gap-3 px-4 py-2.5">
            {n.t != null && canSeek ? (
              <button
                type="button"
                onClick={() => onSeek(n.t)}
                className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400 hover:underline"
                title="Play this moment"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                {formatTimestamp(n.t)}
              </button>
            ) : n.t != null ? (
              <span className="shrink-0 mt-0.5 text-xs tabular-nums text-neutral-400">{formatTimestamp(n.t)}</span>
            ) : null}
            <div className="flex-1 min-w-0">
              {editing?.id === n.id ? (
                <input
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  maxLength={1000}
                  placeholder={n.mark ? 'Label this bookmark' : ''}
                  className="w-full bg-transparent border-b border-amber-500 outline-none text-[15px] text-neutral-900 dark:text-white"
                  autoFocus
                />
              ) : (
                <button type="button" onClick={() => setEditing({ id: n.id, text: n.text })} className="w-full text-left" title="Edit">
                  {n.mark && (
                    <span className="inline-flex items-center gap-1 mr-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 align-middle">
                      <BookmarkIcon className="w-3.5 h-3.5" filled />
                      {!n.text && 'Bookmarked moment'}
                    </span>
                  )}
                  <span className="text-[15px] text-neutral-800 dark:text-neutral-200 break-words">{n.text}</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => save(list.filter((x) => x.id !== n.id))}
              className="shrink-0 p-1 text-neutral-300 hover:text-red-500 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              aria-label="Delete note"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        <form onSubmit={add} className="flex items-center gap-2 px-4 py-2">
          <PencilIcon className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={currentTime != null ? `Add a note at ${formatTimestamp(currentTime)}…` : 'Add a note…'}
            maxLength={1000}
            className="flex-1 bg-transparent outline-none text-[15px] py-1 text-neutral-900 dark:text-white placeholder:text-neutral-400"
            aria-label="Add a note"
            autoFocus={adding && list.length === 0}
          />
          {draft.trim() && <button type="submit" disabled={saving} className="text-sm font-semibold text-blue-600 dark:text-blue-400">Add</button>}
        </form>
      </div>
      {changed && onUpdateSummary && (
        <div className="flex items-center justify-between gap-3 mt-2 px-1">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Your notes changed. The summary and action items can take them into account.</p>
          <button
            type="button"
            onClick={() => { setChanged(false); onUpdateSummary() }}
            disabled={updatingSummary}
            className="shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            Update summary
          </button>
        </div>
      )}
    </section>
  )
}

function BookmarkIcon({ className, filled }) {
  return (
    <svg className={className} fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}
