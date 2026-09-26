import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { formatRelativeDate } from '@/lib/format'

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

function Card({ children }) {
  return <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">{children}</div>
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

/** Names, companies and jargon the transcriber should spell correctly. */
export function VocabularySettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['vocabulary'], queryFn: () => api.get('/users/me/vocabulary') })
  const terms = data?.terms ?? []

  const save = useMutation({
    mutationFn: (next) => api.put('/users/me/vocabulary', { terms: next }),
    onSuccess: (r) => queryClient.setQueryData(['vocabulary'], r),
  })

  const add = () => {
    const incoming = draft.split(/[,\n]/).map((t) => t.trim()).filter(Boolean)
    if (!incoming.length) return
    const lower = new Set(terms.map((t) => t.toLowerCase()))
    save.mutate([...terms, ...incoming.filter((t) => !lower.has(t.toLowerCase()))])
    setDraft('')
  }

  return (
    <Card>
      <div className="px-4 py-4">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">Custom vocabulary</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
          Names, companies, products and jargon that transcripts should spell correctly. People in your contacts are included automatically.
        </p>
        <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. DataGate, Rev.io, Kubernetes"
            className="input flex-1"
            aria-label="Add vocabulary terms"
          />
          <button type="submit" disabled={!draft.trim() || save.isPending} className="btn-primary !px-4">Add</button>
        </form>
        {isLoading ? (
          <div className="h-8 mt-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
        ) : terms.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-3">
            {terms.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-200">
                {t}
                <button
                  type="button"
                  onClick={() => save.mutate(terms.filter((x) => x !== t))}
                  className="p-0.5 text-neutral-400 hover:text-red-500"
                  aria-label={`Remove ${t}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-neutral-400 mt-3">Applies to new recordings. To fix an older one, open it and choose “Re-transcribe audio”.</p>
      </div>
    </Card>
  )
}

/** Morning email when things you promised are due or overdue. */
export function ReminderSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  const tz = browserTimezone()
  const { data } = useQuery({ queryKey: ['reminder-settings'], queryFn: () => api.get('/users/me/reminders') })
  const save = useMutation({
    mutationFn: (patch) => api.patch('/users/me/reminders', { ...patch, timezone: tz }),
    onSuccess: (r) => queryClient.setQueryData(['reminder-settings'], r),
  })
  if (!data) return <div className="h-24 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 animate-pulse" />

  return (
    <Card>
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-neutral-900 dark:text-white">Commitment reminders</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
            An email the morning something you promised is due, and when it becomes overdue. One reminder per item{data.email ? `, sent to ${data.email}` : ''}.
          </p>
        </div>
        <Switch label="Commitment reminders" checked={data.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ enabled: v })} />
      </div>
      <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 py-3 flex items-center gap-3">
        <span className="text-sm text-neutral-600 dark:text-neutral-300 flex-1">Send at</span>
        <select value={data.hour} onChange={(e) => save.mutate({ hour: Number(e.target.value) })} className="input !w-32 !py-1.5" aria-label="Reminder time">
          {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
        </select>
      </div>
      {!data.emailConfigured && (
        <p className="mx-4 mb-3 text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          Email delivery isn&apos;t set up on the server yet, so reminders can&apos;t be sent.
        </p>
      )}
    </Card>
  )
}

/** Connect a calendar through its private iCal link. */
export function CalendarSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [help, setHelp] = useState(false)
  const { data } = useQuery({ queryKey: ['calendar-connection'], queryFn: () => api.get('/calendar/connection') })
  const set = (r) => {
    queryClient.setQueryData(['calendar-connection'], r)
    queryClient.invalidateQueries({ queryKey: ['upcoming-meetings'] })
  }

  const connect = useMutation({
    meta: { silent: true },
    mutationFn: () => api.put('/calendar/connection', { url }, { timeout: 45000 }),
    onSuccess: (r) => { set(r); setUrl(''); toast.success(`Calendar connected — ${r.events} upcoming or recent event${r.events === 1 ? '' : 's'} found`) },
  })
  const disconnect = useMutation({ mutationFn: () => api.del('/calendar/connection'), onSuccess: set })
  const sync = useMutation({
    mutationFn: () => api.post('/calendar/sync', {}, { timeout: 45000 }),
    onSuccess: (r) => { set(r); toast.success('Calendar refreshed') },
  })
  const prefs = useMutation({ mutationFn: (patch) => api.patch('/calendar/settings', patch), onSuccess: set })

  if (!data) return <div className="h-24 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 animate-pulse" />

  return (
    <Card>
      <div className="px-4 py-4">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">Calendar</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
          Recordings are matched to your meetings (title and attendees), attendees are added to People, and you get a prep brief before meetings with people you&apos;ve talked to. Read-only.
        </p>

        {data.connected ? (
          <div className="mt-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2.5">
            <p className="text-sm text-neutral-800 dark:text-neutral-100">
              Connected <span className="text-neutral-400">· {data.source}</span>
            </p>
            <p className={`text-xs mt-0.5 ${data.error ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'}`}>
              {data.error || (data.lastSyncAt ? `Last updated ${formatRelativeDate(data.lastSyncAt)}` : 'Not synced yet')}
            </p>
            <div className="flex gap-3 mt-2">
              <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending} className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                {sync.isPending ? 'Refreshing…' : 'Refresh now'}
              </button>
              <button type="button" onClick={() => window.confirm('Disconnect your calendar?') && disconnect.mutate()} className="text-xs font-semibold text-red-600 dark:text-red-400">
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-3" onSubmit={(e) => { e.preventDefault(); if (url.trim()) connect.mutate() }}>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste your private iCal / .ics link"
                className="input flex-1"
                aria-label="Calendar iCal link"
                autoComplete="off"
              />
              <button type="submit" disabled={!url.trim() || connect.isPending} className="btn-primary !px-4">
                {connect.isPending ? 'Checking…' : 'Connect'}
              </button>
            </div>
            {connect.isError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{connect.error?.message}</p>}
            <button type="button" onClick={() => setHelp((v) => !v)} className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-2">
              {help ? 'Hide' : 'Where do I find this link?'}
            </button>
            {help && (
              <ul className="mt-2 space-y-1.5 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                <li><b>Google Calendar:</b> Settings → your calendar → Integrate calendar → “Secret address in iCal format”.</li>
                <li><b>Outlook:</b> Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.</li>
                <li><b>iCloud:</b> Calendar app → share icon next to the calendar → Public Calendar → copy link.</li>
                <li>Keep the link private — anyone who has it can see your calendar.</li>
              </ul>
            )}
          </form>
        )}
      </div>
      {data.connected && (
        <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-neutral-800 dark:text-neutral-100">Meeting prep emails</p>
            <p className="text-xs text-neutral-500">About 30 minutes before meetings with people you&apos;ve recorded</p>
          </div>
          <Switch label="Meeting prep emails" checked={data.prepBriefsEnabled} onChange={(v) => prefs.mutate({ prepBriefsEnabled: v })} />
        </div>
      )}
    </Card>
  )
}
