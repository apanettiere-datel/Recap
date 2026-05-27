import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'

export default function Report() {
  const api = useApi()
  const queryClient = useQueryClient()

  const { data: reports, isLoading, error } = useQuery({
    queryKey: ['report'],
    queryFn: () => api.get('/insights/reports'),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post('/insights/reports/generate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report'] })
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
          <p className="text-red-500 font-medium mb-2">Failed to load report</p>
          <p className="text-sm text-neutral-400">{error.message}</p>
        </div>
      </div>
    )
  }

  const r = Array.isArray(reports) ? reports[0] : reports

  if (!r || (!r.narrative && !r.conversationCount)) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
        <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Weekly Report</h1>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No report yet</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mb-4">
              Generate a weekly summary of your conversations and commitments.
            </p>
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="px-6 py-2.5 rounded-full bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {generateMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating
                </span>
              ) : (
                'Generate Report'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Weekly Report</h1>
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="px-4 py-2 rounded-full bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {generateMutation.isPending ? 'Generating...' : 'Regenerate'}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">
              {r.conversationCount ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Conversations</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">
              {r.uniquePeopleCount ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">People</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-green-500">
              {r.commitmentsCompleted ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Completed</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-orange-500">
              {r.commitmentsOverdue ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Overdue</p>
          </div>
        </div>

        {/* Narrative */}
        {r.narrative && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Summary
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-5 border border-neutral-200 dark:border-neutral-800">
              <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap">
                {r.narrative}
              </p>
            </div>
          </div>
        )}

        {/* Topics */}
        {r.topTopics?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Topics This Week
            </h2>
            <div className="flex flex-wrap gap-2">
              {r.topTopics.map((topic, i) => (
                <span key={i} className="px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-500 text-sm font-medium">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dropped Threads */}
        {r.droppedThreads?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Dropped Threads
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {r.droppedThreads.map((thread, i) => (
                <div key={i} className="flex items-start gap-3 p-4">
                  <span className="text-orange-500 mt-0.5 flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </span>
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">{thread}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Avoided Topics */}
        {r.avoidedTopics?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Avoided Topics
            </h2>
            <div className="flex flex-wrap gap-2">
              {r.avoidedTopics.map((topic, i) => (
                <span key={i} className="px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 text-sm font-medium">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Focus */}
        {r.suggestedFocus?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Focus for Next Week
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {r.suggestedFocus.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-4">
                  <span className="text-blue-500 mt-0.5 flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {r.generatedAt && (
          <p className="text-xs text-neutral-400 text-center mt-8">
            Generated {new Date(r.generatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}
