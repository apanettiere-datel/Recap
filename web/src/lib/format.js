export function formatRelativeDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000 && isSameDay(d, new Date())) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

export function formatFullDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Section label for grouping a feed by day. */
export function dayGroupLabel(dateStr) {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(d, today)) return 'Today'
  if (isSameDay(d, yesterday)) return 'Yesterday'
  const diffDays = (today - d) / 86400000
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

/** 83 -> "1:23", 3723 -> "1:02:03" */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? m.toString().padStart(2, '0') : m.toString()
  return `${h > 0 ? `${h}:` : ''}${mm}:${sec.toString().padStart(2, '0')}`
}

/** 83 -> "1 min", 3723 -> "1 hr 2 min" */
export function formatDuration(seconds) {
  if (!seconds || seconds < 1) return ''
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500',
  'bg-orange-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-rose-500',
]

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

export function colorForName(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function sentimentColor(sentiment) {
  switch (sentiment) {
    case 'positive':
    case 'excited':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'negative':
    case 'tense':
      return 'bg-red-500/15 text-red-600 dark:text-red-400'
    case 'mixed':
    case 'cautious':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-neutral-500/15 text-neutral-500 dark:text-neutral-400'
  }
}
