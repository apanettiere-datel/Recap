import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  if (diff < 86400000) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`
  return formatDate(dateStr)
}

export default function Briefing() {
  const { personId } = useParams()
  const navigate = useNavigate()
  const api = useApi()

  const { data, isLoading, error } = useQuery({
    queryKey: ['briefing', 'person', personId],
    queryFn: () => api.get(`/briefing/person/${personId}`),
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load briefing</p>
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500 text-sm font-medium">Go back</button>
        </div>
      </div>
    )
  }

  const { person, lastConversation, recentNotes, openCommitments, overdueCommitments, recentQuotes, recentTopics, talkingPoints } = data

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-12">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Pre-Meeting Briefing</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Person header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-lg font-bold text-blue-500">
            {(person.name?.[0] || '?').toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{person.name}</h2>
            {person.relationship && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{person.relationship}</p>
            )}
          </div>
        </div>

        {/* Talking Points */}
        {talkingPoints.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Suggested Talking Points
            </h3>
            <div className="bg-blue-500/[0.06] dark:bg-blue-500/10 rounded-2xl p-4">
              <ul className="space-y-2.5">
                {talkingPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    <span className="text-sm text-neutral-800 dark:text-neutral-200">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Last Conversation */}
        {lastConversation && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Last Conversation
            </h3>
            <button
              type="button"
              onClick={() => navigate(`/note/${lastConversation.id}`)}
              className="w-full text-left bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {lastConversation.title || 'Untitled'}
                </p>
                <span className="text-xs text-neutral-400 flex-shrink-0">
                  {formatRelativeDate(lastConversation.recordedAt)}
                </span>
              </div>
              {lastConversation.summary && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-3">
                  {lastConversation.summary}
                </p>
              )}
              {lastConversation.sentiment && (
                <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                  lastConversation.sentiment === 'positive' ? 'bg-green-500/20 text-green-500' :
                  lastConversation.sentiment === 'negative' ? 'bg-red-500/20 text-red-500' :
                  'bg-neutral-500/20 text-neutral-400'
                }`}>
                  {lastConversation.sentiment}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Open Commitments */}
        {openCommitments.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Open Commitments
              {overdueCommitments.length > 0 && (
                <span className="text-red-500 ml-2">({overdueCommitments.length} overdue)</span>
              )}
            </h3>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {openCommitments.map((c) => {
                const isOverdue = c.dueDate && new Date(c.dueDate) < new Date()
                return (
                  <div key={c.id} className="flex items-start gap-3 p-4">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isOverdue ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-800 dark:text-neutral-200">{c.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {c.owner && (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                            c.owner === 'me'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-orange-500/10 text-orange-500'
                          }`}>
                            {c.owner === 'me' ? 'You' : 'Them'}
                          </span>
                        )}
                        {c.dueDate && (
                          <span className={`text-xs ${isOverdue ? 'text-red-500 font-semibold' : 'text-neutral-400'}`}>
                            {isOverdue ? 'Overdue' : `Due ${formatDate(c.dueDate)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Key Quotes */}
        {recentQuotes.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Key Quotes
            </h3>
            <div className="flex flex-col gap-3">
              {recentQuotes.map((quote, i) => (
                <blockquote key={i} className="border-l-4 border-blue-500 pl-4 py-1">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300 italic leading-relaxed">
                    &ldquo;{quote.text}&rdquo;
                  </p>
                  {quote.speaker && (
                    <p className="text-xs text-neutral-400 mt-1">&mdash; {quote.speaker}</p>
                  )}
                </blockquote>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {recentTopics.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Frequent Topics
            </h3>
            <div className="flex flex-wrap gap-2">
              {recentTopics.map((topic, i) => (
                <span key={i} className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 text-sm font-medium">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recent Notes */}
        {recentNotes.length > 1 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Past Conversations
            </h3>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {recentNotes.slice(1).map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => navigate(`/note/${note.id}`)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                      {note.title || 'Untitled'}
                    </p>
                    {note.summary && (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1 mt-0.5">
                        {note.summary}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-neutral-400 flex-shrink-0">
                    {formatDate(note.recordedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
