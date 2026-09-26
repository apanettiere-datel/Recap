import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { useNavigate } from 'react-router-dom'

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

export default function Entities() {
  const api = useApi()
  const navigate = useNavigate()

  const { data: people, isLoading, error } = useQuery({
    queryKey: ['people', 'name'],
    queryFn: () => api.get('/people?sort=name'),
  })

  const entities = (people || []).filter(p => p.relationship === 'organization')

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
          <p className="text-red-500 font-medium mb-2">Failed to load entities</p>
          <p className="text-sm text-neutral-400">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Entities</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Companies and organizations mentioned in your conversations</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {entities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No entities yet</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
              Companies and organizations mentioned in your conversations will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
            {entities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => navigate(`/person/${entity.id}`)}
                className="w-full flex items-center gap-4 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-base font-bold text-white flex-shrink-0 ${colorForName(entity.name)}`}>
                  {getInitials(entity.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
                    {entity.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {formatLastContact(entity.lastContactDate)}
                    </span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {entity.totalConversations} conversation{entity.totalConversations !== 1 ? 's' : ''}
                    </span>
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
