import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  if (diff < 86400000) return 'Today'
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

export default function Search() {
  const api = useApi()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const timerRef = useRef(null)

  const handleChange = (value) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim())
    }, 300)
  }

  const { data: results, isLoading, error } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.get(`/notes/search/${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length > 0,
  })

  const notes = results?.notes ?? []
  const matchedPeople = results?.people ?? []
  const matchedCommitments = results?.commitments ?? []

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      {/* Search Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Search conversations..."
              autoFocus
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-blue-500 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setDebouncedQuery('')
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {/* Empty / initial state */}
        {!debouncedQuery && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-neutral-400 dark:text-neutral-500">
              Search by title, content, people, or topics
            </p>
          </div>
        )}

        {/* Loading */}
        {debouncedQuery && isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-500 text-sm">{error.message}</p>
          </div>
        )}

        {/* No results */}
        {debouncedQuery && !isLoading && results && notes.length === 0 && matchedPeople.length === 0 && matchedCommitments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-neutral-500 dark:text-neutral-400 text-sm">
              No results for &ldquo;{debouncedQuery}&rdquo;
            </p>
          </div>
        )}

        {/* People results */}
        {matchedPeople.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">People</h2>
            <div className="flex flex-wrap gap-2">
              {matchedPeople.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => navigate(`/person/${person.id}`)}
                  className="px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors"
                >
                  {person.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Commitment results */}
        {matchedCommitments.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">Commitments</h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {matchedCommitments.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'open' ? 'bg-orange-500' : 'bg-green-500'}`} />
                  <span className="text-sm text-neutral-700 dark:text-neutral-300 flex-1">{c.description}</span>
                  <span className="text-xs text-neutral-400">{c.owner}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Note results */}
        {notes.length > 0 && (
          <div className="flex flex-col gap-3">
            {matchedPeople.length > 0 || matchedCommitments.length > 0 ? (
              <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Conversations</h2>
            ) : null}
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => navigate(`/note/${note.id}`)}
                className="w-full text-left bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white line-clamp-1 flex-1">
                    {note.title || 'Untitled'}
                  </h3>
                  <span className="text-xs text-neutral-400 flex-shrink-0">
                    {formatDate(note.recordedAt)}
                  </span>
                </div>
                {note.summary && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed">
                    {note.summary}
                  </p>
                )}
                {note.sentiment && (
                  <div className="mt-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sentimentColor(note.sentiment)}`}>
                      {note.sentiment}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
