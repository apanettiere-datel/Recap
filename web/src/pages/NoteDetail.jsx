import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useApi, API_BASE } from '@/lib/api'
import { useAuthFetch } from '@/lib/authFetch'
import { toast } from '@/lib/toast'
import { formatFullDate, formatDuration, getInitials, colorForName, sentimentColor } from '@/lib/format'
import AudioPlayer from '@/components/AudioPlayer'
import CommitmentRow from '@/components/CommitmentRow'
import AddToCalendarSheet from '@/components/AddToCalendarSheet'
import ShareSheet from '@/components/ShareSheet'
import ProcessingStatus from '@/components/ProcessingStatus'
import TranscriptViewer from '@/components/TranscriptViewer'

function useNoteAudio(noteId, enabled) {
  const authFetch = useAuthFetch()
  const [attempt, setAttempt] = useState(0)
  // Results are tagged with the request they belong to; anything else reads as "loading"
  const key = `${noteId}:${attempt}`
  const [result, setResult] = useState({ key: null, url: null, status: 'idle' })

  useEffect(() => {
    if (!enabled) return
    let url = null
    let cancelled = false
    const controller = new AbortController()
    authFetch(`${API_BASE}/api/notes/${noteId}/audio`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'missing' : `HTTP ${r.status}`)
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setResult({ key, url, status: 'ready' })
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, url: null, status: err.message === 'missing' ? 'missing' : 'error' })
      })
    return () => {
      cancelled = true
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [noteId, enabled, key, authFetch])

  const current = result.key === key ? result : { url: null, status: enabled ? 'loading' : 'idle' }
  return { ...current, retry: () => setAttempt((a) => a + 1) }
}

