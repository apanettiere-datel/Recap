import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTerms, termsRegExp } from '@/lib/searchTerms'
import { toast } from '@/lib/toast'
import { downloadBlob } from '@/lib/uploadRecording'

/** Break a Whisper transcript (one long run of text) into readable paragraphs. */
function toParagraphs(text) {
  const explicit = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (explicit.length > 1) return explicit
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]
  const paragraphs = []
  let current = ''
  let count = 0
  for (const s of sentences) {
    current += s
    count++
    if (count >= 4 || current.length > 600) {
      paragraphs.push(current.trim())
      current = ''
      count = 0
    }
  }
  if (current.trim()) paragraphs.push(current.trim())
  return paragraphs
}

/**
 * Full transcript with find-in-transcript: highlights every match, shows a count,
 * and steps between matches. `initialQuery` pre-fills it (e.g. arriving from search).
 */
export default function TranscriptViewer({ transcript, title, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const containerRef = useRef(null)

  const paragraphs = useMemo(() => toParagraphs(transcript || ''), [transcript])
  const terms = useMemo(() => parseTerms(query), [query])
  const re = useMemo(() => termsRegExp(terms), [terms])

  // Split each paragraph into text/match segments, numbering matches across the transcript
  const { rendered, matchCount } = useMemo(() => {
    let n = 0
    const out = paragraphs.map((p) => {
      if (!re) return [p]
      return p.split(re).map((part, i) => (i % 2 === 1 ? { match: part, index: n++ } : part))
    })
    return { rendered: out, matchCount: n }
  }, [paragraphs, re])

  const current = matchCount ? Math.min(active, matchCount - 1) : 0

  useEffect(() => {
    if (!matchCount) return
    const el = containerRef.current?.querySelector(`[data-match="${current}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current, matchCount, terms])

  const step = (dir) => {
    if (!matchCount) return
    setActive((a) => (Math.min(a, matchCount - 1) + dir + matchCount) % matchCount)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcript)
      toast.success('Transcript copied')
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.")
    }
  }

  const download = () => {
    const safe = (title || 'transcript').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'transcript'
    downloadBlob(new Blob([transcript], { type: 'text/plain;charset=utf-8' }), `${safe}.txt`)
  }

  const words = useMemo(() => (transcript.match(/\S+/g) || []).length, [transcript])

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-clip">
      <div className="sticky top-[57px] z-[5] rounded-t-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-neutral-100 dark:border-neutral-800 p-2 flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Find in transcript"
            aria-label="Find in transcript"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        {terms.length > 0 && (
          <>
            <span className="text-xs text-neutral-500 tabular-nums whitespace-nowrap min-w-[3.5rem] text-center">
              {matchCount ? `${current + 1} / ${matchCount}` : 'No matches'}
            </span>
            <IconButton label="Previous match" onClick={() => step(-1)} disabled={!matchCount}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </IconButton>
            <IconButton label="Next match" onClick={() => step(1)} disabled={!matchCount}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </IconButton>
          </>
        )}
        <IconButton label="Copy transcript" onClick={copy}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </IconButton>
        <IconButton label="Download transcript" onClick={download}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </IconButton>
      </div>

      <div ref={containerRef} className="p-4 space-y-4 text-[15px] text-neutral-700 dark:text-neutral-300 leading-relaxed">
        {rendered.map((segments, pi) => (
          <p key={pi}>
            {segments.map((seg, si) =>
              typeof seg === 'string' ? seg : (
                <mark
                  key={si}
                  data-match={seg.index}
                  className={`rounded-sm px-0.5 -mx-0.5 text-inherit ${
                    seg.index === current ? 'bg-orange-400/80 dark:bg-orange-500/60' : 'bg-yellow-300/70 dark:bg-yellow-400/35'
                  }`}
                >
                  {seg.match}
                </mark>
              ),
            )}
          </p>
        ))}
      </div>
      <div className="px-4 pb-3 text-xs text-neutral-400">{words.toLocaleString()} words</div>
    </div>
  )
}

function IconButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-white dark:hover:bg-neutral-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>{children}</svg>
    </button>
  )
}
