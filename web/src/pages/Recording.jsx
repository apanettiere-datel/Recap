import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { toast } from '@/lib/toast'
import { formatClock, formatBytes } from '@/lib/format'
import {
  newSessionId, createSession, appendChunk, updateSession, deleteSession,
  notifyRecordingsChanged, markUploading, unmarkUploading,
} from '@/lib/recordingStore'
import { uploadRecording, downloadBlob, extensionForMime } from '@/lib/uploadRecording'
import { LiveUploader } from '@/lib/liveUploader'
import PendingRecordings from '@/components/PendingRecordings'
import RecordingNotes from '@/components/RecordingNotes'

const MAX_RECORDING_SECONDS = 2 * 60 * 60 // 2 hours
const LIMIT_WARNING_SECONDS = MAX_RECORDING_SECONDS - 5 * 60
const MIN_RECORDING_SECONDS = 1
const SILENCE_WARNING_MS = 8000
const BAR_COUNT = 40

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

function pickMimeType() {
  for (const t of MIME_CANDIDATES) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t
  }
  return '' // let the browser choose
}

function describeMediaError(err, kind) {
  const name = err?.name
  if (kind === 'display') {
    if (name === 'NotAllowedError' || name === 'AbortError') return 'Tab sharing was cancelled. Choose a browser tab and tick "Share tab audio" to capture the meeting.'
    return "Couldn't start tab capture. Meeting mode works in Chrome and Edge on desktop."
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow microphone access for this site in your browser settings, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect a microphone and try again.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Your microphone is in use by another app or not responding. Close other apps using it and try again.'
  return err?.message ? `Couldn't start recording: ${err.message}` : "Couldn't start recording."
}

export default function Recording() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const personId = searchParams.get('personId')
  const api = useApi()
  const queryClient = useQueryClient()

  // choose | starting | recording | paused | finalizing | uploading | failed | error
  const [phase, setPhase] = useState('choose')
  const [mode, setMode] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState(() => new Array(BAR_COUNT).fill(0))
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [silent, setSilent] = useState(false)
  const [backupOk, setBackupOk] = useState(true)
  const [cloud, setCloud] = useState(null)
  const [importing, setImporting] = useState(false)
  const [upload, setUpload] = useState({ progress: 0, attempt: 0, size: 0 })
  const [myNotes, setMyNotes] = useState([])

  const recorderRef = useRef(null)
  const streamsRef = useRef([])
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const tickRef = useRef(null)
  const wakeLockRef = useRef(null)
  const sessionRef = useRef(null) // { id, mimeType, startedAt }
  const chunksRef = useRef([])
  const seqRef = useRef(0)
  const accumulatedMsRef = useRef(0)
  const segmentStartRef = useRef(null)
  const lastSoundAtRef = useRef(0)
  const finalizedRef = useRef(false)
  const discardRef = useRef(false)
  const blobRef = useRef(null)
  const mountedRef = useRef(true)
  const phaseRef = useRef('choose')
  const limitWarnedRef = useRef(false)
  const liveRef = useRef(null)
  const myNotesRef = useRef([])

  const go = (p) => { phaseRef.current = p; setPhase(p) }

  const elapsedMs = () => accumulatedMsRef.current + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0)

  // ---------------------------------------------------------------------------
  // Media lifecycle
  // ---------------------------------------------------------------------------

  function releaseMedia() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = null
    for (const s of streamsRef.current) s.getTracks().forEach((t) => { t.onended = null; t.stop() })
    streamsRef.current = []
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    wakeLockRef.current?.release?.().catch(() => {})
    wakeLockRef.current = null
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      }
    } catch {
      // Not critical — the recording continues if the screen sleeps on most devices
    }
  }

  function startVisualizer(analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT))
      const bars = []
      let total = 0
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0
        const v = sum / step / 255
        bars.push(v)
        total += v
      }
      if (total / BAR_COUNT > 0.03) lastSoundAtRef.current = Date.now()
      setLevels(bars)
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  async function start(selectedMode) {
    setMode(selectedMode)
    setError(null)
    setNotice(null)
    go('starting')

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser can't record audio. Try the latest Chrome, Edge, Firefox or Safari.")
      go('error')
      return
    }

    let mic
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      setError(describeMediaError(err, 'mic'))
      go('error')
      return
    }
    streamsRef.current = [mic]

    let recordStream = mic
    const watchTracks = [...mic.getAudioTracks()]

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = audioCtx
      if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {})
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.7
      const micSource = audioCtx.createMediaStreamSource(mic)
      micSource.connect(analyser)

      if (selectedMode === 'meeting') {
        let display
        try {
          if (!navigator.mediaDevices.getDisplayMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
          display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        } catch (err) {
          releaseMedia()
          setError(describeMediaError(err, 'display'))
          go('error')
          return
        }
        streamsRef.current.push(display)
        const tabAudio = display.getAudioTracks()
        if (tabAudio.length === 0) {
          releaseMedia()
          setError('The shared tab has no audio. Share again and make sure "Share tab audio" is switched on.')
          go('error')
          return
        }
        // Only the audio is needed
        display.getVideoTracks().forEach((t) => t.stop())

        const tabSource = audioCtx.createMediaStreamSource(new MediaStream(tabAudio))
        tabSource.connect(analyser)
        const dest = audioCtx.createMediaStreamDestination()
        micSource.connect(dest)
        tabSource.connect(dest)
        recordStream = dest.stream
        watchTracks.push(...tabAudio)
      }

      startVisualizer(analyser)
    } catch (err) {
      // The visualizer is optional in voice mode; meeting mode needs the audio graph
      console.warn('[recording] audio graph setup failed:', err)
      if (selectedMode === 'meeting') {
        releaseMedia()
        setError("Couldn't set up meeting capture in this browser. Try Chrome or Edge.")
        go('error')
        return
      }
    }

    const mimeType = pickMimeType()
    let recorder
    try {
      recorder = new MediaRecorder(recordStream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined)
    } catch (err) {
      releaseMedia()
      setError(`This browser couldn't start the recorder${err?.message ? ` (${err.message})` : ''}.`)
      go('error')
      return
    }

    const session = {
      id: newSessionId(),
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      mode: selectedMode,
      personId: personId || null,
      startedAt: new Date().toISOString(),
    }
    sessionRef.current = session
    chunksRef.current = []
    seqRef.current = 0
    finalizedRef.current = false
    discardRef.current = false
    blobRef.current = null
    accumulatedMsRef.current = 0
    segmentStartRef.current = Date.now()
    lastSoundAtRef.current = Date.now()
    limitWarnedRef.current = false
    myNotesRef.current = []
    setMyNotes([])

    try {
      await createSession(session)
      setBackupOk(true)
      notifyRecordingsChanged()
    } catch {
      setBackupOk(false)
    }

    // Second copy: stream the audio to the server while recording
    setCloud(null)
    liveRef.current = new LiveUploader(api, session, (st) => { if (mountedRef.current) setCloud(st) })

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0 || discardRef.current) return
      chunksRef.current.push(e.data)
      const seq = seqRef.current++
      appendChunk(session.id, seq, e.data, elapsedMs() / 1000).catch(() => setBackupOk(false))
      liveRef.current?.add(e.data, elapsedMs() / 1000)
    }
    recorder.onstop = () => onRecorderStopped()
    recorder.onerror = (e) => {
      console.error('[recording] recorder error:', e?.error || e)
      finish('The recorder stopped unexpectedly. Everything captured up to that point was saved.')
    }

    for (const track of watchTracks) {
      track.onended = () => {
        if (!['recording', 'paused'].includes(phaseRef.current)) return
        const isTab = selectedMode === 'meeting' && track !== mic.getAudioTracks()[0]
        finish(isTab
          ? 'Tab sharing ended, so the recording was stopped and saved.'
          : 'Your microphone was disconnected, so the recording was stopped and saved.')
      }
    }

    recorderRef.current = recorder
    try {
      recorder.start(1000)
    } catch (err) {
      releaseMedia()
      setError(`Couldn't start the recorder${err?.message ? ` (${err.message})` : ''}.`)
      go('error')
      deleteSession(session.id).catch(() => {})
      liveRef.current?.discard()
      liveRef.current = null
      return
    }

    setElapsed(0)
    go('recording')
    requestWakeLock()

    tickRef.current = setInterval(() => {
      const secs = Math.floor(elapsedMs() / 1000)
      setElapsed(secs)
      if (phaseRef.current === 'recording' && document.visibilityState === 'visible') {
        setSilent(Date.now() - lastSoundAtRef.current > SILENCE_WARNING_MS)
      }
      if (secs >= LIMIT_WARNING_SECONDS && !limitWarnedRef.current) {
        limitWarnedRef.current = true
        setNotice('5 minutes left — recordings stop automatically at 2 hours.')
      }
      if (secs >= MAX_RECORDING_SECONDS) {
        finish('You reached the 2-hour limit, so the recording was stopped and saved.')
      }
    }, 250)
  }

  /** Notes and bookmarks: kept on this device and on the server, like the audio. */
  function changeNotes(next) {
    myNotesRef.current = next
    setMyNotes(next)
    const session = sessionRef.current
    if (!session) return
    updateSession(session.id, { myNotes: next }).catch(() => {})
    liveRef.current?.setNotes(next)
  }

  function pause() {
    const r = recorderRef.current
    if (!r || r.state !== 'recording') return
    try {
      r.pause()
      r.requestData?.()
    } catch {
      return
    }
    accumulatedMsRef.current += Date.now() - (segmentStartRef.current || Date.now())
    segmentStartRef.current = null
    setSilent(false)
    go('paused')
  }

  function resume() {
    const r = recorderRef.current
    if (!r || r.state !== 'paused') return
    try {
      r.resume()
    } catch {
      return
    }
    segmentStartRef.current = Date.now()
    lastSoundAtRef.current = Date.now()
    go('recording')
  }

  /** Stop recording and save. Safe to call more than once and from any trigger. */
  function finish(message) {
    if (finalizedRef.current || !['recording', 'paused'].includes(phaseRef.current)) return
    if (message) setNotice(message)
    if (segmentStartRef.current) {
      accumulatedMsRef.current += Date.now() - segmentStartRef.current
      segmentStartRef.current = null
    }
    go('finalizing')
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      try {
        r.stop() // → ondataavailable (final chunk) → onstop → onRecorderStopped
        return
      } catch {
        // fall through and finalize with what we have
      }
    }
    onRecorderStopped()
  }

  async function onRecorderStopped() {
    if (finalizedRef.current) return
    finalizedRef.current = true
    // The recorder can stop on its own (e.g. the mic's track ended) without finish() running
    if (segmentStartRef.current) {
      accumulatedMsRef.current += Date.now() - segmentStartRef.current
      segmentStartRef.current = null
    }
    if (phaseRef.current !== 'finalizing' && mountedRef.current) go('finalizing')
    releaseMedia()

    const session = sessionRef.current
    if (discardRef.current || !session) return

    const durationSec = Math.round(accumulatedMsRef.current / 1000)
    const blob = new Blob(chunksRef.current, { type: session.mimeType })
    blobRef.current = blob

    if (blob.size === 0 || durationSec < MIN_RECORDING_SECONDS) {
      deleteSession(session.id).catch(() => {})
      liveRef.current?.discard()
      liveRef.current = null
      notifyRecordingsChanged()
      if (!mountedRef.current) return
      setError('That recording was too short or captured no audio. Check your microphone and try again.')
      go('error')
      return
    }

    await updateSession(session.id, { status: 'stopped', duration: durationSec }).catch(() => {})
    notifyRecordingsChanged()
    if (mountedRef.current) await doUpload()
  }

  async function doUpload() {
    const session = sessionRef.current
    const blob = blobRef.current
    if (!session || !blob) return
    const durationSec = Math.round(accumulatedMsRef.current / 1000)

    setError(null)
    setUpload({ progress: 0, attempt: 0, size: blob.size })
    if (mountedRef.current) go('uploading')
    markUploading(session.id)

    try {
      // Fast path: most of the audio is already on the server; send the tail and finalize
      let note = null
      const live = liveRef.current
      liveRef.current = null
      if (live) {
        try {
          note = await live.finish(durationSec, {
            onProgress: (p) => mountedRef.current && setUpload((u) => ({ ...u, progress: p })),
          })
        } catch (err) {
          console.warn('[recording] live upload could not finish, uploading the full file:', err?.message)
          live.close()
        }
      }

      if (!note?.id) note = await uploadRecording(api, {
        blob,
        clientId: session.id,
        mode: 'conversation',
        duration: durationSec,
        personId: session.personId,
        recordedAt: session.startedAt,
        myNotes: myNotesRef.current,
      }, {
        onProgress: (p) => mountedRef.current && setUpload((u) => ({ ...u, progress: p })),
        onRetry: (attempt) => mountedRef.current && setUpload((u) => ({ ...u, attempt, progress: 0 })),
      })

      await deleteSession(session.id).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      if (session.personId) queryClient.invalidateQueries({ queryKey: ['person', session.personId] })

      if (mountedRef.current) {
        navigate(note?.id ? `/note/${note.id}` : '/', { replace: true })
      } else {
        toast.success('Your recording was uploaded and is being processed.')
      }
    } catch (err) {
      const message = err?.message || 'Upload failed.'
      await updateSession(session.id, { status: 'failed', error: message }).catch(() => {})
      if (mountedRef.current) {
        setError(message)
        go('failed')
      } else {
        toast.error('A recording failed to upload. It is saved on this device — open Recap to retry.')
      }
    } finally {
      unmarkUploading(session.id)
      notifyRecordingsChanged()
    }
  }

  async function discard() {
    const secs = Math.floor(elapsedMs() / 1000)
    const active = ['recording', 'paused', 'failed', 'finalizing'].includes(phaseRef.current)
    if (active && secs >= 3 && !window.confirm('Discard this recording? This cannot be undone.')) return

    discardRef.current = true
    finalizedRef.current = true
    liveRef.current?.discard()
    liveRef.current = null
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      r.onstop = null
      try { r.stop() } catch { /* already stopped */ }
    }
    releaseMedia()
    if (sessionRef.current) {
      await deleteSession(sessionRef.current.id).catch(() => {})
      notifyRecordingsChanged()
    }
    navigate('/', { replace: true })
  }

  /** Import an existing recording (voice memo, meeting export, etc.). */
  async function importFile(file) {
    if (!file) return
    if (!/^(audio|video)\//.test(file.type) && !/\.(m4a|mp3|wav|webm|ogg|aac|mp4|mov|flac)$/i.test(file.name)) {
      toast.error("That doesn't look like an audio file.")
      return
    }
    if (file.size > 250 * 1024 * 1024) {
      toast.error('That file is larger than 250MB. Trim it or split it into parts first.')
      return
    }
    const session = {
      id: newSessionId(),
      mimeType: file.type || 'audio/mp4',
      mode: 'import',
      personId: personId || null,
      startedAt: new Date(file.lastModified || Date.now()).toISOString(),
    }
    sessionRef.current = session
    blobRef.current = file
    accumulatedMsRef.current = 0
    setImporting(true)
    setMode('voice')
    await doUpload()
  }

  function saveForLater() {
    toast.info('Saved on this device. You can upload it from the banner at the top of Recap.')
    navigate('/', { replace: true })
  }

  function downloadAudio() {
    if (!blobRef.current || !sessionRef.current) return
    const stamp = sessionRef.current.startedAt.replace(/[:.]/g, '-').slice(0, 19)
    downloadBlob(blobRef.current, `recap-recording-${stamp}.${extensionForMime(blobRef.current.type)}`)
  }

  // ---------------------------------------------------------------------------
  // Page lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true
    const onBeforeUnload = (e) => {
      if (['recording', 'paused', 'finalizing', 'uploading'].includes(phaseRef.current)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    // Flush buffered audio to storage before the page can be frozen or killed
    const onPageHide = () => {
      const r = recorderRef.current
      if (r && r.state === 'recording') {
        try { r.requestData() } catch { /* ignore */ }
        // Push the newest audio to the cloud too, once the requested chunk arrives
        setTimeout(() => liveRef.current?.flush(), 100)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastSoundAtRef.current = Date.now()
        if (phaseRef.current === 'recording' && !wakeLockRef.current) requestWakeLock()
      } else {
        onPageHide()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mountedRef.current = false
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)

      // Left the page mid-recording (e.g. browser back): stop and keep what was captured
      const r = recorderRef.current
      if (r && r.state !== 'inactive' && !finalizedRef.current) {
        finalizedRef.current = true
        const session = sessionRef.current
        const live = liveRef.current
        const duration = Math.round(elapsedMs() / 1000)
        r.onstop = () => {
          if (!session || discardRef.current) return
          updateSession(session.id, { status: 'stopped', duration })
            .catch(() => {})
            .finally(notifyRecordingsChanged)
          if (!live) return
          // Keep finishing the upload in the background
          markUploading(session.id)
          live.finish(duration)
            .then(async () => {
              await deleteSession(session.id).catch(() => {})
              queryClient.invalidateQueries({ queryKey: ['notes'] })
              toast.success('Your recording was saved and is being processed.')
            })
            .catch(() => toast.info('Recording saved on this device — upload it from the banner.'))
            .finally(() => { unmarkUploading(session.id); notifyRecordingsChanged() })
        }
        try { r.stop() } catch { /* ignore */ }
        toast.info('Recording stopped and saved.')
      }
      releaseMedia()
    }
  }, [queryClient])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const accent = mode === 'meeting' ? 'blue' : 'red'

  if (phase === 'choose') {
    return (
      <Screen>
        <TopBar onCancel={() => navigate(-1)} />
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="w-full mb-4 empty:hidden [&>div]:!px-0 [&>div]:!pt-0">
            <PendingRecordings />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 tracking-tight">New recording</h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-8">What are you recording?</p>

          <div className="flex flex-col gap-3 w-full">
            <ModeButton
              color="red"
              title="Voice note"
              subtitle="In-person conversation or a note to self"
              icon={<MicIcon className="w-6 h-6" />}
              onClick={() => start('voice')}
            />
            <ModeButton
              color="blue"
              title="Online meeting"
              subtitle="Your mic plus audio from a browser tab (Zoom, Meet, Teams)"
              icon={<MonitorIcon className="w-6 h-6" />}
              onClick={() => start('meeting')}
            />
          </div>

          <label className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500 cursor-pointer transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import an audio file
            <input
              type="file"
              accept="audio/*,video/mp4,video/quicktime,.m4a,.mp3,.wav,.webm,.ogg,.aac"
              className="sr-only"
              onChange={(e) => importFile(e.target.files?.[0])}
            />
          </label>

          <ul className="mt-8 text-xs text-neutral-400 dark:text-neutral-500 space-y-1.5 text-left w-full">
            <li className="flex gap-2"><Dot />Recordings are saved on this device and backed up to the cloud as you go, so nothing is lost if the page closes or the connection drops.</li>
            <li className="flex gap-2"><Dot />Up to 2 hours per recording. You can pause and resume.</li>
            <li className="flex gap-2"><Dot />Meeting mode works in Chrome and Edge on desktop.</li>
          </ul>
        </div>
      </Screen>
    )
  }

  if (phase === 'error') {
    return (
      <Screen>
        <TopBar onCancel={() => navigate('/', { replace: true })} label="Close" />
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center mx-auto mb-5">
            <AlertIcon className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">Couldn&apos;t record</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-8 leading-relaxed">{error}</p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => start(mode || 'voice')} className="btn-primary">Try again</button>
            <button type="button" onClick={() => { setError(null); go('choose') }} className="btn-ghost">Choose a different mode</button>
          </div>
        </div>
      </Screen>
    )
  }

  if (phase === 'uploading' || phase === 'finalizing') {
    const pct = Math.round(upload.progress * 100)
    return (
      <Screen>
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-lg font-semibold text-neutral-900 dark:text-white">
            {phase === 'finalizing' ? 'Saving recording…' : pct >= 100 ? 'Finishing upload…' : 'Uploading recording…'}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {importing ? 'Importing file' : `${formatClock(elapsed)} recorded`}{upload.size ? ` · ${formatBytes(upload.size)}` : ''}
          </p>
          {phase === 'uploading' && (
            <div className="mt-6 h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div className="h-full bg-blue-500 transition-[width] duration-300" style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
          )}
          {upload.attempt > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
              Connection problem — retrying (attempt {upload.attempt + 1})…
            </p>
          )}
          {notice && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-4">{notice}</p>}
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-6">
            {importing ? 'Keep this page open until the upload finishes.' : 'Your recording is saved on this device until the upload completes.'}
          </p>
        </div>
      </Screen>
    )
  }

  if (phase === 'failed') {
    return (
      <Screen>
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center mx-auto mb-5">
            <CloudIcon className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">Upload didn&apos;t finish</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2 leading-relaxed">{error}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-8">
            {importing ? 'Your original file was not changed.' : `Your ${formatClock(elapsed)} recording is safe on this device.`}
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={doUpload} className="btn-primary">Retry upload</button>
            {!importing && <button type="button" onClick={saveForLater} className="btn-secondary">Upload later</button>}
            {!importing && <button type="button" onClick={downloadAudio} className="btn-ghost">Download audio file</button>}
            <button type="button" onClick={discard} className="btn-ghost text-red-500 dark:text-red-400">Discard recording</button>
          </div>
        </div>
      </Screen>
    )
  }

  // starting | recording | paused
  const isPaused = phase === 'paused'
  return (
    <Screen>
      <TopBar onCancel={discard} label="Discard">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
          accent === 'blue' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
        }`}>
          {mode === 'meeting' ? <MonitorIcon className="w-3.5 h-3.5" /> : <MicIcon className="w-3.5 h-3.5" />}
          {mode === 'meeting' ? 'Meeting' : 'Voice'}
        </span>
      </TopBar>

      <div className="flex flex-col items-center w-full max-w-md">
        <div className="min-h-[3.5rem] mb-4 flex flex-col items-center gap-2 px-4">
          {!backupOk && phase !== 'starting' && (
            <Banner tone="amber">Local backup isn&apos;t available (private browsing?). Keep this tab open until the upload finishes.</Banner>
          )}
          {silent && !isPaused && (
            <Banner tone="amber">We&apos;re not hearing anything. Check that your microphone is on and unmuted.</Banner>
          )}
          {notice && <Banner tone="neutral">{notice}</Banner>}
        </div>

        <p className="text-6xl font-extralight text-neutral-900 dark:text-white tabular-nums tracking-tight">
          {formatClock(elapsed)}
        </p>
        <div className="h-6 mt-3 flex items-center justify-center gap-2">
          {phase === 'starting' && <span className="text-sm text-neutral-500">Starting…</span>}
          {phase === 'recording' && (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-red-500 dark:text-red-400 font-medium">Recording</span>
            </>
          )}
          {isPaused && <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">Paused</span>}
        </div>

        <div className="flex items-center justify-center gap-[3px] h-28 my-8 px-6 w-full" aria-hidden="true">
          {levels.map((level, i) => (
            <div
              key={i}
              className={`flex-1 max-w-[6px] rounded-full transition-[height] duration-75 ${accent === 'blue' ? 'bg-blue-500' : 'bg-red-500'}`}
              style={{ height: `${Math.max(4, (isPaused ? 0 : level) * 112)}px`, opacity: isPaused ? 0.25 : 0.35 + level * 0.65 }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={isPaused ? resume : pause}
            disabled={phase === 'starting'}
            className="w-14 h-14 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
            aria-label={isPaused ? 'Resume' : 'Pause'}
          >
            {isPaused ? <PlayIcon className="w-6 h-6" /> : <PauseIcon className="w-6 h-6" />}
          </button>
          <button
            type="button"
            onClick={() => finish()}
            disabled={phase === 'starting'}
            className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition active:scale-95 ring-4 ring-red-500/25 disabled:opacity-40"
            aria-label="Stop and save"
          >
            <div className="w-7 h-7 rounded-md bg-white" />
          </button>
          <div className="w-14" />
        </div>
        <CloudStatus cloud={cloud} backupOk={backupOk} starting={phase === 'starting'} />
        <RecordingNotes notes={myNotes} onChange={changeNotes} getTime={() => elapsedMs() / 1000} disabled={phase === 'starting'} />
      </div>
    </Screen>
  )
}

function CloudStatus({ cloud, backupOk, starting }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (starting) return <div className="h-5 mt-6" />

  let tone = 'text-neutral-400 dark:text-neutral-500'
  let label = 'Saving on this device…'
  if (cloud?.lastAckAt) {
    const ago = Math.round((now - cloud.lastAckAt) / 1000)
    label = `Backed up to the cloud ${ago < 20 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`}`
    tone = 'text-emerald-600 dark:text-emerald-400'
  }
  if (cloud?.lastError && cloud.behind > 1) {
    label = backupOk
      ? 'Cloud backup is waiting for a connection — saved on this device'
      : 'Cloud backup is waiting for a connection — keep this tab open'
    tone = 'text-amber-600 dark:text-amber-400'
  }
  return (
    <p className={`flex items-center gap-1.5 text-xs mt-6 h-5 ${tone}`} role="status">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
      {label}
    </p>
  )
}

