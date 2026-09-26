import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { projectColor } from '@/lib/projectColors'

/** Which projects a conversation belongs to, with a picker to add or create one. */
export default function NoteProjects({ noteId, projects }) {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = projects || []

  const all = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
    enabled: open,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['note', noteId] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    queryClient.invalidateQueries({ queryKey: ['project'] })
  }

  const add = useMutation({
    mutationFn: (projectId) => api.post(`/projects/${projectId}/notes`, { noteId }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (projectId) => api.del(`/projects/${projectId}/notes/${noteId}`),
    onSuccess: refresh,
  })
  const create = useMutation({
    mutationFn: (name) => api.post('/projects', { name, noteIds: [noteId] }),
    onSuccess: (p) => {
      refresh()
      toast.success(`Created project “${p.name}”`, { action: { label: 'Open', onClick: () => navigate(`/projects/${p.id}`) } })
    },
  })

  const close = () => { setOpen(false); setQuery('') }
  const q = query.trim().toLowerCase()
  const options = (all.data || []).filter((p) => !current.some((c) => c.id === p.id) && (!q || p.name.toLowerCase().includes(q)))
  const exact = (all.data || []).some((p) => p.name.toLowerCase() === q)

  return (
    <div className="flex items-center gap-2 flex-wrap mb-6 -mt-3">
      {current.map((p) => {
        const color = projectColor(p.color)
        return (
          <span key={p.id} className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs font-semibold ${color.soft}`}>
            <button type="button" onClick={() => navigate(`/projects/${p.id}`)} className="inline-flex items-center gap-1.5" title={p.auto ? 'Filed automatically' : undefined}>
              <span className={`w-2 h-2 rounded-full ${color.dot}`} />
              {p.name}
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(p.id)}
              className="p-0.5 rounded-full opacity-60 hover:opacity-100"
              aria-label={`Remove from ${p.name}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        )
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 text-xs font-medium text-neutral-500 hover:text-blue-600 hover:border-blue-500 transition-colors"
          aria-expanded={open}
        >
          <FolderIcon className="w-3.5 h-3.5" />
          {current.length ? 'Add to project' : 'Add to a project'}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={close} />
            <div className="absolute left-0 top-9 z-30 w-72 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl p-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (options.length === 1 && q) { add.mutate(options[0].id); close() }
                  else if (q && !exact) { create.mutate(query.trim()); close() }
                }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && close()}
                  placeholder="Find or create a project"
                  className="input !py-2 text-sm"
                  autoFocus
                  maxLength={80}
                />
              </form>
              <div className="max-h-60 overflow-y-auto mt-1">
                {all.isLoading && <p className="px-3 py-2 text-sm text-neutral-400">Loading…</p>}
                {options.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { add.mutate(p.id); close() }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${projectColor(p.color).dot}`} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-neutral-400">{p.conversationCount}</span>
                  </button>
                ))}
                {q && !exact && (
                  <button
                    type="button"
                    onClick={() => { create.mutate(query.trim()); close() }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-blue-600 dark:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    New project “{query.trim()}”
                  </button>
                )}
                {!all.isLoading && !q && options.length === 0 && (
                  <p className="px-3 py-2 text-xs text-neutral-400 leading-relaxed">
                    Type a name to create a project, e.g. a client, a deal or a rollout. Future conversations about it are filed automatically.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function FolderIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  )
}
