import { termsRegExp } from './searchTerms'

/** Renders `text` with every occurrence of `terms` wrapped in <mark>. */
export function Highlight({ text, terms, className = '' }) {
  const re = termsRegExp(terms || [])
  if (!text || !re) return text || null
  const parts = String(text).split(re)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className={`bg-yellow-300/70 dark:bg-yellow-400/40 text-inherit rounded-sm px-0.5 -mx-0.5 ${className}`}>{part}</mark>
      : part,
  )
}
