import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { useState } from 'react'
import CommitmentRow from '@/components/CommitmentRow'
import AddToCalendarSheet from '@/components/AddToCalendarSheet'

export default function DailyBriefing() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [calendarCommitment, setCalendarCommitment] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['briefing', 'daily'],
    queryFn: () => api.get('/briefing/daily'),
  })

  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) =>
      api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing'] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load briefing</p>
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500 text-sm font-medium">Go back</button>
        </div>
      </div>
    )
  }

  const { today, overdue, dueSoon, open, staleContacts, summary } = data

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-12">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Title */}
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-white tracking-tight">Today</h1>
        <p className="text-[15px] text-neutral-500 dark:text-neutral-400 mt-1">{today}</p>

        {/* Morning brief card */}
        <div className="mt-6 p-4 rounded-2xl bg-blue-500/[0.06] dark:bg-blue-500/10">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            <span className="text-[15px] font-semibold text-blue-500">Morning brief</span>
          </div>
          <p className="text-[15px] text-neutral-800 dark:text-neutral-200 leading-relaxed">
            You have{' '}
            {summary.totalOverdue > 0 && (
              <><strong className="text-red-500">{summary.totalOverdue} overdue</strong> and{' '}</>
            )}
            <strong>{summary.totalOpen} open</strong> commitments
            {summary.totalDueSoon > 0 && (
              <>, <strong className="text-orange-500">{summary.totalDueSoon} due soon</strong></>
            )}
            .
            {staleContacts.length > 0 && (
              <> You haven&apos;t talked to <strong>{staleContacts[0].name}</strong> in {staleContacts[0].daysSinceContact} days.</>
            )}
          </p>
        </div>

        {/* Overdue */}
        {overdue.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-red-500 uppercase tracking-wider mb-3">
              Overdue
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {overdue.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={{ ...c, status: 'overdue' }}
                  onToggle={() =>
                    toggleCommitment.mutate({ commitmentId: c.id, status: 'completed' })
                  }
                  onAddCal={(commitment) => setCalendarCommitment(commitment)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Due Soon */}
        {dueSoon.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-orange-500 uppercase tracking-wider mb-3">
              Due Soon
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {dueSoon.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onToggle={() =>
                    toggleCommitment.mutate({
                      commitmentId: c.id,
                      status: c.status === 'completed' ? 'open' : 'completed',
                    })
                  }
                  onAddCal={(commitment) => setCalendarCommitment(commitment)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Open Commitments */}
        {open.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Open Commitments
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {open.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onToggle={() =>
                    toggleCommitment.mutate({
                      commitmentId: c.id,
                      status: c.status === 'completed' ? 'open' : 'completed',
                    })
                  }
                  onAddCal={(commitment) => setCalendarCommitment(commitment)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Stale Contacts */}
        {staleContacts.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Reconnect
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {staleContacts.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => navigate(`/person/${person.id}`)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">{person.name}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      {person.relationship && <span>{person.relationship} &middot; </span>}
                      Last contact {person.daysSinceContact} days ago
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-neutral-300 dark:text-neutral-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* All clear */}
        {overdue.length === 0 && dueSoon.length === 0 && open.length === 0 && staleContacts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">All clear</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">No commitments due. Enjoy your day.</p>
          </div>
        )}
      </div>

      <AddToCalendarSheet
        open={!!calendarCommitment}
        commitment={calendarCommitment}
        onClose={() => setCalendarCommitment(null)}
        onAdded={() => {
          if (calendarCommitment) {
            api.patch(`/commitments/${calendarCommitment.id}`, { addedToCalendar: true })
              .then(() => queryClient.invalidateQueries({ queryKey: ['briefing'] }))
              .catch(() => {})
          }
          setCalendarCommitment(null)
        }}
      />
    </div>
  )
}
