import { useState } from 'react'

function dueRel(date) {
  if (!date) return null
  const d = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target - today) / 86400000)
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function toLocalDatetimeStr(date) {
  if (!date) return ''
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

export default function CommitmentRow({ commitment, onToggle, onAddCal, onUpdateDueDate, compact = false }) {
  const done = commitment.status === 'completed'
  const overdue = commitment.status === 'overdue'
  const due = dueRel(commitment.dueDate)
  const [editingDate, setEditingDate] = useState(false)

  return (
    <div className={`flex items-start gap-3 ${compact ? 'py-2.5 px-1' : 'py-3 px-1'}`}>
      {/* Circle / Check toggle */}
      <button
        type="button"
        onClick={() => onToggle && onToggle(commitment.id)}
        className="mt-0.5 p-0.5 flex-shrink-0"
      >
        {done ? (
          <svg className="w-[22px] h-[22px] text-green-500" viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-[22px] h-[22px] text-neutral-300 dark:text-neutral-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="12" cy="12" r="9.75" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-[15px] font-semibold tracking-tight leading-tight ${
            done
              ? 'line-through opacity-55 text-neutral-900 dark:text-white'
              : 'text-neutral-900 dark:text-white'
          }`}
        >
          {commitment.description}
        </p>

        {/* Pills + due date */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {commitment.owner && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-tight ${
                commitment.owner === 'me'
                  ? 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400'
                  : 'bg-orange-500/10 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400'
              }`}
            >
              {commitment.owner === 'me' ? 'You' : 'Them'}
            </span>
          )}
          {commitment.person && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-tight bg-purple-500/10 text-purple-500 dark:bg-purple-500/20 dark:text-purple-400">
              {commitment.person.name || commitment.person}
            </span>
          )}
          {editingDate ? (
            <input
              type="datetime-local"
              defaultValue={toLocalDatetimeStr(commitment.dueDate)}
              autoFocus
              onBlur={(e) => {
                const val = e.target.value
                if (onUpdateDueDate && val) {
                  onUpdateDueDate(commitment.id, new Date(val).toISOString())
                }
                setEditingDate(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.target.blur()
                } else if (e.key === 'Escape') {
                  setEditingDate(false)
                }
              }}
              className="text-xs px-2 py-0.5 rounded-lg border border-blue-500 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none"
            />
          ) : due ? (
            <button
              type="button"
              onClick={() => onUpdateDueDate && setEditingDate(true)}
              className={`inline-flex items-center gap-1 text-xs ${
                overdue
                  ? 'text-red-500 font-semibold'
                  : 'text-neutral-500 dark:text-neutral-400 font-medium'
              } hover:text-blue-500 dark:hover:text-blue-400 transition-colors`}
            >
              {due}
              {onUpdateDueDate && (
                <svg className="w-3 h-3 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
              )}
            </button>
          ) : onUpdateDueDate ? (
            <button
              type="button"
              onClick={() => setEditingDate(true)}
              className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors font-medium"
            >
              + Add date
            </button>
          ) : null}
        </div>
      </div>

      {/* Calendar icon */}
      {onAddCal && !done && (
        <button
          type="button"
          onClick={() => onAddCal(commitment)}
          className="p-2 -mt-1 flex-shrink-0"
        >
          {commitment.addedToCalendar ? (
            <svg className="w-[22px] h-[22px] text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15l2.25 2.25L15.75 12" />
            </svg>
          ) : (
            <svg className="w-[22px] h-[22px] text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75v3m0 0v-3m0 3h3m-3 0H9" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}
