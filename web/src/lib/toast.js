// A tiny global toast store so non-React code (e.g. the QueryClient) can raise toasts too.
let toasts = []
let nextId = 1
const listeners = new Set()

function emit() {
  for (const l of listeners) l()
}

function dismiss(id) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function show(message, { type = 'info', duration = 4000, action } = {}) {
  if (!message) return
  // Collapse duplicates (e.g. several queries failing with the same network error)
  const dup = toasts.find((t) => t.message === message && t.type === type)
  if (dup) return dup.id
  const id = nextId++
  toasts = [...toasts.slice(-3), { id, message, type, action }]
  emit()
  if (duration > 0) setTimeout(() => dismiss(id), duration)
  return id
}

export const toast = {
  show,
  info: (m, o) => show(m, { ...o, type: 'info' }),
  success: (m, o) => show(m, { ...o, type: 'success' }),
  error: (m, o) => show(m, { duration: 6000, ...o, type: 'error' }),
  dismiss,
}

export function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getToasts() {
  return toasts
}
