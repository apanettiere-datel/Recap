import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'

function when(start) {
  const d = new Date(start)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const mins = Math.round((d - now) / 60000)
  if (mins <= 0) return `Now · ${time}`
  if (mins < 60) return `In ${mins} min · ${time}`
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay) return `Today · ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`
  return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** Next meetings from the connected calendar, with prep and record shortcuts. */
export default function UpcomingMeetings() {
  const api = useApi()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['upcoming-meetings'],
    queryFn: () => api.get('/calendar/upcoming?days=2'),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
    meta: { silent: true },
  })
  const meetings = (data || []).slice(0, 3)
  if (meetings.length === 0) return null

  return (
    <section className="pt-5">
      <h2 className="section-label mb-2">Coming up</h2>
      <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
        {meetings.map((m) => {
          const known = m.people.find((p) => p.conversations > 0)
          return (
            <div key={m.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-1 self-stretch rounded-full bg-blue-500/60" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate">{m.title || 'Meeting'}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {when(m.startsAt)}
                  {m.attendees.length > 0 && ` · ${m.attendees.slice(0, 3).map((a) => a.name.split(' ')[0]).join(', ')}${m.attendees.length > 3 ? ` +${m.attendees.length - 3}` : ''}`}
                </p>
              </div>
              {known && (
                <button type="button" onClick={() => navigate(`/briefing/${known.id}`)} className="chip !py-1 !text-xs" title={`Prep with ${known.name}`}>
                  Prep
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(`/recording${m.people[0] ? `?personId=${m.people[0].id}` : ''}`)}
                className="chip !py-1 !text-xs !text-red-600 dark:!text-red-400"
              >
                ● Record
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
