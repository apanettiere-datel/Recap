import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function sentimentColor(sentiment) {
  switch (sentiment) {
    case 'positive': return 'bg-green-500/20 text-green-500'
    case 'negative': return 'bg-red-500/20 text-red-500'
    case 'mixed': return 'bg-yellow-500/20 text-yellow-500'
    default: return 'bg-neutral-500/20 text-neutral-400'
  }
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500',
  'bg-orange-500', 'bg-indigo-500', 'bg-green-500', 'bg-red-500',
]

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function colorForName(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function NoteCard({ note, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white dark:bg-neutral-900 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow border border-neutral-200 dark:border-neutral-800"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-white leading-tight line-clamp-1 flex-1">
          {note.isPinned && <span className="mr-1">📌</span>}
          {note.title || 'Untitled Note'}
        </h3>
        <span className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap flex-shrink-0">
          {formatDate(note.recordedAt)}
        </span>
      </div>

      {note.summary && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 mb-3 leading-relaxed">
          {note.summary}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {note.sentiment && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sentimentColor(note.sentiment)}`}>
              {note.sentiment}
            </span>
          )}
          {note.commitments?.length > 0 && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              {note.commitments.length} commitment{note.commitments.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {note.people?.length > 0 && (
          <div className="flex -space-x-1.5">
            {note.people.slice(0, 3).map((person, i) => (
              <div
                key={person.id || i}
                title={person.name}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white dark:ring-neutral-900 ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
              >
                {getInitials(person.name)}
              </div>
            ))}
            {note.people.length > 3 && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-neutral-500 bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300 ring-2 ring-white dark:ring-neutral-900">
                +{note.people.length - 3}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

const DATE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
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
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return start
    }
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
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  const { data: notes, isLoading, error } = useQuery({
    queryKey: ['notes'],
    queryFn: () => api.get('/notes'),
  })

  const { data: people } = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get('/people'),
  })

  const createTextNote = useMutation({
    mutationFn: (body) => api.post('/notes/text', body),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setShowNewNote(false)
      setNewTitle('')
      setNewContent('')
      navigate(`/note/${note.id}`)
    },
  })

  const sortedNotes = useMemo(() => {
    if (!notes) return []
    const filterStart = getDateFilterStart(dateFilter)
    return notes
      .filter((n) => {
        if (n.isArchived) return false
        if (filterStart && new Date(n.recordedAt) < filterStart) return false
        if (filterPersonId && !n.people?.some((p) => p.id === filterPersonId)) return false
        return true
      })
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return new Date(b.recordedAt) - new Date(a.recordedAt)
      })
  }, [notes, dateFilter, filterPersonId])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load notes</p>
          <p className="text-sm text-neutral-400">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Recap</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/daily')}
                className="px-3 py-2 rounded-full text-neutral-500 dark:text-neutral-400 text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => navigate('/chat')}
                className="px-4 py-2 rounded-full bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
              >
                Ask Recap
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="max-w-2xl mx-auto px-4 pt-4 flex gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setShowNewNote(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors whitespace-nowrap flex-shrink-0"
        >
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          Write Note
        </button>
        <button
          type="button"
          onClick={() => navigate('/commitments')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors whitespace-nowrap flex-shrink-0"
        >
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Commitments
        </button>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors whitespace-nowrap flex-shrink-0"
        >
          <svg className="w-4 h-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          Search
        </button>
        <button
          type="button"
          onClick={() => navigate('/archive')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors whitespace-nowrap flex-shrink-0"
        >
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          Archive
        </button>
      </div>

      {/* Date filter */}
      <div className="max-w-2xl mx-auto px-4 pt-3 flex gap-2 overflow-x-auto">
        {DATE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setDateFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
              dateFilter === f.value
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Person filter */}
      {people?.filter(p => p.relationship !== 'organization').length > 0 && (
        <div className="max-w-2xl mx-auto px-4 pt-3 flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilterPersonId(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
              filterPersonId === null
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500'
            }`}
          >
            All People
          </button>
          {people.filter(p => p.relationship !== 'organization').map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setFilterPersonId(filterPersonId === person.id ? null : person.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                filterPersonId === person.id
                  ? 'bg-white dark:bg-neutral-900 border-2 border-blue-500 text-neutral-900 dark:text-white'
                  : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 ${colorForName(person.name)}`}>
                {getInitials(person.name)}
              </span>
              {person.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Feed */}
      <div className="max-w-2xl mx-auto px-4 pt-3">
        {sortedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No conversations yet</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
              Record your first conversation to get started with Recap.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => navigate(`/note/${note.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Record FAB */}
      <button
        type="button"
        onClick={() => navigate('/recording')}
        className="fixed md:bottom-6 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-6 w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 flex items-center justify-center transition-all active:scale-95 z-20"
        aria-label="Record"
      >
        <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 15.75a3.75 3.75 0 003.75-3.75V6a3.75 3.75 0 10-7.5 0v6a3.75 3.75 0 003.75 3.75z" />
          <path d="M7.5 12a4.5 4.5 0 009 0V6a4.5 4.5 0 00-9 0v6zM12 18.75a6.75 6.75 0 006.75-6.75h-1.5a5.25 5.25 0 01-10.5 0h-1.5A6.75 6.75 0 0012 18.75zM11.25 21v-2.25h1.5V21h-1.5z" />
        </svg>
      </button>

      {/* New Text Note Modal */}
      {showNewNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewNote(false) }}
        >
          <div className="bg-white dark:bg-neutral-900 rounded-2xl w-full max-w-md p-5">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">New Note</h2>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title"
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500 mb-3"
              autoFocus
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="What happened in this conversation?"
              rows={5}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500 resize-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowNewNote(false); setNewTitle(''); setNewContent('') }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newTitle.trim() || !newContent.trim()) return
                  createTextNote.mutate({ title: newTitle.trim(), content: newContent.trim() })
                }}
                disabled={!newTitle.trim() || !newContent.trim() || createTextNote.isPending}
                className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40"
              >
                {createTextNote.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
