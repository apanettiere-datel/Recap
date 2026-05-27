import { useState, useRef, useEffect, useCallback } from 'react'

const BAR_COUNT = 48

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
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

export default function AudioPlayer({ audioUrl, duration: initialDuration }) {
  const audioRef = useRef(null)
  const barContainerRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDuration || 0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [bars] = useState(() => generateWaveformData(BAR_COUNT))
  const animRef = useRef(null)

  const progress = duration > 0 ? currentTime / duration : 0

  const updateTime = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
    animRef.current = requestAnimationFrame(updateTime)
  }, [])

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
      setIsLoaded(true)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (animRef.current) cancelAnimationFrame(animRef.current)
  }

  const togglePlay = async () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
      if (animRef.current) cancelAnimationFrame(animRef.current)
    } else {
      try {
        await audioRef.current.play()
        setIsPlaying(true)
        animRef.current = requestAnimationFrame(updateTime)
      } catch {
        // autoplay blocked
      }
    }
  }

  const handleSeek = (e) => {
    if (!barContainerRef.current || !audioRef.current || !duration) return
    const rect = barContainerRef.current.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = fraction * duration
    setCurrentTime(fraction * duration)
  }

  if (!audioUrl) return null

  const activeBar = Math.floor(progress * BAR_COUNT)

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          type="button"
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center transition-colors flex-shrink-0"
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

        {/* Time */}
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono w-10 text-center tabular-nums">
          {formatTime(currentTime)}
        </span>

        {/* Waveform bars */}
        <div
          ref={barContainerRef}
          className="flex-1 flex items-center gap-[1.5px] h-10 cursor-pointer"
          onClick={handleSeek}
          role="slider"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          {bars.map((height, i) => {
            const isPast = i <= activeBar
            const isCurrent = i === activeBar && isPlaying
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-150"
                style={{
                  height: `${Math.max(12, height * 100)}%`,
                  backgroundColor: isPast
                    ? 'rgb(59, 130, 246)'
                    : 'rgba(148, 163, 184, 0.3)',
                  transform: isCurrent ? 'scaleY(1.15)' : 'scaleY(1)',
                  transition: 'transform 0.15s ease, background-color 0.15s ease',
                }}
              />
            )
          })}
        </div>

        {/* Duration */}
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono w-10 text-center tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
