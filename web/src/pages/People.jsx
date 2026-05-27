import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'

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

function formatLastContact(dateStr) {
  if (!dateStr) return 'No conversations'
  const d = new Date(dateStr)
  const now = new Date()
  const days = Math.floor((now - d) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'lastContact', label: 'Last Contacted' },
  { value: 'recent', label: 'Recently Added' },
]

export default function People() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sort, setSort] = useState('lastContact')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', role: '', organization: '', phone: '', email: '', relationship: '' })

  const createPerson = useMutation({
    mutationFn: (body) => api.post('/people', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      setForm({ name: '', role: '', organization: '', phone: '', email: '', relationship: '' })
      setShowForm(false)
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    createPerson.mutate({ ...form, name: form.name.trim() })
  }

  const { data: people, isLoading, error } = useQuery({
    queryKey: ['people', sort],
    queryFn: () => api.get(`/people?sort=${sort}`),
  })

  const { data: allCommitments } = useQuery({
    queryKey: ['commitments'],
    queryFn: () => api.get('/commitments'),
  })

  const overdueByPerson = useMemo(() => {
    if (!allCommitments) return {}
    const now = new Date()
    const map = {}
    for (const c of allCommitments) {
      const isOverdue = c.status === 'overdue' ||
        (c.status === 'open' && c.dueDate && new Date(c.dueDate) < now)
      if (isOverdue && c.personId) {
        map[c.personId] = (map[c.personId] || 0) + 1
      }
    }
    return map
  }, [allCommitments])

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
          <p className="text-red-500 font-medium mb-2">Failed to load people</p>
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
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">People</h1>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-500 text-white text-lg font-bold hover:bg-blue-600 transition-colors"
              aria-label="Add contact"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-2">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSort(opt.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  sort === opt.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-neutral-200/60 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-300/60 dark:hover:bg-neutral-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 mb-4 space-y-3"
          >
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">New Contact</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name *"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="col-span-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Role"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Organization"
                value={form.organization}
                onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Relationship"
                value={form.relationship}
                onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {createPerson.isError && (
              <p className="text-xs text-red-500">{createPerson.error?.message || 'Failed to create contact'}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm({ name: '', role: '', organization: '', phone: '', email: '', relationship: '' }) }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createPerson.isPending}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {createPerson.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {!people || people.filter(p => p.relationship !== 'organization').length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No people yet</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
              People mentioned in your conversations will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
            {people.filter(p => p.relationship !== 'organization').map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => navigate(`/person/${person.id}`)}
                className="w-full flex items-center gap-4 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white flex-shrink-0 ${colorForName(person.name)}`}>
                  {getInitials(person.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
                      {person.name}
                    </h3>
                    {overdueByPerson[person.id] > 0 && (
                      <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none">
                        {overdueByPerson[person.id]}
                      </span>
                    )}
                  </div>
                  {(person.role || person.organization) && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                      {[person.role, person.organization].filter(Boolean).join(' at ')}
                    </p>
                  )}
                  {!person.role && !person.organization && person.relationship && (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate mt-0.5">
                      {person.relationship}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {formatLastContact(person.lastContactDate)}
                    </span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {person.totalConversations} conversation{person.totalConversations !== 1 ? 's' : ''}
                    </span>
                    {person.openCommitments > 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-500">
                        {person.openCommitments} open
                      </span>
                    )}
                  </div>
                </div>
                <svg className="w-4 h-4 text-neutral-300 dark:text-neutral-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
