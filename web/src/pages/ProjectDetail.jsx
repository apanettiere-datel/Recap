import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { formatRelativeDate, formatDuration, getInitials, colorForName } from '@/lib/format'
import { projectColor } from '@/lib/projectColors'
import CommitmentRow from '@/components/CommitmentRow'
import { ProjectForm } from './Projects'

export default function ProjectDetail() {
  const { id } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const { data: project, isLoading, error, refetch } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`),
    // The status is rebuilt in the background; poll until it's ready
    refetchInterval: (q) => (q.state.data?.statusUpdating ? 3000 : false),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['project', id] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  const refresh = useMutation({
    mutationFn: () => api.post(`/projects/${id}/refresh`, {}, { timeout: 90000 }),
    onSuccess: (p) => queryClient.setQueryData(['project', id], p),
  })
  const archive = useMutation({
    mutationFn: (archived) => api.patch(`/projects/${id}`, { archived }),
    onSuccess: (_r, archived) => { invalidate(); toast.info(archived ? 'Project archived' : 'Project restored') },
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.info('Project deleted. Its conversations were kept.')
      navigate('/projects', { replace: true })
    },
  })
  const removeNote = useMutation({
    mutationFn: (noteId) => api.del(`/projects/${id}/notes/${noteId}`),
    onSuccess: invalidate,
  })
  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) => api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ['commitments'] }) },
  })

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-20 animate-pulse">
        <div className="h-7 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2 mb-6" />
        <div className="h-32 bg-neutral-200 dark:bg-neutral-800 rounded-2xl" />
      </div>
    )
  }
  if (error || !project) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center">
        <div>
          <p className="font-medium text-neutral-900 dark:text-white mb-1">{error?.status === 404 ? 'Project not found' : "Couldn't load this project"}</p>
          <div className="flex gap-2 justify-center mt-4">
            {error?.status !== 404 && <button type="button" onClick={() => refetch()} className="btn-primary">Try again</button>}
            <button type="button" onClick={() => navigate('/projects')} className="btn-ghost">All projects</button>
          </div>
        </div>
      </div>
    )
  }

  const color = projectColor(project.color)
  const status = project.status
  const open = project.commitments.filter((c) => c.status !== 'completed')
  const done = project.commitments.filter((c) => c.status === 'completed')
  const humans = project.people.filter((p) => p.relationship !== 'organization')
  const orgs = project.people.filter((p) => p.relationship === 'organization')

  return (
    <div className="min-h-full pb-16">
      <header className="sticky top-0 z-10 bg-neutral-50/85 dark:bg-black/85 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-2 h-14 flex items-center gap-1">
          <button type="button" onClick={() => navigate('/projects')} className="icon-btn" aria-label="All projects">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1" />
          <button type="button" onClick={() => navigate(`/chat?projectId=${id}`)} className="chip !py-1.5 text-sm">
            <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Ask
          </button>
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} className="icon-btn" aria-label="More actions" aria-expanded={menu}>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
              </svg>
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-11 z-20 w-52 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl py-1.5 text-sm">
                  <MenuItem onClick={() => { setMenu(false); setEditing(true) }}>Edit project</MenuItem>
                  <MenuItem onClick={() => { setMenu(false); archive.mutate(!project.archived) }}>{project.archived ? 'Restore' : 'Archive'}</MenuItem>
                  <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
                  <MenuItem danger onClick={() => { setMenu(false); if (window.confirm(`Delete the project “${project.name}”? Its conversations are kept.`)) remove.mutate() }}>
                    Delete project
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-2.5 mb-1">
          <span className={`w-3 h-3 rounded-full ${color.dot}`} />
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">{project.name}</h1>
          {project.archived && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500">Archived</span>}
        </div>
        {project.description && <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">{project.description}</p>}
        <p className="text-xs text-neutral-400 mb-6">
          {project.conversations.length} conversation{project.conversations.length === 1 ? '' : 's'}
          {open.length > 0 && ` · ${open.length} open item${open.length === 1 ? '' : 's'}`}
        </p>

        {/* Status */}
        <section className="mb-7 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-label">Where it stands</h2>
            {project.statusUpdating || refresh.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                <span className="w-3 h-3 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" /> Updating…
              </span>
            ) : project.conversations.length > 0 && (
              <button type="button" onClick={() => refresh.mutate()} className="text-xs font-medium text-neutral-400 hover:text-blue-600" title="Rebuild the status now">
                {project.statusUpdatedAt ? `Updated ${formatRelativeDate(project.statusUpdatedAt)} · Refresh` : 'Refresh'}
              </button>
            )}
          </div>
          {project.statusError && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{project.statusError}</p>}
          {project.conversations.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
              No conversations yet. Add some below, or just record: conversations about this project are filed here automatically.
            </p>
          ) : status?.overview ? (
            <>
              <p className="text-[15px] text-neutral-800 dark:text-neutral-200 leading-relaxed">{status.overview}</p>
              {status.latest?.changes && (
                <div className="mt-4 rounded-xl bg-blue-500/5 border border-blue-500/15 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">What changed last time</p>
                  <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{status.latest.changes}</p>
                  <button type="button" onClick={() => navigate(`/note/${status.latest.noteId}`)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline mt-1">
                    {status.latest.title || 'Open conversation'} →
                  </button>
                </div>
              )}
              <StatusList title="Decisions" items={status.decisions} tone="emerald" />
              <StatusList title="Open questions" items={status.openQuestions} tone="amber" />
              <StatusList title="Risks & blockers" items={status.risks} tone="rose" />
              <StatusList title="Next steps" items={status.nextSteps} tone="blue" />
            </>
          ) : (
            <p className="text-sm text-neutral-400">{project.statusUpdating ? 'Reading the conversations…' : 'No status yet.'}</p>
          )}
        </section>

        {project.commitments.length > 0 && (
          <section className="mb-7">
            <h2 className="section-label mb-3">Action items</h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {(showDone ? [...open, ...done] : open).map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onToggle={() => toggleCommitment.mutate({ commitmentId: c.id, status: c.status === 'completed' ? 'open' : 'completed' })}
                />
              ))}
              {open.length === 0 && !showDone && <p className="py-3 text-sm text-neutral-500">Everything is done. 🎉</p>}
            </div>
            {done.length > 0 && (
              <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-2 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                {showDone ? 'Hide completed' : `Show ${done.length} completed`}
              </button>
            )}
          </section>
        )}

        {(humans.length > 0 || orgs.length > 0) && (
          <section className="mb-7">
            <h2 className="section-label mb-3">People</h2>
            <div className="flex flex-wrap gap-2">
              {[...humans, ...orgs].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/person/${p.id}`)}
                  className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500 transition-colors text-sm text-neutral-700 dark:text-neutral-300"
                >
                  <span className={`w-6 h-6 ${p.relationship === 'organization' ? 'rounded-lg bg-purple-500' : `rounded-full ${colorForName(p.name)}`} flex items-center justify-center text-[10px] font-bold text-white`}>{getInitials(p.name)}</span>
                  {p.name}
                  <span className="text-xs text-neutral-400">{p.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-label">Conversations</h2>
            <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-blue-600 dark:text-blue-400">+ Add conversation</button>
          </div>
          {project.conversations.length === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <ol className="relative border-l-2 border-neutral-200 dark:border-neutral-800 ml-1.5 space-y-4">
              {project.conversations.map((n) => (
                <li key={n.id} className="relative pl-5 group">
                  <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-4 ring-neutral-50 dark:ring-black ${color.dot}`} />
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => navigate(`/note/${n.id}`)} className="flex-1 text-left min-w-0">
                      <p className="text-xs text-neutral-400">
                        {formatRelativeDate(n.recordedAt)}
                        {n.duration > 0 && ` · ${formatDuration(n.duration)}`}
                        {n.auto && ' · filed automatically'}
                      </p>
                      <p className="text-[15px] font-semibold text-neutral-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
                        {n.title || (n.isProcessing ? 'Processing…' : 'Untitled')}
                      </p>
                      {n.summary && <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 mt-0.5">{n.summary}</p>}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeNote.mutate(n.id)}
                      className="shrink-0 p-1 text-neutral-300 hover:text-red-500 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      aria-label="Remove from project"
                      title="Remove from project"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {editing && <ProjectForm project={project} onClose={() => setEditing(false)} />}
      {adding && <AddConversation projectId={id} exclude={project.conversations.map((n) => n.id)} onClose={() => setAdding(false)} onAdded={invalidate} />}
    </div>
  )
}

function StatusList({ title, items, tone }) {
  if (!items?.length) return null
  const dot = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', blue: 'bg-blue-500' }[tone]
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
            <span className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddConversation({ projectId, exclude, onClose, onAdded }) {
  const api = useApi()
  const [q, setQ] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['notes', 'picker'], queryFn: () => api.get('/notes?archived=false&limit=200') })
  const add = useMutation({
    mutationFn: (noteId) => api.post(`/projects/${projectId}/notes`, { noteId }),
    onSuccess: () => { onAdded(); toast.success('Added to project') },
  })
  const term = q.trim().toLowerCase()
  const options = (data || [])
    .filter((n) => !exclude.includes(n.id))
    .filter((n) => !term || `${n.title} ${n.summary} ${(n.people || []).map((p) => p.name).join(' ')}`.toLowerCase().includes(term))
    .slice(0, 50)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex items-center gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} placeholder="Search your conversations" className="input flex-1" autoFocus />
          <button type="button" onClick={onClose} className="btn-ghost !px-3">Done</button>
        </div>
        <div className="overflow-y-auto -mx-1">
          {isLoading && <p className="px-3 py-2 text-sm text-neutral-400">Loading…</p>}
          {!isLoading && options.length === 0 && <p className="px-3 py-2 text-sm text-neutral-400">No matching conversations.</p>}
          {options.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => add.mutate(n.id)}
              disabled={add.isPending && add.variables === n.id}
              className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">{n.title || 'Untitled'}</p>
              <p className="text-xs text-neutral-400">{formatRelativeDate(n.recordedAt)}{n.people?.length ? ` · ${n.people.map((p) => p.name).slice(0, 3).join(', ')}` : ''}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function MenuItem({ onClick, danger, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-200'}`}
    >
      {children}
    </button>
  )
}
