import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { parseTerms } from '@/lib/searchTerms'
import { Highlight } from '@/lib/highlight'
import NoteCard, { NoteCardSkeleton } from '@/components/NoteCard'
import { getInitials, colorForName } from '@/lib/format'

const PAGE_SIZE = 20
const RECENT_KEY = 'recap-recent-searches'

const RANGES = [
  { value: '', label: 'Any time' },
  { value: '7', label: 'Past week' },
  { value: '30', label: 'Past month' },
  { value: '90', label: 'Past 3 months' },
  { value: '365', label: 'Past year' },
]

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // storage blocked; recent searches are a convenience only
  }
}

export default function Search() {
  const api = useApi()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const inputRef = useRef(null)

  const q = params.get('q') || ''
  const personId = params.get('person') || ''
  const range = params.get('range') || ''
  const includeArchived = params.get('archived') === '1'

  const [input, setInput] = useState(q)
  const [recent, setRecent] = useState(loadRecent)

  // Keep the box in sync when the URL changes (back/forward, recent search click)
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) {
    setLastQ(q)
    setInput(q)
  }

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  // Debounce typing into the URL
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === q) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (trimmed) next.set('q', trimmed)
      else next.delete('q')
      setParams(next, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [input, q, params, setParams])

  const from = useMemo(() => {
    if (!range) return ''
    const d = new Date()
    d.setDate(d.getDate() - Number(range))
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [range])

  const { data: people } = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get('/people'),
    staleTime: 5 * 60 * 1000,
  })
  const humans = (people || []).filter((p) => p.relationship !== 'organization')

  const search = useInfiniteQuery({
    queryKey: ['search', q, personId, from, includeArchived],
    queryFn: ({ pageParam = 0, signal }) => {
      const sp = new URLSearchParams({ q, limit: String(PAGE_SIZE), offset: String(pageParam) })
      if (personId) sp.set('personId', personId)
      if (from) sp.set('from', from)
      if (includeArchived) sp.set('archived', 'include')
      return api.get(`/notes/search?${sp}`, { signal })
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + (p.notes?.length || 0), 0)
      return loaded < (last.total || 0) ? loaded : undefined
    },
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  })

  const first = search.data?.pages?.[0]
  const notes = search.data?.pages?.flatMap((p) => p.notes || []) ?? []
  const matchedPeople = first?.people ?? []
  const matchedCommitments = first?.commitments ?? []
  const total = first?.total ?? 0
  const terms = useMemo(() => parseTerms(q), [q])

  // Remember a search once the user acts on its results
  const remember = () => {
    if (!q) return
    const next = [q, ...recent.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)
    setRecent(next)
    saveRecent(next)
  }

  const openNote = (id, time) => {
    remember()
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (time != null) sp.set('t', String(Math.floor(time)))
    navigate(`/note/${id}${sp.toString() ? `?${sp}` : ''}`)
  }
  const hasFilters = personId || range || includeArchived
  const showInitial = !q
  const loading = q && search.isLoading
  const noResults = q && !search.isLoading && !search.isError && first && total === 0 && matchedPeople.length === 0 && matchedCommitments.length === 0

  return (
    <div className="min-h-full pb-8">
      <div className="sticky top-0 z-10 bg-neutral-50/85 dark:bg-black/85 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-3">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setInput('')
                if (e.key === 'Enter' && notes[0]) openNote(notes[0].id)
              }}
              placeholder="Search transcripts, people, topics…"
              autoFocus
              enterKeyHint="search"
              aria-label="Search"
              className="w-full pl-11 pr-11 py-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition"
            />
            {search.isFetching && q ? (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            ) : input ? (
              <button
                type="button"
                onClick={() => { setInput(''); inputRef.current?.focus() }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                aria-label="Clear search"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>

          <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
            <FilterSelect
              value={range}
              onChange={(v) => setParam('range', v)}
              options={RANGES}
              active={!!range}
              label="Date range"
            />
            <FilterSelect
              value={personId}
              onChange={(v) => setParam('person', v)}
              options={[{ value: '', label: 'Anyone' }, ...humans.map((p) => ({ value: p.id, label: p.name }))]}
              active={!!personId}
              label="Person"
            />
            <button
              type="button"
              onClick={() => setParam('archived', includeArchived ? '' : '1')}
              className={`chip ${includeArchived ? 'chip-active' : ''}`}
            >
              Include archived
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams()
                  if (q) next.set('q', q)
                  setParams(next, { replace: true })
                }}
                className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {showInitial && (
          <div className="pt-4">
            {recent.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="section-label">Recent searches</h2>
                  <button type="button" onClick={() => { setRecent([]); saveRecent([]) }} className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <button key={r} type="button" onClick={() => setInput(r)} className="chip">
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">Search everything you&apos;ve recorded</h2>
              <ul className="space-y-2 text-sm text-neutral-500 dark:text-neutral-400">
                <li>Full transcripts, titles, summaries, tags, topics and people are all searched.</li>
                <li>Multiple words find conversations containing <em>all</em> of them.</li>
                <li>Use quotes for an exact phrase, like <code className="px-1 rounded bg-neutral-100 dark:bg-neutral-800">&quot;next quarter&quot;</code>.</li>
                <li>Open a result to jump straight to each match in the transcript.</li>
              </ul>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-3">
            <NoteCardSkeleton />
            <NoteCardSkeleton />
            <NoteCardSkeleton />
          </div>
        )}

        {q && search.isError && (
          <div className="text-center py-12">
            <p className="text-sm text-red-500 mb-3">{search.error?.message || 'Search failed.'}</p>
            <button type="button" onClick={() => search.refetch()} className="btn-secondary">Try again</button>
          </div>
        )}

        {noResults && (
          <div className="text-center py-16">
            <p className="text-neutral-900 dark:text-white font-medium mb-1">No results for &ldquo;{q}&rdquo;</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {hasFilters ? 'Try removing some filters, or ' : 'Try '}fewer or different words.
            </p>
          </div>
        )}

        {q && !loading && matchedPeople.length > 0 && (
          <section className="mb-6">
            <h2 className="section-label mb-2">People</h2>
            <div className="flex flex-wrap gap-2">
              {matchedPeople.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => { remember(); navigate(`/person/${person.id}`) }}
                  className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500 transition-colors"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${person.relationship === 'organization' ? 'bg-purple-500 rounded-lg' : colorForName(person.name)}`}>
                    {getInitials(person.name)}
                  </span>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300"><Highlight text={person.name} terms={terms} /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {q && !loading && matchedCommitments.length > 0 && (
          <section className="mb-6">
            <h2 className="section-label mb-2">Commitments</h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {matchedCommitments.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => c.noteId && openNote(c.noteId)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'completed' ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                  <span className={`text-sm flex-1 ${c.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-700 dark:text-neutral-300'}`}>
                    <Highlight text={c.description} terms={terms} />
                  </span>
                  <span className="text-xs text-neutral-400">{c.owner === 'me' ? 'You' : 'Them'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {q && !loading && notes.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="section-label">Conversations</h2>
              <span className="text-xs text-neutral-400">{total} result{total === 1 ? '' : 's'}</span>
            </div>
            <div className={`flex flex-col gap-3 transition-opacity ${search.isPlaceholderData ? 'opacity-60' : ''}`}>
              {notes.map((note) => (
                <NoteCard key={note.id} note={note} terms={terms} onClick={() => openNote(note.id)} onOpenAt={(t) => openNote(note.id, t)} />
              ))}
            </div>
            {search.hasNextPage && (
              <div className="flex justify-center mt-4">
                <button
                  type="button"
                  onClick={() => search.fetchNextPage()}
                  disabled={search.isFetchingNextPage}
                  className="btn-secondary"
                >
                  {search.isFetchingNextPage ? 'Loading…' : 'Show more results'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function FilterSelect({ value, onChange, options, active, label }) {
  return (
    <label className={`chip relative pr-7 ${active ? 'chip-active' : ''}`}>
      <span className="sr-only">{label}</span>
      <span className="whitespace-nowrap">{options.find((o) => o.value === value)?.label ?? options[0].label}</span>
      <svg className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label={label}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
