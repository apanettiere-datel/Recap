import { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react'

const BAR_COUNT = 48
const RATES = [1, 1.25, 1.5, 2]

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`
}

function generateWaveformData(count) {
  const bars = []
  for (let i = 0; i < count; i++) {
    const t = i / count
    const base = 0.3 + 0.4 * Math.sin(t * Math.PI)
    const noise = (Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1
    bars.push(Math.max(0.15, Math.min(1, base + noise * 0.3)))
  }
  return bars
}

/**
 * Audio player. Parents can control it through `ref`:
 *   ref.current.seek(seconds, { play: true })
 * and follow playback with `onTimeUpdate(seconds)`.
 */
export default function AudioPlayer({ audioUrl, duration: initialDuration, onTimeUpdate, compact = false, ref }) {
  const audioRef = useRef(null)
  const barContainerRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDuration || 0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [rate, setRate] = useState(1)
  const [bars] = useState(() => generateWaveformData(compact ? 32 : BAR_COUNT))
  const animRef = useRef(null)
  const pendingSeekRef = useRef(null)
  const onTimeRef = useRef(onTimeUpdate)
  useEffect(() => { onTimeRef.current = onTimeUpdate })

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  const updateTime = useCallback(function loop() {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
      onTimeRef.current?.(audioRef.current.currentTime)
    }
    animRef.current = requestAnimationFrame(loop)
  }, [])

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current) }, [])

  const play = useCallback(async () => {
    const a = audioRef.current
    if (!a) return
    try {
      await a.play()
      setIsPlaying(true)
      if (animRef.current) cancelAnimationFrame(animRef.current)
      animRef.current = requestAnimationFrame(updateTime)
    } catch {
      // playback blocked until the user interacts
    }
  }, [updateTime])

  const seek = useCallback((seconds, { play: shouldPlay = true } = {}) => {
    const a = audioRef.current
    if (!a) return
    const t = Math.max(0, seconds || 0)
    // Seeking before the (WebM) duration is known gets clobbered; apply it once loaded
    if (!isLoaded) pendingSeekRef.current = { t, shouldPlay }
    a.currentTime = t
    setCurrentTime(t)
    onTimeRef.current?.(t)
    if (shouldPlay) play()
  }, [isLoaded, play])

  useImperativeHandle(ref, () => ({ seek, play, pause: () => audioRef.current?.pause() }), [seek, play])

  const markLoaded = (d) => {
    setDuration(d)
    setIsLoaded(true)
    const pending = pendingSeekRef.current
    if (pending && audioRef.current) {
      pendingSeekRef.current = null
      audioRef.current.currentTime = pending.t
      setCurrentTime(pending.t)
      if (pending.shouldPlay) play()
    }
  }

  const handleLoadedMetadata = () => {
    const a = audioRef.current
    if (!a) return
    if (a.duration && isFinite(a.duration)) {
      markLoaded(a.duration)
    } else {
      // WebM from MediaRecorder often has Infinity duration — force the browser to compute it
      a.currentTime = 1e10
    }
  }

  const handleTimeUpdate = () => {
    const a = audioRef.current
    if (!a) return
    if (!isLoaded && a.duration && isFinite(a.duration)) {
      const pending = pendingSeekRef.current
      a.currentTime = pending ? pending.t : 0
      markLoaded(a.duration)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    if (animRef.current) cancelAnimationFrame(animRef.current)
  }

  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (isPlaying) {
      a.pause()
      setIsPlaying(false)
      if (animRef.current) cancelAnimationFrame(animRef.current)
    } else {
      play()
    }
  }

  const skip = (delta) => seek((audioRef.current?.currentTime || 0) + delta, { play: isPlaying })

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const handleBarClick = (e) => {
    if (!barContainerRef.current || !duration) return
    const rect = barContainerRef.current.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(fraction * duration, { play: isPlaying })
  }

  const handleKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); skip(5) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-5) }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay() }
  }

  if (!audioUrl) return null

  const activeBar = Math.floor(progress * bars.length)

  return (
    <div className={compact ? 'flex items-center gap-2' : 'bg-white dark:bg-neutral-900 rounded-2xl p-3 sm:p-4 border border-neutral-200 dark:border-neutral-800'}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => {
          const a = audioRef.current
          if (a?.duration && isFinite(a.duration) && !isLoaded) markLoaded(a.duration)
        }}
        onPause={() => { setIsPlaying(false); if (animRef.current) cancelAnimationFrame(animRef.current) }}
        onEnded={handleEnded}
      />

      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-colors shrink-0`}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </button>

        {!compact && (
          <button type="button" onClick={() => skip(-15)} aria-label="Back 15 seconds" title="Back 15s" className="hidden sm:flex text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
        )}

        <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-11 text-center shrink-0">
          {formatTime(currentTime)}
        </span>

        <div
          ref={barContainerRef}
          className={`flex-1 min-w-0 flex items-center gap-[1.5px] ${compact ? 'h-7' : 'h-10'} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded`}
          onClick={handleBarClick}
          onKeyDown={handleKey}
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(currentTime)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          tabIndex={0}
        >
          {bars.map((height, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${Math.max(12, height * 100)}%`,
                backgroundColor: i <= activeBar && progress > 0 ? 'rgb(37, 99, 235)' : 'rgba(148, 163, 184, 0.35)',
              }}
            />
          ))}
        </div>

        <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-11 text-center shrink-0">
          {formatTime(duration)}
        </span>

        {!compact && (
          <>
            <button type="button" onClick={() => skip(15)} aria-label="Forward 15 seconds" title="Forward 15s" className="hidden sm:flex text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={cycleRate}
              title="Playback speed"
              className="text-xs font-semibold tabular-nums px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 shrink-0"
            >
              {rate}×
            </button>
          </>
        )}
      </div>
    </div>
  )
}
