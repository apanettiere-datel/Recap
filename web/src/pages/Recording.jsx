import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'

const MAX_RECORDING_SECONDS = 2 * 60 * 60 // 2 hours

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const BAR_COUNT = 40

export default function Recording() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const personId = searchParams.get('personId')
  const api = useApi()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState(null) // null = choosing, 'voice' | 'meeting'
  const [status, setStatus] = useState('idle') // idle | recording | uploading
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState(() => new Array(BAR_COUNT).fill(0))
  const [error, setError] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const displayStreamRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const timerRef = useRef(null)
  const audioCtxRef = useRef(null)

  const uploadMutation = useMutation({
    mutationFn: async (blob) => {
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')
      formData.append('mode', 'conversation')
      formData.append('duration', String(elapsed))
      if (personId) {
        formData.append('personId', personId)
      }
      return api.upload('/notes', formData)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      if (personId) {
        queryClient.invalidateQueries({ queryKey: ['person', personId] })
      }
      navigate(data?.id ? `/note/${data.id}` : '/')
    },
    onError: (err) => {
      setError(err.message || 'Upload failed')
      setStatus('idle')
    },
  })

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop())
      displayStreamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    mediaRecorderRef.current = null
    analyserRef.current = null
  }, [])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  const startVisualizer = useCallback((analyser) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      const step = Math.floor(dataArray.length / BAR_COUNT)
      const bars = []
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j]
        }
        bars.push((sum / step) / 255)
      }
      setLevels(bars)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const startVoiceRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      analyserRef.current = analyser

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start(1000)
      setStatus('recording')
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)

      startVisualizer(analyser)
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
      cleanup()
    }
  }, [cleanup, startVisualizer])

  const startMeetingRecording = useCallback(async () => {
    setError(null)
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = micStream

      let displayStream
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        })
      } catch {
        setError('Tab sharing cancelled. Select a browser tab to capture meeting audio.')
        micStream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        return
      }

      displayStreamRef.current = displayStream

      const displayAudioTracks = displayStream.getAudioTracks()
      if (displayAudioTracks.length === 0) {
        setError('No audio from shared tab. Make sure to check "Share tab audio" when sharing.')
        micStream.getTracks().forEach((t) => t.stop())
        displayStream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        displayStreamRef.current = null
        return
      }

      // Stop the video track — we only need audio
      displayStream.getVideoTracks().forEach((t) => t.stop())

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      const micSource = audioCtx.createMediaStreamSource(micStream)
      const tabSource = audioCtx.createMediaStreamSource(
        new MediaStream(displayAudioTracks)
      )

      const dest = audioCtx.createMediaStreamDestination()
      micSource.connect(dest)
      tabSource.connect(dest)

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.7
      micSource.connect(analyser)
      tabSource.connect(analyser)
      analyserRef.current = analyser

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(dest.stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      // If the user stops sharing the tab, stop the recording
      displayAudioTracks[0].onended = () => {
        stopRecording()
      }

      recorder.start(1000)
      setStatus('recording')
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)

      startVisualizer(analyser)
    } catch {
      setError('Failed to start meeting recording. Make sure you\'re using Chrome or Edge.')
      cleanup()
    }
  }, [cleanup, startVisualizer])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
      cleanup()
      setStatus('uploading')
      uploadMutation.mutate(blob)
    }

    recorder.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
  }, [cleanup, uploadMutation])

  useEffect(() => {
    if (elapsed >= MAX_RECORDING_SECONDS && status === 'recording') {
      stopRecording()
    }
  }, [elapsed, status, stopRecording])

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {}
      recorder.stop()
    }
    cleanup()
    navigate(-1)
  }, [cleanup, navigate])

  const selectMode = useCallback((selectedMode) => {
    setMode(selectedMode)
    if (selectedMode === 'voice') {
      startVoiceRecording()
    } else {
      startMeetingRecording()
    }
  }, [startVoiceRecording, startMeetingRecording])

  if (status === 'uploading') {
    return (
      <div className="fixed inset-0 z-50 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-6" />
        <p className="text-neutral-900 dark:text-white text-lg font-semibold">Processing your recording...</p>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-2">This may take a moment</p>
      </div>
    )
  }

  if (!mode) {
    return (
      <div className="fixed inset-0 z-50 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute top-6 left-6 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm font-medium transition-colors"
        >
          Cancel
        </button>

        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 tracking-tight">New Recording</h1>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-10">What are you recording?</p>

        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button
            type="button"
            onClick={() => selectMode('voice')}
            className="flex items-center gap-4 p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors text-left"
          >
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-neutral-900 dark:text-white">Voice Note</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">Record from your microphone</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => selectMode('meeting')}
            className="flex items-center gap-4 p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors text-left"
          >
            <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a9 9 0 01-9 9m0 0a9 9 0 01-9-9" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-neutral-900 dark:text-white">Meeting</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">Capture mic + browser tab audio</p>
            </div>
          </button>
        </div>

        <p className="text-neutral-400 dark:text-neutral-600 text-xs mt-8 text-center max-w-xs">
          Meeting mode captures audio from a shared browser tab (Zoom, Teams, Meet) plus your microphone.
          Works in Chrome and Edge.
        </p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center">
      {/* Cancel */}
      <button
        type="button"
        onClick={cancelRecording}
        className="absolute top-6 left-6 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm font-medium transition-colors"
      >
        Cancel
      </button>

      {/* Mode badge */}
      <div className="absolute top-6 right-6">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
          mode === 'meeting'
            ? 'bg-blue-500/15 text-blue-500 dark:text-blue-400'
            : 'bg-red-500/15 text-red-500 dark:text-red-400'
        }`}>
          {mode === 'meeting' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a9 9 0 01-9 9m0 0a9 9 0 01-9-9" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
          {mode === 'meeting' ? 'Meeting' : 'Voice'}
        </span>
      </div>

      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm max-w-sm text-center">
          {error}
        </div>
      )}

      {/* Timer */}
      <div className="mb-8">
        <p className="text-5xl font-light text-neutral-900 dark:text-white tabular-nums tracking-wide">
          {formatTime(elapsed)}
        </p>
        {status === 'recording' && (
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-red-400 font-medium">Recording</span>
          </div>
        )}
      </div>

      {/* Waveform */}
      <div className="flex items-center justify-center gap-[2px] h-24 mb-12 px-6 w-full max-w-md">
        {levels.map((level, i) => (
          <div
            key={i}
            className={`flex-1 max-w-[6px] rounded-full transition-all duration-75 ${
              mode === 'meeting' ? 'bg-blue-500' : 'bg-red-500'
            }`}
            style={{
              height: `${Math.max(4, level * 96)}px`,
              opacity: 0.4 + level * 0.6,
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-8">
        {status === 'idle' && !error && (
          <button
            type="button"
            onClick={mode === 'meeting' ? startMeetingRecording : startVoiceRecording}
            className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors active:scale-95"
          >
            <div className="w-7 h-7 rounded-full bg-white" />
          </button>
        )}

        {status === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors active:scale-95 ring-4 ring-red-500/30"
          >
            <div className="w-7 h-7 rounded-md bg-white" />
          </button>
        )}

        {status === 'idle' && error && (
          <button
            type="button"
            onClick={() => { setMode(null); setError(null) }}
            className="px-6 py-3 rounded-full bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  )
}
