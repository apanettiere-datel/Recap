import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'

function priorityBadge(priority) {
  switch (priority) {
    case 'high': return 'bg-red-500/20 text-red-500'
    case 'medium': return 'bg-orange-500/20 text-orange-500'
    case 'low': return 'bg-blue-500/20 text-blue-500'
    default: return 'bg-neutral-500/20 text-neutral-400'
  }
}

export default function Insights() {
  const api = useApi()
  const queryClient = useQueryClient()

  const { data: insights, isLoading, error } = useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get('/insights'),
  })

  const refreshMutation = useMutation({
    mutationFn: () => api.post('/insights/refresh'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights'] })
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (insightId) => api.patch(`/insights/${insightId}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights'] })
    },
  })

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
          <p className="text-red-500 font-medium mb-2">Failed to load insights</p>
          <p className="text-sm text-neutral-400">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Insights</h1>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="px-4 py-2 rounded-full bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {refreshMutation.isPending ? (
              <span className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Refreshing
              </span>
            ) : (
              'Refresh'
            )}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {!insights || insights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No insights yet</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mb-4">
              Record some conversations and Recap will generate insights for you.
            </p>
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="px-6 py-2.5 rounded-full bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              Generate Insights
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    {insight.priority && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priorityBadge(insight.priority)}`}>
                        {insight.priority}
                      </span>
                    )}
                    {insight.type && (
                      <span className="text-xs text-neutral-400">{insight.type.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissMutation.mutate(insight.id)}
                    disabled={dismissMutation.isPending}
                    className="text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400 transition-colors flex-shrink-0"
                    aria-label="Dismiss"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
                  {insight.title}
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {insight.body}
                </p>
                {insight.relatedPersonName && (
                  <p className="text-xs text-blue-500 font-medium mt-2">
                    {insight.relatedPersonName}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