export default function NoteDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const navigate = useNavigate()
  const api = useApi()
  const queryClient = useQueryClient()

  const [showTranscript, setShowTranscript] = useState(!!initialQuery)
  const [calendarCommitment, setCalendarCommitment] = useState(null)
  const [showShare, setShowShare] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const { data: note, isLoading, error, refetch } = useQuery({
    queryKey: ['note', id],
    queryFn: () => api.get(`/notes/${id}`),
    refetchInterval: (query) => (query.state.data?.isProcessing ? 2500 : false),
  })

  const audio = useNoteAudio(id, !!note?.audioUrl)

  // When processing finishes, refresh lists that show this note
  const wasProcessing = useRef(false)
  useEffect(() => {
    if (!note) return
    if (wasProcessing.current && !note.isProcessing) {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
      queryClient.invalidateQueries({ queryKey: ['people'] })
      if (note.processingError) toast.error('Processing failed. You can retry from this page.')
      else toast.success('Your recording is ready')
    }
    wasProcessing.current = note.isProcessing
  }, [note, queryClient])

  const invalidateNote = () => {
    queryClient.invalidateQueries({ queryKey: ['note', id] })
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  }

  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) => api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  const updateTitle = useMutation({
    mutationFn: (title) => api.patch(`/notes/${id}`, { title }),
    onSuccess: () => { invalidateNote(); setEditingTitle(false) },
  })

  const togglePin = useMutation({
    mutationFn: () => api.patch(`/notes/${id}`, { isPinned: !note.isPinned }),
    onSuccess: invalidateNote,
  })

  const toggleArchive = useMutation({
    mutationFn: () => api.patch(`/notes/${id}`, { isArchived: !note.isArchived }),
    onSuccess: (updated) => {
      invalidateNote()
      if (updated?.isArchived) {
        toast.info('Conversation archived', {
          action: { label: 'Undo', onClick: () => api.patch(`/notes/${id}`, { isArchived: false }).then(invalidateNote) },
        })
        navigate(-1)
      }
    },
  })

  const deleteNote = useMutation({
    mutationFn: () => api.del(`/notes/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
      toast.info('Conversation deleted')
      navigate('/', { replace: true })
    },
  })

  const addTag = useMutation({
    mutationFn: (label) => api.post(`/notes/${id}/tags`, { label }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['note', id] }),
  })

  const removeTag = useMutation({
    mutationFn: (tagId) => api.del(`/notes/${id}/tags/${tagId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['note', id] }),
  })

  const reprocess = useMutation({
    mutationFn: (retranscribe) => api.post(`/notes/${id}/reprocess`, { retranscribe }),
    onSuccess: () => {
      wasProcessing.current = true
      invalidateNote()
    },
    onError: (err) => {
      // 409: it's already running — just refresh to show the live status
      if (err?.status === 409) queryClient.invalidateQueries({ queryKey: ['note', id] })
    },
  })

  const handleAddTag = () => {
    const label = tagInput.trim()
    if (!label) return
    addTag.mutate(label)
    setTagInput('')
    setShowTagInput(false)
  }

  const saveTitle = () => {
    const t = titleDraft.trim()
    if (t && t !== note.title) updateTitle.mutate(t)
    else setEditingTitle(false)
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-20 animate-pulse">
        <div className="h-7 bg-neutral-200 dark:bg-neutral-800 rounded w-2/3 mb-3" />
        <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3 mb-8" />
        <div className="h-16 bg-neutral-200 dark:bg-neutral-800 rounded-2xl mb-6" />
        <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-full mb-2" />
        <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-5/6" />
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <p className="text-neutral-900 dark:text-white font-medium mb-1">
            {error?.status === 404 ? 'Conversation not found' : "Couldn't load this conversation"}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
            {error?.status === 404 ? 'It may have been deleted.' : error?.message}
          </p>
          <div className="flex gap-2 justify-center">
            {error?.status !== 404 && <button type="button" onClick={() => refetch()} className="btn-primary">Try again</button>}
            <button type="button" onClick={() => navigate('/')} className="btn-ghost">Go to feed</button>
          </div>
        </div>
      </div>
    )
  }

  const humans = (note.people || []).filter((p) => p.relationship !== 'organization')
  const orgs = (note.people || []).filter((p) => p.relationship === 'organization')
  const hasTranscript = !!note.transcript?.trim()

  return (
    <div className="min-h-full pb-16">
      <header className="sticky top-0 z-10 bg-neutral-50/85 dark:bg-black/85 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-2 h-14 flex items-center gap-1">
          <button type="button" onClick={() => navigate(-1)} className="icon-btn" aria-label="Back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => togglePin.mutate()}
            className={`icon-btn ${note.isPinned ? '!text-blue-500' : ''}`}
            aria-label={note.isPinned ? 'Unpin' : 'Pin'}
            title={note.isPinned ? 'Unpin' : 'Pin'}
          >
            <svg className="w-5 h-5" fill={note.isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinejoin="round" d="M16 3a1 1 0 01.7 1.7L15 6.4v4.2l2.7 2.7a1 1 0 01-.7 1.7H13v5a1 1 0 01-2 0v-5H7a1 1 0 01-.7-1.7L9 10.6V6.4L7.3 4.7A1 1 0 018 3h8z" />
            </svg>
          </button>
          <button type="button" onClick={() => setShowShare(true)} className="icon-btn" aria-label="Share" title="Share">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
          </button>
          <div className="relative">
            <button type="button" onClick={() => setShowMenu((v) => !v)} className="icon-btn" aria-label="More actions" aria-expanded={showMenu}>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-11 z-20 w-56 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl py-1.5 text-sm">
                  <MenuItem onClick={() => { setShowMenu(false); setTitleDraft(note.title || ''); setEditingTitle(true) }}>Rename</MenuItem>
                  <MenuItem onClick={() => { setShowMenu(false); toggleArchive.mutate() }}>{note.isArchived ? 'Unarchive' : 'Archive'}</MenuItem>
                  {!note.isProcessing && (note.audioUrl || hasTranscript) && (
                    <MenuItem onClick={() => { setShowMenu(false); reprocess.mutate(false) }}>Re-run analysis</MenuItem>
                  )}
                  {!note.isProcessing && note.audioUrl && (
                    <MenuItem onClick={() => { setShowMenu(false); reprocess.mutate(true) }}>Re-transcribe audio</MenuItem>
                  )}
                  <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
                  <MenuItem
                    danger
                    onClick={() => {
                      setShowMenu(false)
                      if (window.confirm('Delete this conversation, its transcript and audio? This cannot be undone.')) deleteNote.mutate()
                    }}
                  >
                    Delete conversation
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        <ProcessingStatus note={note} onRetry={(retranscribe) => reprocess.mutate(retranscribe)} retrying={reprocess.isPending} />

        {editingTitle ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
            maxLength={200}
            className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 w-full bg-transparent border-b-2 border-blue-500 outline-none"
            autoFocus
          />
        ) : (
          <h1
            className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white mb-2 cursor-text hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            onClick={() => { setTitleDraft(note.title || ''); setEditingTitle(true) }}
            title="Click to rename"
          >
            {note.title || (note.isProcessing ? 'New recording' : 'Untitled note')}
          </h1>
        )}

        <div className="flex items-center gap-2 flex-wrap mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          <span>{formatFullDate(note.recordedAt)}</span>
          {note.duration > 0 && <><span aria-hidden>·</span><span>{formatDuration(note.duration)}</span></>}
          {note.sentiment && !note.isProcessing && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${sentimentColor(note.sentiment)}`}>{note.sentiment}</span>
          )}
          {note.isArchived && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">Archived</span>
          )}
        </div>

        {note.audioUrl && (
          <div className="mb-6">
            {audio.status === 'ready' ? (
              <AudioPlayer audioUrl={audio.url} duration={note.duration} />
            ) : audio.status === 'loading' ? (
              <div className="h-[72px] rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center gap-2 text-sm text-neutral-400">
                <div className="w-4 h-4 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
                Loading audio…
              </div>
            ) : audio.status === 'missing' || audio.status === 'error' ? (
              <div className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {audio.status === 'missing' ? 'The audio file for this recording is unavailable.' : "Couldn't load the audio."}
                </p>
                {audio.status === 'error' && (
                  <button type="button" onClick={audio.retry} className="text-sm font-medium text-blue-600 dark:text-blue-400 shrink-0">Retry</button>
                )}
              </div>
            ) : null}
          </div>
        )}

        {note.summary && (
          <Section title="Summary">
            <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed">{note.summary}</p>
          </Section>
        )}

        {note.commitments?.length > 0 && (
          <Section title="Commitments">
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {note.commitments.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onToggle={() => toggleCommitment.mutate({ commitmentId: c.id, status: c.status === 'completed' ? 'open' : 'completed' })}
                  onAddCal={(commitment) => setCalendarCommitment(commitment)}
                />
              ))}
            </div>
          </Section>
        )}

        {(humans.length > 0 || orgs.length > 0) && (
          <Section title="People & organizations">
            <div className="flex flex-wrap gap-2">
              {humans.map((person) => (
                <Chip key={person.id} onClick={() => navigate(`/person/${person.id}`)}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${colorForName(person.name)}`}>{getInitials(person.name)}</span>
                  {person.name}
                </Chip>
              ))}
              {orgs.map((org) => (
                <Chip key={org.id} onClick={() => navigate(`/person/${org.id}`)}>
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white bg-purple-500">{getInitials(org.name)}</span>
                  {org.name}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {note.quotes?.length > 0 && (
          <Section title="Key quotes">
            <div className="flex flex-col gap-3">
              {note.quotes.map((quote, i) => (
                <blockquote key={quote.id || i} className="border-l-[3px] border-blue-500 pl-4 py-1">
                  <p className="text-[15px] text-neutral-700 dark:text-neutral-300 italic leading-relaxed">&ldquo;{quote.text || quote}&rdquo;</p>
                  {quote.speaker && <p className="text-xs text-neutral-400 mt-1">&mdash; {quote.speaker}</p>}
                </blockquote>
              ))}
            </div>
          </Section>
        )}

        {note.topics?.length > 0 && (
          <Section title="Topics">
            <div className="flex flex-wrap gap-2">
              {note.topics.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(`"${topic.name || topic}"`)}`)}
                  className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors"
                >
                  {topic.name || topic}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Tags">
          <div className="flex flex-wrap gap-2">
            {note.tags?.map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1 pl-3 pr-2 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {tag.label}
                <button
                  type="button"
                  onClick={() => removeTag.mutate(tag.id)}
                  className="text-neutral-400 hover:text-red-500 transition-colors p-0.5"
                  aria-label={`Remove tag ${tag.label}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            {showTagInput ? (
              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); handleAddTag() }}>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setShowTagInput(false)}
                  onBlur={() => { if (!tagInput.trim()) setShowTagInput(false) }}
                  placeholder="Tag name"
                  maxLength={50}
                  className="px-3 py-1 rounded-full bg-white dark:bg-neutral-900 border border-blue-500 text-sm text-neutral-900 dark:text-white outline-none w-32"
                  autoFocus
                />
                <button type="submit" className="text-blue-600 dark:text-blue-400 text-sm font-semibold px-1">Add</button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowTagInput(true)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-400 hover:text-blue-500 hover:border-blue-500 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add tag
              </button>
            )}
          </div>
        </Section>

        {hasTranscript && (
          <section className="mb-6">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="w-full flex items-center justify-between gap-2 mb-3 group"
              aria-expanded={showTranscript}
            >
              <h2 className="section-label group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors">Transcript</h2>
              <span className="flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400">
                {showTranscript ? 'Hide' : 'Show'}
                <svg className={`w-4 h-4 transition-transform ${showTranscript ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </span>
            </button>
            {showTranscript ? (
              <TranscriptViewer transcript={note.transcript} title={note.title} initialQuery={initialQuery} />
            ) : (
              <button
                type="button"
                onClick={() => setShowTranscript(true)}
                className="w-full text-left bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
              >
                <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-3 leading-relaxed">{note.transcript}</p>
              </button>
            )}
          </section>
        )}
      </div>

      <AddToCalendarSheet
        open={!!calendarCommitment}
        commitment={calendarCommitment}
        onClose={() => setCalendarCommitment(null)}
        onAdded={() => {
          if (calendarCommitment) {
            api.patch(`/commitments/${calendarCommitment.id}`, { addedToCalendar: true })
              .then(() => queryClient.invalidateQueries({ queryKey: ['note', id] }))
              .catch(() => {})
          }
          setCalendarCommitment(null)
        }}
      />

      <ShareSheet open={showShare} onClose={() => setShowShare(false)} note={note} />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-7">
      <h2 className="section-label mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Chip({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500 transition-colors text-sm text-neutral-700 dark:text-neutral-300"
    >
      {children}
    </button>
  )
}

function MenuItem({ onClick, danger, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
        danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
