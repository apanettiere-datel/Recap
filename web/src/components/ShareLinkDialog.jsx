import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { formatRelativeDate } from '@/lib/format'

/** Create and manage read-only public links to one conversation. */
export default function ShareLinkDialog({ noteId, hasAudio, onClose }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [includeAudio, setIncludeAudio] = useState(false)
  const [includeTranscript, setIncludeTranscript] = useState(false)

  const links = useQuery({
    queryKey: ['shares', noteId],
    queryFn: () => api.get(`/notes/${noteId}/shares`),
  })

  const create = useMutation({
    mutationFn: () => api.post(`/notes/${noteId}/shares`, { includeAudio, includeTranscript }),
    onSuccess: async (share) => {
      queryClient.invalidateQueries({ queryKey: ['shares', noteId] })
      await copy(share.url)
    },
  })

  const revoke = useMutation({
    mutationFn: (shareId) => api.del(`/notes/${noteId}/shares/${shareId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares', noteId] })
      toast.info('Link turned off. Anyone who has it can no longer open it.')
    },
  })

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 animate-[fadeIn_.15s_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Share a link</h2>
          <button type="button" onClick={onClose} className="icon-btn !w-8 !h-8" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          Anyone with the link can view the summary, action items and key quotes — no account needed. You can turn a link off at any time.
        </p>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 mb-4">
          <Toggle
            label="Include audio"
            hint={hasAudio ? 'Let them listen to the recording' : 'This conversation has no audio'}
            checked={includeAudio && hasAudio}
            disabled={!hasAudio}
            onChange={setIncludeAudio}
          />
          <Toggle
            label="Include full transcript"
            hint="With speaker names and timestamps"
            checked={includeTranscript}
            onChange={setIncludeTranscript}
          />
        </div>

        <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="btn-primary w-full">
          {create.isPending ? 'Creating…' : 'Create link and copy'}
        </button>

        {links.data?.length > 0 && (
          <div className="mt-6">
            <h3 className="section-label mb-2">Active links</h3>
            <div className="space-y-2">
              {links.data.map((s) => (
                <div key={s.id} className="rounded-xl bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 truncate text-xs font-mono text-neutral-600 dark:text-neutral-300">{s.url}</p>
                    <button type="button" onClick={() => copy(s.url)} className="text-xs font-semibold text-blue-600 dark:text-blue-400">Copy</button>
                    <button type="button" onClick={() => revoke.mutate(s.id)} className="text-xs font-semibold text-red-600 dark:text-red-400">Turn off</button>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-1">
                    Created {formatRelativeDate(s.createdAt)} · {s.views} view{s.views === 1 ? '' : 's'}
                    {s.includeAudio ? ' · audio' : ''}{s.includeTranscript ? ' · transcript' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }) {
  return (
    <label className={`flex items-center gap-3 px-4 py-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <div className="flex-1">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">{label}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 accent-blue-600"
      />
    </label>
  )
}
