import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { useState } from 'react'
import CommitmentRow from '@/components/CommitmentRow'
import AddToCalendarSheet from '@/components/AddToCalendarSheet'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Done' },
  { value: 'overdue', label: 'Overdue' },
]

const OWNER_FILTERS = [
  { value: '', label: 'Anyone' },
  { value: 'me', label: 'You' },
  { value: 'them', label: 'Them' },
]

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Newest' },
  { value: 'dueDate', label: 'Due Date' },
]

export default function Commitments() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [calendarCommitment, setCalendarCommitment] = useState(null)

  const params = new URLSearchParams()
  if (statusFilter) params.set('status', statusFilter)
  if (ownerFilter) params.set('owner', ownerFilter)
  if (sortBy) params.set('sort', sortBy)
  const queryString = params.toString()

  const { data: commitments, isLoading } = useQuery({
    queryKey: ['commitments', statusFilter, ownerFilter, sortBy],
    queryFn: () => api.get(`/commitments${queryString ? `?${queryString}` : ''}`),
  })

  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) =>
      api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  const total = commitments?.length ?? 0
  const openCount = commitments?.filter((c) => c.status === 'open').length ?? 0
  const overdueCount = commitments?.filter((c) => c.status === 'overdue').length ?? 0

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-12">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Commitments</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-3 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-xl font-bold text-neutral-900 dark:text-white">{total}</p>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 uppercase tracking-wide font-semibold">Total</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-3 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-xl font-bold text-blue-500">{openCount}</p>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 uppercase tracking-wide font-semibold">Open</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-3 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-xl font-bold text-red-500">{overdueCount}</p>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 uppercase tracking-wide font-semibold">Overdue</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Status */}
          <div className="flex gap-1 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === f.value
                    ? 'bg-blue-500 text-white'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Owner */}
          <div className="flex gap-1 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-0.5">
            {OWNER_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setOwnerFilter(f.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  ownerFilter === f.value
                    ? 'bg-blue-500 text-white'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="flex gap-1 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-0.5 ml-auto">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSortBy(s.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  sortBy === s.value
                    ? 'bg-blue-500 text-white'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : commitments?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">No commitments</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
              {statusFilter ? 'Try changing your filters' : 'Commitments from your conversations will appear here'}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
            {commitments.map((c) => (
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
        )}
      </div>

      <AddToCalendarSheet
        open={!!calendarCommitment}
        commitment={calendarCommitment}
        onClose={() => setCalendarCommitment(null)}
        onAdded={() => {
          if (calendarCommitment) {
            api.patch(`/commitments/${calendarCommitment.id}`, { addedToCalendar: true })
              .then(() => queryClient.invalidateQueries({ queryKey: ['commitments'] }))
              .catch(() => {})
          }
          setCalendarCommitment(null)
        }}
      />
    </div>
  )
}
