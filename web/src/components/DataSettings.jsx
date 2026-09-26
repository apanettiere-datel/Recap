import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { downloadBlob } from '@/lib/uploadRecording'

function Card({ children }) {
  return <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">{children}</div>
}

/** Todoist and Notion, connected with personal tokens. */
export function IntegrationSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['integrations'], queryFn: () => api.get('/integrations') })
  const set = (r) => queryClient.setQueryData(['integrations'], r)

  if (!data) return <div className="h-32 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 animate-pulse" />

  return (
    <Card>
      <TodoistRow connected={data.todoist.connected} onChange={set} />
      <div className="border-t border-neutral-100 dark:border-neutral-800" />
      <NotionRow notion={data.notion} onChange={set} />
    </Card>
  )
}

function TodoistRow({ connected, onChange }) {
  const api = useApi()
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const connect = useMutation({
    meta: { silent: true },
    mutationFn: () => api.put('/integrations/todoist', { token: token.trim() }),
    onSuccess: (r) => { onChange(r); setToken(''); setOpen(false); toast.success('Todoist connected') },
  })
  const disconnect = useMutation({ mutationFn: () => api.del('/integrations/todoist'), onSuccess: onChange })

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-red-500 text-white flex items-center justify-center font-bold shrink-0">✓</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900 dark:text-white">Todoist</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{connected ? 'Connected — send action items from any conversation' : 'Send action items to Todoist as tasks, with due dates'}</p>
        </div>
        {connected ? (
          <button type="button" onClick={() => disconnect.mutate()} className="text-xs font-semibold text-red-600 dark:text-red-400">Disconnect</button>
        ) : !open && (
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-blue-600 dark:text-blue-400">Connect</button>
        )}
      </div>
      {!connected && open && (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); if (token.trim()) connect.mutate() }}>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 leading-relaxed">
            In Todoist, open <b>Settings → Integrations → Developer</b> and copy your API token.
          </p>
          <div className="flex gap-2">
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token" className="input flex-1 font-mono text-sm" autoComplete="off" autoFocus />
            <button type="submit" disabled={!token.trim() || connect.isPending} className="btn-primary !px-4">{connect.isPending ? 'Checking…' : 'Connect'}</button>
          </div>
          {connect.isError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{connect.error.message}</p>}
        </form>
      )}
    </div>
  )
}

function NotionRow({ notion, onChange }) {
  const api = useApi()
  const [token, setToken] = useState('')
  const [page, setPage] = useState('')
  const [open, setOpen] = useState(false)
  const connect = useMutation({
    meta: { silent: true },
    mutationFn: () => api.put('/integrations/notion', { token: token.trim(), page: page.trim() }),
    onSuccess: (r) => { onChange(r); setToken(''); setPage(''); setOpen(false); toast.success('Notion connected') },
  })
  const disconnect = useMutation({ mutationFn: () => api.del('/integrations/notion'), onSuccess: onChange })

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center font-bold shrink-0">N</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900 dark:text-white">Notion</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {notion.connected ? `Saving conversations under “${notion.pageTitle || 'your page'}”` : 'Save conversations as Notion pages'}
          </p>
        </div>
        {notion.connected ? (
          <button type="button" onClick={() => disconnect.mutate()} className="text-xs font-semibold text-red-600 dark:text-red-400">Disconnect</button>
        ) : !open && (
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-blue-600 dark:text-blue-400">Connect</button>
        )}
      </div>
      {!notion.connected && open && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (token.trim() && page.trim()) connect.mutate() }}>
          <ol className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed list-decimal pl-4 space-y-0.5">
            <li>Go to <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">notion.so/my-integrations</a>, create an integration called “Recap”, and copy its secret.</li>
            <li>In Notion, open the page Recap should save under, choose <b>••• → Connections</b>, and add “Recap”.</li>
            <li>Paste the secret and that page&apos;s link below.</li>
          </ol>
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Integration secret (ntn_…)" className="input font-mono text-sm" autoComplete="off" autoFocus />
          <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="Link to the Notion page" className="input text-sm" autoComplete="off" />
          <div className="flex justify-end">
            <button type="submit" disabled={!token.trim() || !page.trim() || connect.isPending} className="btn-primary !px-4">{connect.isPending ? 'Checking…' : 'Connect'}</button>
          </div>
          {connect.isError && <p className="text-xs text-red-600 dark:text-red-400">{connect.error.message}</p>}
        </form>
      )}
    </div>
  )
}

