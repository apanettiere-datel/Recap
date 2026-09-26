import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }),
}))

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Weekly email summary: on/off, where, when, preview and send-now. */
export default function WeeklyEmailSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [emailDraft, setEmailDraft] = useState(null)
  const [preview, setPreview] = useState(null)

  const { data: settings, isLoading, isError, refetch } = useQuery({
    queryKey: ['digest-settings'],
    queryFn: () => api.get('/users/me/digest'),
  })

  const save = useMutation({
    mutationFn: (patch) => api.patch('/users/me/digest', patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['digest-settings'], data)
      setEmailDraft(null)
    },
  })

  const sendNow = useMutation({
    mutationFn: () => api.post('/users/me/digest/send', {}, { timeout: 60000 }),
    onSuccess: (r) => toast.success(`Summary sent to ${r.to}`),
  })

  const loadPreview = useMutation({
    meta: { silent: true },
    mutationFn: () => api.get('/users/me/digest/preview', { timeout: 60000 }),
    onSuccess: setPreview,
    onError: (err) => toast.error(err?.message || "Couldn't build the preview."),
  })

  if (isLoading) {
    return <div className="h-40 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 animate-pulse" />
  }
  if (isError || !settings) {
    return (
      <div className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-500">
        Couldn&apos;t load email settings. <button type="button" onClick={() => refetch()} className="text-blue-600 font-medium">Retry</button>
      </div>
    )
  }

  const email = emailDraft ?? settings.email
  const tz = browserTimezone()

  const toggle = () => {
    const next = !settings.enabled
    if (next && !email.trim()) {
      toast.error('Add your email address first.')
      return
    }
    save.mutate({ enabled: next, email: email.trim(), timezone: tz })
  }

  const saveEmail = () => {
    if (emailDraft == null || emailDraft.trim() === settings.email) return setEmailDraft(null)
    save.mutate({ email: emailDraft.trim(), timezone: tz })
  }

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-neutral-900 dark:text-white">Weekly email summary</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
            A recap of your week: conversations with links to the audio and analysis, commitments due or overdue, and people to reconnect with.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Weekly email summary"
          onClick={toggle}
          disabled={save.isPending}
          className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${settings.enabled ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 py-3 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Send to</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmailDraft(e.target.value)}
            onBlur={saveEmail}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="you@example.com"
            className="input mt-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Day</span>
            <select
              value={settings.day}
              onChange={(e) => save.mutate({ day: Number(e.target.value), timezone: tz })}
              className="input mt-1"
            >
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Time</span>
            <select
              value={settings.hour}
              onChange={(e) => save.mutate({ hour: Number(e.target.value), timezone: tz })}
              className="input mt-1"
            >
              {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-neutral-400">
          Times are in {settings.timezone}.
          {settings.timezone !== tz && (
            <> <button type="button" onClick={() => save.mutate({ timezone: tz })} className="text-blue-600 dark:text-blue-400 font-medium">Use this device&apos;s timezone ({tz})</button>.</>
          )}
          {settings.lastSentAt && ` Last sent ${new Date(settings.lastSentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`}
        </p>

        {!settings.emailConfigured && (
          <p className="text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 leading-relaxed">
            Email delivery isn&apos;t set up on the server yet, so summaries can&apos;t be sent. You can still preview them.
            The server needs <code>SMTP_URL</code> or <code>RESEND_API_KEY</code>.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => loadPreview.mutate()} disabled={loadPreview.isPending} className="btn-secondary !py-2 !px-4">
            {loadPreview.isPending ? 'Building preview…' : 'Preview this week'}
          </button>
          <button
            type="button"
            onClick={() => sendNow.mutate()}
            disabled={sendNow.isPending || !settings.emailConfigured || !email}
            className="btn-ghost !py-2 !px-4"
          >
            {sendNow.isPending ? 'Sending…' : 'Send it to me now'}
          </button>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-black/50 animate-[fadeIn_.15s_ease-out]"
          onClick={(e) => e.target === e.currentTarget && setPreview(null)}
        >
          <div className="w-full sm:max-w-2xl h-[88vh] bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-500">Subject</p>
                <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate">{preview.subject}</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="btn-ghost !px-3 !py-1.5">Close</button>
            </div>
            <iframe title="Weekly email preview" srcDoc={preview.html} sandbox="allow-popups" className="flex-1 w-full bg-[#f2f2f7]" />
          </div>
        </div>
      )}
    </div>
  )
}
