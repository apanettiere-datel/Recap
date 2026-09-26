import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { dayGroupLabel, getInitials, colorForName } from '@/lib/format'
import NoteCard, { NoteCardSkeleton } from '@/components/NoteCard'
import UpcomingMeetings from '@/components/UpcomingMeetings'

const PAGE_SIZE = 50

const DATE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]

function getDateFilterStart(filter) {
  const now = new Date()
  switch (filter) {
    case 'today': {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - start.getDay())
      start.setHours(0, 0, 0, 0)
      return start
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    default:
      return null
  }
}

export default function Feed() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dateFilter, setDateFilter] = useState('all')
  const [filterPersonId, setFilterPersonId] = useState(null)
  const [showNewNote, setShowNewNote] = useState(false)

  const feed = useInfiniteQuery({
    queryKey: ['notes', 'feed'],
    queryFn: ({ pageParam = 0, signal }) => api.get(`/notes?archived=false&limit=${PAGE_SIZE}&offset=${pageParam}`, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined),
    refetchInterval: (query) =>
      query.state.data?.pages?.some((p) => p.some((n) => n.isProcessing)) ? 4000 : false,
  })

  const { data: people } = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get('/people'),
  })
  const humans = useMemo(() => (people || []).filter((p) => p.relationship !== 'organization'), [people])

  const retry = useMutation({
    mutationFn: (id) => api.post(`/notes/${id}/reprocess`, {}),
    onSuccess: () => {
      toast.info('Processing restarted')
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  const notes = useMemo(() => feed.data?.pages?.flat() ?? [], [feed.data])

  const groups = useMemo(() => {
    const filterStart = getDateFilterStart(dateFilter)
    const visible = notes.filter((n) => {
      if (n.isArchived) return false
      if (filterStart && new Date(n.recordedAt) < filterStart) return false
      if (filterPersonId && !n.people?.some((p) => p.id === filterPersonId)) return false
      return true
    })
    const pinned = visible.filter((n) => n.isPinned)
    const rest = visible.filter((n) => !n.isPinned)
    const out = []
    if (pinned.length) out.push({ label: 'Pinned', notes: pinned })
    for (const n of rest) {
      const label = dayGroupLabel(n.recordedAt)
      const last = out[out.length - 1]
      if (last && last.label === label && last.label !== 'Pinned') last.notes.push(n)
      else out.push({ label, notes: [n] })
    }
    return out
  }, [notes, dateFilter, filterPersonId])

  const processingCount = notes.filter((n) => n.isProcessing).length
  const filtered = dateFilter !== 'all' || filterPersonId

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-10 bg-neutral-50/85 dark:bg-black/85 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white truncate">Conversations</h1>
            <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
              <button type="button" onClick={() => navigate('/daily')} className="btn-ghost !px-3 !py-1.5 text-sm">
                Today
              </button>
              <button type="button" onClick={() => navigate('/chat')} className="btn-primary !px-4 !py-1.5 text-sm">
                Ask Recap
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/search')}
            className="mt-3 w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-left text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="flex-1 text-[15px]">Search transcripts, people, topics…</span>
            <kbd className="hidden md:inline text-[11px] font-sans px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-400">/</kbd>
          </button>

          <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar -mx-4 px-4">
            {DATE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setDateFilter(f.value)}
                className={`chip ${dateFilter === f.value ? 'chip-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
            {humans.length > 0 && <span className="w-px bg-neutral-200 dark:bg-neutral-800 shrink-0 my-1" />}
            {humans.slice(0, 12).map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setFilterPersonId(filterPersonId === person.id ? null : person.id)}
                className={`chip !pl-1 ${filterPersonId === person.id ? 'chip-active' : ''}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${colorForName(person.name)}`}>
                  {getInitials(person.name)}
                </span>
                {person.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4">
        <div className="flex gap-2 pt-4 overflow-x-auto no-scrollbar">
          <QuickLink onClick={() => setShowNewNote(true)} color="text-emerald-500" label="Write note">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </QuickLink>
          <QuickLink onClick={() => navigate('/commitments')} color="text-blue-500" label="Commitments">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </QuickLink>
          <QuickLink onClick={() => navigate('/archive')} color="text-amber-500" label="Archive">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </QuickLink>
        </div>

        <UpcomingMeetings />

        {processingCount > 0 && (
          <p className="mt-4 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Processing {processingCount} recording{processingCount === 1 ? '' : 's'}…
          </p>
        )}

        {feed.isLoading ? (
          <div className="flex flex-col gap-3 pt-6">
            <NoteCardSkeleton />
            <NoteCardSkeleton />
            <NoteCardSkeleton />
          </div>
        ) : feed.isError && notes.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-neutral-900 dark:text-white font-medium mb-1">Couldn&apos;t load your conversations</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{feed.error?.message}</p>
            <button type="button" onClick={() => feed.refetch()} className="btn-primary">Try again</button>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState filtered={filtered} onClear={() => { setDateFilter('all'); setFilterPersonId(null) }} onRecord={() => navigate('/recording')} />
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.label} className="pt-6">
                <h2 className="section-label mb-2">{group.label}</h2>
                <div className="flex flex-col gap-3">
                  {group.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onClick={() => navigate(`/note/${note.id}`)}
                      onRetry={() => retry.mutate(note.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {feed.hasNextPage && (
              <div className="flex justify-center pt-6">
                <button type="button" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className="btn-secondary">
                  {feed.isFetchingNextPage ? 'Loading…' : 'Load older conversations'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNewNote && <NewNoteModal onClose={() => setShowNewNote(false)} />}
    </div>
  )
}

function QuickLink({ onClick, color, label, children }) {
  return (
    <button type="button" onClick={onClick} className="chip">
      <svg className={`w-4 h-4 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>{children}</svg>
      {label}
    </button>
  )
}

function EmptyState({ filtered, onClear, onRecord }) {
  if (filtered) {
    return (
      <div className="text-center py-20">
        <p className="text-neutral-900 dark:text-white font-medium mb-1">Nothing matches these filters</p>
        <button type="button" onClick={onClear} className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-2">Clear filters</button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No conversations yet</h2>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mb-5">
        Record a conversation or meeting and Recap will transcribe it, summarize it, and track what was promised.
      </p>
      <button type="button" onClick={onRecord} className="btn-primary !bg-red-500 hover:!bg-red-600">Start recording</button>
    </div>
  )
}

function NewNoteModal({ onClose }) {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const create = useMutation({
    meta: { silent: true }, // error is shown inline
    mutationFn: (body) => api.post('/notes/text', body),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      onClose()
      navigate(`/note/${note.id}`)
    },
  })

  const canSave = title.trim() && content.trim() && !create.isPending
  const close = () => {
    if ((title.trim() || content.trim()) && !window.confirm('Discard this note?')) return
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 animate-[fadeIn_.15s_ease-out]"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      onKeyDown={(e) => { if (e.key === 'Escape') close() }}
    >
      <div className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">New note</h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="input mb-3"
          autoFocus
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What happened in this conversation?"
          rows={6}
          className="input resize-none mb-4"
        />
        {create.isError && <p className="text-sm text-red-500 mb-3">{create.error?.message}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={close} className="btn-ghost">Cancel</button>
          <button
            type="button"
            onClick={() => canSave && create.mutate({ title: title.trim(), content: content.trim() })}
            disabled={!canSave}
            className="btn-primary"
          >
            {create.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