const RETENTION_LABELS = { 7: '1 week', 30: '30 days', 90: '90 days', 365: '1 year' }

/** Audio retention, download everything, delete everything. */
export function PrivacySettings({ onSignOut }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['privacy'], queryFn: () => api.get('/users/me/privacy') })
  const [confirm, setConfirm] = useState(null) // 'data' | 'account'
  const [typed, setTyped] = useState('')

  const retention = useMutation({
    mutationFn: (days) => api.patch('/users/me/privacy', { audioRetentionDays: days }),
    onSuccess: (r) => {
      queryClient.setQueryData(['privacy'], r)
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success(r.audioRetentionDays ? `Audio older than ${RETENTION_LABELS[r.audioRetentionDays]} will be deleted automatically` : 'Audio will be kept')
    },
  })

  const exportAll = useMutation({
    mutationFn: () => api.file('/users/me/export', { timeout: 300000 }),
    onSuccess: ({ blob, filename }) => downloadBlob(blob, filename),
  })

  const wipe = useMutation({
    mutationFn: (kind) => api.del(`/users${kind === 'account' ? '?account=1' : ''}`, { timeout: 120000 }),
    onSuccess: (r, kind) => {
      queryClient.clear()
      if (kind === 'account') {
        toast.success('Your account and all your data were deleted.')
        if (onSignOut) onSignOut()
        else window.location.assign('/')
      } else {
        toast.success('All your data was deleted.')
        window.location.assign('/')
      }
    },
  })

  const days = data?.audioRetentionDays ?? null
  const phrase = confirm === 'account' ? 'DELETE MY ACCOUNT' : 'DELETE'

  return (
    <div className="space-y-3">
      <Card>
        <div className="px-4 py-4">
          <p className="text-sm font-medium text-neutral-900 dark:text-white">Keep audio recordings</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
            Older audio is deleted automatically. Transcripts, summaries, notes and action items are always kept.
          </p>
          <div className="flex flex-wrap gap-2 mt-3" role="radiogroup" aria-label="Keep audio for">
            {[null, ...(data?.choices ?? [7, 30, 90, 365])].map((d) => (
              <button
                key={d ?? 'forever'}
                type="button"
                role="radio"
                aria-checked={days === d}
                disabled={!data || retention.isPending}
                onClick={() => {
                  if (d === days) return
                  if (d && !window.confirm(`Delete the audio of every recording older than ${RETENTION_LABELS[d]}, now and from now on? Transcripts and summaries are kept. Deleted audio can't be recovered.`)) return
                  retention.mutate(d)
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  days === d
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400'
                }`}
              >
                {d ? RETENTION_LABELS[d] : 'Forever'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <button
          type="button"
          onClick={() => exportAll.mutate()}
          disabled={exportAll.isPending}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
        >
          <span>
            <span className="block text-sm text-neutral-900 dark:text-white">{exportAll.isPending ? 'Preparing your download…' : 'Download all my data'}</span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">Every conversation, transcript, note, person and project (ZIP)</span>
          </span>
          <svg className="w-5 h-5 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </Card>

      {confirm ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
            {confirm === 'account' ? 'Delete your account and all data?' : 'Delete all your data?'}
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3 leading-relaxed">
            Every recording, audio file, transcript, person, project and setting will be permanently deleted
            {confirm === 'account' ? ', and you will be signed out and unable to sign back in to this account.' : '. Your account stays so you can start fresh.'}
            {' '}Consider downloading your data first. This cannot be undone.
          </p>
          <label className="block text-xs text-neutral-500 mb-1" htmlFor="confirm-delete">Type <b>{phrase}</b> to confirm</label>
          <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} className="input mb-3" autoComplete="off" autoFocus />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setConfirm(null); setTyped('') }} className="btn-ghost">Cancel</button>
            <button
              type="button"
              onClick={() => wipe.mutate(confirm)}
              disabled={typed.trim().toUpperCase() !== phrase || wipe.isPending}
              className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-40"
            >
              {wipe.isPending ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setConfirm('data')} className="py-3 rounded-2xl text-red-500 text-sm font-medium hover:bg-red-500/10 transition-colors border border-neutral-200 dark:border-neutral-800">
            Delete all data
          </button>
          <button type="button" onClick={() => setConfirm('account')} className="py-3 rounded-2xl text-red-500 text-sm font-medium hover:bg-red-500/10 transition-colors border border-neutral-200 dark:border-neutral-800">
            Delete account
          </button>
        </div>
      )}
    </div>
  )
}
