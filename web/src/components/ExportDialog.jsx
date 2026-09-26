import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { downloadBlob } from '@/lib/uploadRecording'

const FORMATS = [
  { value: 'pdf', label: 'PDF', hint: 'For reading and printing' },
  { value: 'docx', label: 'Word', hint: 'Editable document' },
  { value: 'md', label: 'Markdown', hint: 'Notion, Obsidian, text editors' },
]

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Download a conversation, copy it, or send it to Todoist / Notion. */
export default function ExportDialog({ note, onClose }) {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [format, setFormat] = useState('pdf')
  const [withTranscript, setWithTranscript] = useState(false)
  const hasTranscript = !!note.transcript?.trim()
  const openItems = (note.commitments || []).filter((c) => c.status !== 'completed')
  const unsent = openItems.filter((c) => !c.todoistTaskId)

  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api.get('/integrations') })
  const exportPath = (fmt) => `/notes/${note.id}/export?format=${fmt}&transcript=${withTranscript ? 1 : 0}&tz=${encodeURIComponent(browserTimezone())}`

  const download = useMutation({
    mutationFn: () => api.file(exportPath(format)),
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      toast.success('Downloaded')
    },
  })

  const copy = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const { blob } = await api.file(exportPath('md'))
      await navigator.clipboard.writeText(await blob.text())
    },
    onSuccess: () => toast.success('Copied as Markdown — paste it into Notion, a doc or an email'),
    onError: () => toast.error("Couldn't copy. Try downloading the Markdown file instead."),
  })

  const todoist = useMutation({
    mutationFn: () => api.post(`/integrations/todoist/notes/${note.id}`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['note', note.id] })
      toast.success(r.sent ? `Sent ${r.sent} action item${r.sent === 1 ? '' : 's'} to Todoist` : 'Everything was already in Todoist')
    },
  })

  const notion = useMutation({
    mutationFn: () => api.post(`/integrations/notion/notes/${note.id}`, { transcript: withTranscript }, { timeout: 60000 }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['note', note.id] })
      toast.success('Saved to Notion', { action: { label: 'Open', onClick: () => window.open(r.url, '_blank', 'noopener') } })
    },
  })

  const connected = integrations.data || {}

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 animate-[fadeIn_.15s_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Export</h2>
          <button type="button" onClick={onClose} className="icon-btn !w-8 !h-8" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              onClick={() => setFormat(f.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                format === f.value
                  ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
              }`}
            >
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">{f.label}</p>
              <p className="text-[11px] text-neutral-500 leading-tight mt-0.5">{f.hint}</p>
            </button>
          ))}
        </div>

        <label className={`flex items-center gap-3 px-1 py-2 ${hasTranscript ? 'cursor-pointer' : 'opacity-50'}`}>
          <input type="checkbox" checked={withTranscript && hasTranscript} disabled={!hasTranscript} onChange={(e) => setWithTranscript(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">Include the full transcript</span>
        </label>

        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => download.mutate()} disabled={download.isPending} className="btn-primary flex-1">
            {download.isPending ? 'Preparing…' : `Download ${FORMATS.find((f) => f.value === format).label}`}
          </button>
          <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending} className="btn-secondary !px-4" title="Copy as Markdown">
            {copy.isPending ? 'Copying…' : 'Copy'}
          </button>
        </div>

        <h3 className="section-label mt-7 mb-2">Send to</h3>
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
          <Row
            icon={<span className="w-8 h-8 rounded-lg bg-red-500 text-white flex items-center justify-center text-sm font-bold">✓</span>}
            title="Todoist"
            subtitle={
              !connected.todoist?.connected
                ? 'Send your action items as tasks'
                : openItems.length === 0
                  ? 'No open action items in this conversation'
                  : unsent.length === 0
                    ? 'All open action items are already in Todoist'
                    : `Send ${unsent.length} open action item${unsent.length === 1 ? '' : 's'} as tasks`
            }
            action={
              connected.todoist?.connected ? (
                <button type="button" onClick={() => todoist.mutate()} disabled={todoist.isPending || unsent.length === 0} className="text-sm font-semibold text-blue-600 dark:text-blue-400 disabled:opacity-40">
                  {todoist.isPending ? 'Sending…' : 'Send'}
                </button>
              ) : (
                <button type="button" onClick={() => navigate('/settings#integrations')} className="text-sm font-semibold text-neutral-500 hover:text-blue-600">Connect</button>
              )
            }
          />
          <Row
            icon={<span className="w-8 h-8 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center text-sm font-bold">N</span>}
            title="Notion"
            subtitle={
              connected.notion?.connected
                ? note.notionPageUrl ? 'Saved before — saving again creates a new page' : `As a page under “${connected.notion.pageTitle || 'your page'}”`
                : 'Save the conversation as a Notion page'
            }
            action={
              connected.notion?.connected ? (
                <div className="flex items-center gap-3">
                  {note.notionPageUrl && <a href={note.notionPageUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-neutral-500 hover:text-blue-600">Open</a>}
                  <button type="button" onClick={() => notion.mutate()} disabled={notion.isPending} className="text-sm font-semibold text-blue-600 dark:text-blue-400 disabled:opacity-40">
                    {notion.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => navigate('/settings#integrations')} className="text-sm font-semibold text-neutral-500 hover:text-blue-600">Connect</button>
              )
            }
          />
        </div>
      </div>
    </div>
  )
}

function Row({ icon, title, subtitle, action }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">{title}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}
