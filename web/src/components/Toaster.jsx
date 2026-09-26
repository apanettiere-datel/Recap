import { useSyncExternalStore } from 'react'
import { subscribe, getToasts, toast } from '@/lib/toast'

const STYLES = {
  info: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getToasts)
  if (items.length === 0) return null
  return (
    <div
      className="fixed z-[100] left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 flex flex-col items-center gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto w-full flex items-start gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm animate-[toastIn_.2s_ease-out] ${STYLES[t.type] || STYLES.info}`}
        >
          <p className="flex-1 leading-snug">{t.message}</p>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action.onClick(); toast.dismiss(t.id) }}
              className="font-semibold underline underline-offset-2 shrink-0"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100 shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
