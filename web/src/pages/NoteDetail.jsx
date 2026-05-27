import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { useAuthFetch } from '@/lib/authFetch'
import { useState, useEffect } from 'react'
import AudioPlayer from '@/components/AudioPlayer'
import CommitmentRow from '@/components/CommitmentRow'
import AddToCalendarSheet from '@/components/AddToCalendarSheet'
import ShareSheet from '@/components/ShareSheet'

function formatFullDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function sentimentColor(sentiment) {
  switch (sentiment) {
    case 'positive': return 'bg-green-500/20 text-green-500'
    case 'negative': return 'bg-red-500/20 text-red-500'
    case 'mixed': return 'bg-yellow-500/20 text-yellow-500'
    default: return 'bg-neutral-500/20 text-neutral-400'
  }
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500',
  'bg-orange-500', 'bg-indigo-500', 'bg-green-500', 'bg-red-500',
]

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

export default function NoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const queryClient = useQueryClient()
  const [showTranscript, setShowTranscript] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)
  const [calendarCommitment, setCalendarCommitment] = useState(null)
  const [showShare, setShowShare] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const authFetch = useAuthFetch()

  useEffect(() => {
    let url = null
    const apiBase = import.meta.env.VITE_API_URL || ''
    authFetch(`${apiBase}/api/notes/${id}/audio`)
      .then(r => { if (r.ok) return r.blob(); throw new Error('no audio') })
      .then(blob => { url = URL.createObjectURL(blob); setAudioUrl(url) })
      .catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [id])

  const { data: note, isLoading, error } = useQuery({
    queryKey: ['note', id],
    queryFn: () => api.get(`/notes/${id}`),
  })

  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) =>
      api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  const updateTitle = useMutation({
    mutationFn: (title) => api.patch(`/notes/${id}`, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setEditingTitle(false)
    },
  })

  const togglePin = useMutation({
    mutationFn: () => api.patch(`/notes/${id}`, { isPinned: !note.isPinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  const toggleArchive = useMutation({
    mutationFn: () => api.patch(`/notes/${id}`, { isArchived: !note.isArchived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      if (!note.isArchived) navigate(-1)
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

  const handleAddTag = () => {
    const label = tagInput.trim()
    if (!label) return
    addTag.mutate(label)
    setTagInput('')
    setShowTagInput(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load note</p>
          <p className="text-sm text-neutral-400 mb-4">{error?.message}</p>
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500 text-sm font-medium">
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-12">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500 font-medium text-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => toggleArchive.mutate()}
            className={`text-sm font-medium px-3 py-1 rounded-full transition-colors ${
              note.isArchived
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            {note.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={() => togglePin.mutate()}
            className={`text-sm font-medium px-3 py-1 rounded-full transition-colors ${
              note.isPinned
                ? 'bg-blue-500/20 text-blue-500'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            {note.isPinned ? 'Pinned' : 'Pin'}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Title & meta */}
        {editingTitle ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const t = titleDraft.trim()
              if (t && t !== note.title) updateTitle.mutate(t)
              else setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.target.blur() }
              if (e.key === 'Escape') { setEditingTitle(false) }
            }}
            className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 w-full bg-transparent border-b-2 border-blue-500 outline-none"
            autoFocus
          />
        ) : (
          <h1
            className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 cursor-pointer hover:text-blue-500 transition-colors"
            onClick={() => { setTitleDraft(note.title || ''); setEditingTitle(true) }}
            title="Click to edit title"
          >
            {note.title || 'Untitled Note'}
          </h1>
        )}
        <div className="flex items-center gap-3 flex-wrap mb-6">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {formatFullDate(note.recordedAt)}
          </span>
          {note.sentiment && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sentimentColor(note.sentiment)}`}>
              {note.sentiment}
            </span>
          )}
          {note.duration && (
            <span className="text-xs text-neutral-400">
              {Math.ceil(note.duration / 60)} min
            </span>
          )}
        </div>

        {/* Audio Player */}
        {audioUrl && (
          <div className="mb-6">
            <AudioPlayer audioUrl={audioUrl} duration={note.duration} />
          </div>
        )}

        {/* Summary */}
        {note.summary && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
              Summary
            </h2>
            <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed">
              {note.summary}
            </p>
          </div>
        )}

        {/* People */}
        {note.people?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              People
            </h2>
            <div className="flex flex-wrap gap-2">
              {note.people.map((person, i) => (
                <button
                  key={person.id || i}
                  type="button"
                  onClick={() => person.id && navigate(`/person/${person.id}`)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-blue-500 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(person.name)}
                  </div>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">{person.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Commitments */}
        {note.commitments?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Commitments
            </h2>
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
              {note.commitments.map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  onToggle={() =>
                    toggleCommitment.mutate({
                      commitmentId: c.id,
                      status: c.status === 'completed' ? 'open' : 'completed',
                    })
                  }
                  onAddCal={(commitment) => setCalendarCommitment(commitment)}
                />
              ))}
            </div>
          </div>
        )}

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

        {/* Key Quotes */}
        {note.quotes?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Key Quotes
            </h2>
            <div className="flex flex-col gap-3">
              {note.quotes.map((quote, i) => (
                <blockquote key={i} className="border-l-4 border-blue-500 pl-4 py-2">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300 italic leading-relaxed">
                    &ldquo;{quote.text || quote}&rdquo;
                  </p>
                  {quote.speaker && (
                    <p className="text-xs text-neutral-400 mt-1">&mdash; {quote.speaker}</p>
                  )}
                </blockquote>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {note.topics?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Topics
            </h2>
            <div className="flex flex-wrap gap-2">
              {note.topics.map((topic, i) => (
                <span key={i} className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 text-sm font-medium">
                  {topic.name || topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
            Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {note.tags?.map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {tag.label}
                <button
                  type="button"
                  onClick={() => removeTag.mutate(tag.id)}
                  className="text-neutral-400 hover:text-red-500 transition-colors ml-0.5"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            {showTagInput ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  onBlur={() => { if (!tagInput.trim()) setShowTagInput(false) }}
                  placeholder="Tag name..."
                  className="px-2.5 py-1 rounded-full bg-white dark:bg-neutral-900 border border-blue-500 text-sm text-neutral-900 dark:text-white outline-none w-28"
                  autoFocus
                />
                <button type="button" onClick={handleAddTag} className="text-blue-500 text-xs font-semibold">Add</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTagInput(true)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-400 hover:text-blue-500 hover:border-blue-500 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add tag
              </button>
            )}
          </div>
        </div>

        {/* Transcript */}
        {note.transcript && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showTranscript ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              Transcript
            </button>
            {showTranscript && (
              <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800">
                <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {note.transcript}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <ShareSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        note={note}
      />
    </div>
  )
}
