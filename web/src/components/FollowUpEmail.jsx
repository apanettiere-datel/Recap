import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'

const TONES = ['Friendly', 'Formal', 'Brief']

/** AI-drafted follow-up email for a conversation, editable, then copy or open in the mail app. */
export default function FollowUpEmail({ noteId, onClose }) {
  const api = useApi()
  const [tone, setTone] = useState('Friendly')
  const [draft, setDraft] = useState(null) // { to, subject, body }

  // Plain state (not useMutation): the draft starts from an effect, which a mutation
  // observer can miss under React StrictMode
  const [status, setStatus] = useState('pending') // pending | error | done
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const fetchDraft = useCallback(
    (t) => api.post(`/notes/${noteId}/follow-up`, { tone: t.toLowerCase() }, { timeout: 60000 }),
    [api, noteId],
  )

  // Apply a result unless a newer request has started since
  const settle = useCallback((req, r, err) => {
    if (req !== requestRef.current) return
    if (err) {
      setError(err)
      setStatus('error')
      return
    }
    setDraft({
      to: (r.to || []).map((p) => p.email).join(', '),
      subject: r.subject,
      body: r.body,
      missing: r.missingEmails || [],
    })
    setStatus('done')
  }, [])

  const generate = (t) => {
    const req = ++requestRef.current
    setStatus('pending')
    setError(null)
    fetchDraft(t).then((r) => settle(req, r), (err) => settle(req, null, err))
  }

  // Draft immediately on open
  useEffect(() => {
    const req = ++requestRef.current
    fetchDraft('Friendly').then((r) => settle(req, r), (err) => settle(req, null, err))
  }, [fetchDraft, settle])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
      toast.success('Email copied')
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.")
    }
  }

  const mailto = draft
    ? `mailto:${encodeURIComponent(draft.to).replace(/%2C/g, ',').replace(/%40/g, '@')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : '#'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 animate-[fadeIn_.15s_ease-out]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Follow-up email</h2>
          <button type="button" onClick={onClose} className="icon-btn !w-8 !h-8" aria-label="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 flex gap-2 mb-3">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTone(t); generate(t) }}
              disabled={status === 'pending'}
              className={`chip !py-1 ${tone === t ? 'chip-active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="px-5 overflow-y-auto flex-1">
          {status === 'pending' ? (
            <div className="py-10 flex flex-col items-center gap-3 text-sm text-neutral-500">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Drafting from your conversation…
            </div>
          ) : status === 'error' ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-500 mb-3">{error?.message || "Couldn't draft the email."}</p>
              <button type="button" onClick={() => generate(tone)} className="btn-secondary">Try again</button>
            </div>
          ) : draft ? (
            <div className="space-y-3 pb-2">
              <label className="block">
                <span className="text-xs font-medium text-neutral-500">To</span>
                <input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="name@example.com" className="input mt-1" />
              </label>
              {draft.missing.length > 0 && (
                <p className="text-xs text-neutral-500 -mt-1">
                  No email saved for {draft.missing.map((p) => p.name).join(', ')} — add one on their profile to fill this in automatically.
                </p>
              )}
              <label className="block">
                <span className="text-xs font-medium text-neutral-500">Subject</span>
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-500">Message</span>
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={11} className="input mt-1 resize-y leading-relaxed" />
              </label>
            </div>
          ) : null}
        </div>

        {draft && status === 'done' && (
          <div className="flex gap-2 justify-end px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
            <button type="button" onClick={copy} className="btn-ghost">Copy</button>
            <a href={mailto} className="btn-primary">Open in email app</a>
          </div>
        )}
      </div>
    </div>
  )
}
