import { useState } from 'react'

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

export default function CalendarButtons({ commitment, onAdded }) {
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [selectedDate, setSelectedDate] = useState('')
  const [showMenu, setShowMenu] = useState(false)

  if (commitment.addedToCalendar) {
    return (
      <span className="text-xs text-green-500 flex-shrink-0 flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        In calendar
      </span>
    )
  }

  const handleAddToCalendar = (provider) => {
    const dueDate = commitment.dueDate
      ? new Date(commitment.dueDate)
      : selectedDate
        ? new Date(selectedDate + 'T09:00:00')
        : null

    if (!dueDate) {
      setShowDatePicker(true)
      setShowMenu(false)
      return
    }

    const endDate = new Date(dueDate.getTime() + 30 * 60000)
    const title = commitment.description
    const desc = `Recap commitment${commitment.owner ? ` (${commitment.owner})` : ''}`

    if (provider === 'google') {
      openGoogleCalendar(title, desc, dueDate, endDate)
    } else {
      downloadICS(title, desc, dueDate, endDate)
    }

    setShowMenu(false)
    setShowDatePicker(false)
    if (onAdded) onAdded()
  }

  const handleDateConfirm = () => {
    if (!selectedDate) return
    setShowDatePicker(false)
    setShowMenu(true)
  }

  if (showDatePicker) {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          className="text-xs px-2 py-1 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={handleDateConfirm}
          disabled={!selectedDate}
          className="text-xs text-blue-500 font-medium disabled:opacity-40"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => { setShowDatePicker(false); setSelectedDate('') }}
          className="text-xs text-neutral-400"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (showMenu) {
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => handleAddToCalendar('google')}
          className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-500 font-medium hover:bg-blue-500/20 transition-colors"
        >
          Google
        </button>
        <button
          type="button"
          onClick={() => handleAddToCalendar('apple')}
          className="text-xs px-2 py-1 rounded-lg bg-neutral-500/10 text-neutral-600 dark:text-neutral-300 font-medium hover:bg-neutral-500/20 transition-colors"
        >
          Apple
        </button>
        <button
          type="button"
          onClick={() => { setShowMenu(false); setSelectedDate('') }}
          className="text-xs text-neutral-400 ml-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (commitment.dueDate || selectedDate) {
          setShowMenu(true)
        } else {
          setShowDatePicker(true)
        }
      }}
      className="text-neutral-400 hover:text-blue-500 transition-colors flex-shrink-0"
      title="Add to calendar"
    >
      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
      </svg>
    </button>
  )
}