function Screen({ children }) {
  return (
    <div className="fixed inset-0 z-50 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center px-6 overflow-y-auto">
      <div className="my-auto w-full flex flex-col items-center pt-[calc(4.5rem+env(safe-area-inset-top,0px))] pb-10">{children}</div>
    </div>
  )
}

function TopBar({ onCancel, label = 'Cancel', children }) {
  return (
    <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))]">
      <button type="button" onClick={onCancel} className="text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
        {label}
      </button>
      {children}
    </div>
  )
}

function Banner({ tone, children }) {
  const tones = {
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    neutral: 'bg-neutral-200/70 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300',
  }
  return <div className={`px-4 py-2 rounded-xl text-xs text-center max-w-sm ${tones[tone]}`}>{children}</div>
}

function ModeButton({ color, title, subtitle, icon, onClick }) {
  const tint = color === 'blue' ? 'bg-blue-500/15 text-blue-500' : 'bg-red-500/15 text-red-500'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors text-left"
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${tint}`}>{icon}</div>
      <div>
        <p className="text-base font-semibold text-neutral-900 dark:text-white">{title}</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">{subtitle}</p>
      </div>
    </button>
  )
}

function Dot() {
  return <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-400 shrink-0" />
}

function MicIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
    </svg>
  )
}

function MonitorIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a9 9 0 01-9 9m0 0a9 9 0 01-9-9" />
    </svg>
  )
}

function PauseIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function PlayIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28A1 1 0 008 5.14z" />
    </svg>
  )
}

function AlertIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  )
}

function CloudIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
    </svg>
  )
}
