import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { useNavigate } from 'react-router-dom'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Archive() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: notes, isLoading } = useQuery({
    queryKey: ['notes', 'archived'],
    queryFn: () => api.get('/notes/archived'),
  })

  const unarchive = useMutation({
    mutationFn: (id) => api.patch(`/notes/${id}`, { isArchived: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500 font-medium text-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Archive</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !notes?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No archived notes</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Notes you archive will show up here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 flex items-start gap-3"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/note/${note.id}`)}
                  className="flex-1 text-left min-w-0"
                >
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white leading-tight line-clamp-1">
                    {note.title || 'Untitled'}
                  </h3>
                  {note.summary && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-1 mt-0.5">{note.summary}</p>
                  )}
                  <span className="text-xs text-neutral-400 mt-1 block">{formatDate(note.recordedAt)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => unarchive.mutate(note.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors flex-shrink-0"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
