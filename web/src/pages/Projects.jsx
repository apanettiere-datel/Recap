import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { formatRelativeDate } from '@/lib/format'
import { projectColor, PROJECT_COLORS } from '@/lib/projectColors'
import { FolderIcon } from '@/components/NoteProjects'

export default function Projects() {
  const api = useApi()
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['projects', showArchived ? 'all' : 'active'],
    queryFn: () => api.get(`/projects${showArchived ? '?archived=include' : ''}`),
  })

  return (
    <div className="min-h-full pb-10">
      <div className="sticky top-0 z-10 bg-neutral-50/85 dark:bg-black/85 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">Projects</h1>
          <button type="button" onClick={() => setCreating(true)} className="btn-primary !py-1.5 !px-3.5 text-sm">New project</button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-5">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-sm text-neutral-500 mb-3">{error.message}</p>
            <button type="button" onClick={() => refetch()} className="btn-secondary">Try again</button>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-16 max-w-sm mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center mx-auto mb-4">
              <FolderIcon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">{showArchived ? 'No projects' : 'Group conversations into projects'}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed mb-5">
              Create a project for a client, a deal or a rollout. Recap files new conversations about it automatically and keeps a running status: what&apos;s decided, what&apos;s open, who owes what and what changed.
            </p>
            {!showArchived && <button type="button" onClick={() => setCreating(true)} className="btn-primary">Create a project</button>}
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((p) => {
              const color = projectColor(p.color)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="w-full text-left bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 hover:shadow-md hover:-translate-y-px transition-all"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                    <h3 className="flex-1 text-[15px] font-semibold text-neutral-900 dark:text-white truncate">{p.name}</h3>
                    {p.archived && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">Archived</span>}
                  </div>
                  {(p.overview || p.description) && (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed">{p.overview || p.description}</p>
                  )}
                  <p className="text-xs text-neutral-400 mt-2">
                    {p.conversationCount} conversation{p.conversationCount === 1 ? '' : 's'}
                    {p.openCommitments > 0 && <> · <span className="text-orange-600 dark:text-orange-400">{p.openCommitments} open item{p.openCommitments === 1 ? '' : 's'}</span></>}
                    {p.lastConversationAt && <> · last {formatRelativeDate(p.lastConversationAt)}</>}
                  </p>
                </button>
              )
            })}
          </div>
        )}

        <button type="button" onClick={() => setShowArchived((v) => !v)} className="mt-6 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
          {showArchived ? 'Hide archived projects' : 'Show archived projects'}
        </button>
      </div>

      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </div>
  )
}

/** Create or edit a project's name, description and color. */
export function ProjectForm({ project, onClose, onSaved }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [color, setColor] = useState(() => project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * 6)])

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => (project
      ? api.patch(`/projects/${project.id}`, { name, description, color })
      : api.post('/projects', { name, description, color })),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', p.id] })
      onClose()
      onSaved?.(p)
    },
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 animate-[fadeIn_.15s_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}
        className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
      >
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">{project ? 'Edit project' : 'New project'}</h2>
        <label className="block text-xs font-medium text-neutral-500 mb-1" htmlFor="project-name">Name</label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="e.g. DataGate rollout, Acme renewal"
          maxLength={80}
          className="input mb-4"
          autoFocus
        />
        <label className="block text-xs font-medium text-neutral-500 mb-1" htmlFor="project-description">What is it about? <span className="font-normal">(helps Recap file conversations automatically)</span></label>
        <textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Rolling out DataGate billing to the West region; contacts Sarah Lee and Tom at Acme"
          maxLength={1000}
          rows={3}
          className="input mb-4 resize-none"
        />
        <div className="flex items-center gap-2 mb-5" role="radiogroup" aria-label="Color">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full ${projectColor(c).dot} ${color === c ? `ring-2 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 ${projectColor(c).ring}` : ''}`}
            />
          ))}
        </div>
        {save.isError && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{save.error.message}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={!name.trim() || save.isPending} className="btn-primary">{save.isPending ? 'Saving…' : project ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </div>
  )
}
