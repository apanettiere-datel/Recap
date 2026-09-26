import { useState, useEffect } from 'react'

function formatGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function generateICS(title, description, startDate, endDate) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Recap//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(startDate)}`,
    `DTEND:${fmt(endDate)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

function downloadICS(title, description, startDate, endDate) {
  const ics = generateICS(title, description, startDate, endDate)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function openGoogleCalendar(title, description, startDate, endDate) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description,
    dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
  })
  window.open(`https://calendar.google.com/calendar/event?${params}`, '_blank')
}

function getQuickDate(label) {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  if (label === 'Tomorrow') {
    d.setDate(d.getDate() + 1)
  } else if (label === 'This Friday') {
    const day = d.getDay()
    const diff = day <= 5 ? 5 - day : 6
    d.setDate(d.getDate() + diff)
  } else if (label === 'Next Week') {
    const day = d.getDay()
    const diff = day === 0 ? 1 : 8 - day
    d.setDate(d.getDate() + diff)
  }
  return d
}

function formatSheetDate(date) {
  if (!date) return 'No date'
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toLocalDatetimeStr(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

export default function AddToCalendarSheet({ open, commitment, onClose, onAdded }) {
  const [selectedDate, setSelectedDate] = useState(null)
  const [showProviders, setShowProviders] = useState(false)

  // Reset the picker whenever the sheet opens or targets a different commitment
  const [synced, setSynced] = useState({ open, commitment })
  if (synced.open !== open || synced.commitment !== commitment) {
    setSynced({ open, commitment })
    if (open) setSelectedDate(commitment?.dueDate ? new Date(commitment.dueDate) : null)
    setShowProviders(false)
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || !commitment) return null

  const displayDate = selectedDate ? formatSheetDate(selectedDate) : 'No date'

  const handleQuickDate = (label) => {
    setSelectedDate(getQuickDate(label))
  }

  const handleDateInputChange = (e) => {
    const val = e.target.value
    if (val) setSelectedDate(new Date(val))
  }

  const handleAddToCalendar = () => {
    if (!selectedDate) return
    setShowProviders(true)
  }

  const handleProvider = (provider) => {
    const endDate = new Date(selectedDate.getTime() + 30 * 60000)
    const title = commitment.description
    const desc = `Recap commitment${commitment.owner ? ` (${commitment.owner})` : ''}`

    if (provider === 'google') {
      openGoogleCalendar(title, desc, selectedDate, endDate)
    } else {
      downloadICS(title, desc, selectedDate, endDate)
    }

    setShowProviders(false)
    if (onAdded) onAdded()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', animation: 'fadeIn 200ms ease' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm"
        style={{ animation: 'slideUp 280ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        {/* Grab handle (mobile only) */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <div className="w-9 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        </div>

        <div className="px-6 pb-6 pt-3 sm:pt-5">
          {/* Commitment description */}
          <h2 className="text-[17px] font-semibold text-neutral-900 dark:text-white text-center tracking-tight leading-snug">
            {commitment.description}
          </h2>

          {/* When label */}
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400 text-center mt-1.5">
            When
          </p>

          {/* Date display */}
          <div className="mt-2 px-3.5 py-3 rounded-xl bg-blue-500/[0.06] dark:bg-blue-500/10 text-center">
            <span className="text-[17px] font-medium text-blue-500 dark:text-blue-400 tracking-tight">
              {displayDate}
            </span>
          </div>

          {/* Quick date pills */}
          <div className="flex gap-2 mt-4 justify-center flex-wrap">
            {['Tomorrow', 'This Friday', 'Next Week'].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => handleQuickDate(label)}
                className="px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date & time picker */}
          <div className="mt-3">
            <input
              type="datetime-local"
              value={toLocalDatetimeStr(selectedDate)}
              onChange={handleDateInputChange}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>

          {showProviders ? (
            /* Provider selection */
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => handleProvider('google')}
                className="h-[50px] rounded-[14px] bg-blue-500 text-white flex items-center justify-center gap-2 text-[17px] font-semibold tracking-tight hover:bg-blue-600 active:opacity-85 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Google Calendar
              </button>
              <button
                type="button"
                onClick={() => handleProvider('apple')}
                className="h-[46px] rounded-[14px] border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white flex items-center justify-center gap-2 text-[15px] font-semibold tracking-tight hover:bg-neutral-50 dark:hover:bg-neutral-800 active:opacity-70 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Apple Calendar (.ics)
              </button>
            </div>
          ) : (
            /* Add to Calendar + Reminder buttons */
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleAddToCalendar}
                disabled={!selectedDate}
                className="h-[50px] rounded-[14px] bg-blue-500 text-white flex items-center justify-center gap-2 text-[17px] font-semibold tracking-tight hover:bg-blue-600 active:opacity-85 transition-all disabled:opacity-40"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                </svg>
                Add to Calendar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onAdded) onAdded()
                  onClose()
                }}
                className="h-[46px] rounded-[14px] border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white flex items-center justify-center text-[15px] font-semibold tracking-tight hover:bg-neutral-50 dark:hover:bg-neutral-800 active:opacity-70 transition-all"
              >
                Add as Reminder Instead
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
