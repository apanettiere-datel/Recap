import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTerms, termsRegExp } from '@/lib/searchTerms'
import { toast } from '@/lib/toast'
import { downloadBlob } from '@/lib/uploadRecording'
import { formatTimestamp } from '@/lib/useNoteAudio'

/** Break an untimed transcript (one long run of text) into readable paragraphs. */
function textParagraphs(text) {
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

/** Group timed segments into paragraphs at pauses or every few sentences. */
function segmentParagraphs(segments) {
  const out = []
  let current = null
  for (const seg of segments) {
    const gap = current ? seg.s - current.end : 0
    const len = current ? current.segs.reduce((n, s) => n + s.t.length, 0) : 0
    if (!current || gap > 2.5 || current.segs.length >= 6 || len > 550) {
      current = { start: seg.s, end: seg.e, segs: [] }
      out.push(current)
    }
    current.segs.push(seg)
    current.end = seg.e
  }
  return out
}

/**
 * Full transcript with:
 * - find-in-transcript (highlights, count, previous/next)
 * - when timed segments exist: timestamps, click any sentence to play from there,
 *   and the sentence being played is highlighted as the audio runs
 */
export default function TranscriptViewer({ transcript, segments, title, initialQuery = '', currentTime = null, onSeek, stickyTop = 57 }) {
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const [follow, setFollow] = useState(true)
  const containerRef = useRef(null)
  const timed = Array.isArray(segments) && segments.length > 0 && !!onSeek

  const terms = useMemo(() => parseTerms(query), [query])
  const re = useMemo(() => termsRegExp(terms), [terms])

  // Paragraphs → segments → text/match parts, numbering matches across the transcript
  const { blocks, matchCount } = useMemo(() => {
    let n = 0
    const split = (text) => {
      if (!re) return [text]
      return text.split(re).map((part, i) => (i % 2 === 1 ? { match: part, index: n++ } : part))
    }
    const source = timed
      ? segmentParagraphs(segments)
      : textParagraphs(transcript || '').map((p) => ({ start: null, segs: [{ s: null, e: null, t: p }] }))
    const out = source.map((p) => ({
      start: p.start,
      segs: p.segs.map((seg) => ({ ...seg, parts: split(seg.t) })),
    }))
    return { blocks: out, matchCount: n }
  }, [timed, segments, transcript, re])

  const current = matchCount ? Math.min(active, matchCount - 1) : 0

  useEffect(() => {
    if (!matchCount) return
    const el = containerRef.current?.querySelector(`[data-match="${current}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current, matchCount, terms])

  // Which segment is playing right now
  const playingStart = useMemo(() => {
    if (!timed || currentTime == null) return null
    let found = null
    for (const seg of segments) {
      if (seg.s <= currentTime + 0.05) found = seg.s
      else break
    }
    return found
  }, [timed, segments, currentTime])

  // Keep the playing sentence in view (unless the user is searching)
  useEffect(() => {
    if (!follow || playingStart == null || terms.length > 0) return
    const el = containerRef.current?.querySelector(`[data-seg="${playingStart}"]`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top < 120 || rect.bottom > window.innerHeight - 80) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [playingStart, follow, terms.length])

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
    const body = timed
      ? segmentParagraphs(segments).map((p) => `[${formatTimestamp(p.start)}] ${p.segs.map((s) => s.t).join(' ')}`).join('\n\n')
      : transcript
    downloadBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), `${safe}.txt`)
  }

  const words = useMemo(() => (transcript.match(/\S+/g) || []).length, [transcript])

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-clip">
      <div style={{ top: stickyTop }} className="sticky z-[5] rounded-t-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-neutral-100 dark:border-neutral-800 p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
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
        {blocks.map((block, bi) => (
          <div key={bi} className={timed ? 'flex gap-3' : ''}>
            {timed && (
              <button
                type="button"
                onClick={() => onSeek(block.start)}
                className="shrink-0 self-start w-12 pt-1 text-left text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400 hover:underline"
                title="Play from here"
              >
                {formatTimestamp(block.start)}
              </button>
            )}
            <p className="min-w-0">
              {block.segs.map((seg, si) => {
                const content = seg.parts.map((part, pi) =>
                  typeof part === 'string' ? part : (
                    <mark
                      key={pi}
                      data-match={part.index}
                      className={`rounded-sm px-0.5 -mx-0.5 text-inherit ${
                        part.index === current ? 'bg-orange-400/80 dark:bg-orange-500/60' : 'bg-yellow-300/70 dark:bg-yellow-400/35'
                      }`}
                    >
                      {part.match}
                    </mark>
                  ),
                )
                if (!timed) return <span key={si}>{content}</span>
                const playing = seg.s === playingStart
                return (
                  <span
                    key={si}
                    data-seg={seg.s}
                    onClick={() => onSeek(seg.s)}
                    title={`Play from ${formatTimestamp(seg.s)}`}
                    className={`cursor-pointer rounded transition-colors ${
                      playing ? 'bg-blue-500/15 text-neutral-900 dark:text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {content}{' '}
                  </span>
                )
              })}
            </p>
          </div>
        ))}
      </div>
      <div className="px-4 pb-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>{words.toLocaleString()} words{timed ? ' · click any sentence to play it' : ''}</span>
        {timed && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-blue-600" />
            Follow playback
          </label>
        )}
      </div>
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
