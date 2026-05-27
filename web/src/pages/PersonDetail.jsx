import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/api'
import { useState } from 'react'
import CommitmentRow from '@/components/CommitmentRow'
import AddToCalendarSheet from '@/components/AddToCalendarSheet'
import ShareSheet from '@/components/ShareSheet'

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

function colorForName(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function InlineEditField({ value, placeholder, onSave, type = 'text', multiline = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const handleStart = () => {
    setDraft(value || '')
    setEditing(true)
  }

  const handleSave = () => {
    if (draft.trim() !== (value || '')) {
      onSave(draft.trim())
    }
    setEditing(false)
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSave()
            }
          }}
          placeholder={placeholder}
          rows={3}
          className="w-full text-sm bg-transparent border-b border-blue-500 text-neutral-900 dark:text-white outline-none resize-none"
          autoFocus
        />
      )
    }
    return (
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder={placeholder}
        className="w-full text-sm bg-transparent border-b border-blue-500 text-neutral-900 dark:text-white outline-none"
        autoFocus
      />
    )
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      className="w-full text-left text-sm text-neutral-900 dark:text-white hover:text-blue-500 dark:hover:text-blue-400 transition-colors truncate"
    >
      {value || <span className="text-neutral-400 dark:text-neutral-500">{placeholder}</span>}
    </button>
  )
}

export default function PersonDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const queryClient = useQueryClient()

  const [isEditingName, setIsEditingName] = useState(false)
  const [isEditingRelationship, setIsEditingRelationship] = useState(false)
  const [editName, setEditName] = useState('')
  const [editRelationship, setEditRelationship] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [calendarCommitment, setCalendarCommitment] = useState(null)
  const [showShare, setShowShare] = useState(false)

  // Commitment creation state
  const [showNewCommitment, setShowNewCommitment] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newOwner, setNewOwner] = useState('me')
  const [newDueDate, setNewDueDate] = useState('')

  const { data: person, isLoading, error } = useQuery({
    queryKey: ['person', id],
    queryFn: () => api.get(`/people/${id}`),
  })

  const { data: timeline } = useQuery({
    queryKey: ['person-timeline', id],
    queryFn: () => api.get(`/people/${id}/timeline`),
    enabled: !!person,
  })

  const updatePerson = useMutation({
    mutationFn: (body) => api.patch(`/people/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person', id] })
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
  })

  const deletePerson = useMutation({
    mutationFn: () => api.del(`/people/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      navigate('/people', { replace: true })
    },
  })

  const toggleCommitment = useMutation({
    mutationFn: ({ commitmentId, status }) =>
      api.patch(`/commitments/${commitmentId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person', id] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  const updateCommitmentDueDate = useMutation({
    mutationFn: ({ commitmentId, dueDate }) =>
      api.patch(`/commitments/${commitmentId}`, { dueDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person', id] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
    },
  })

  const createCommitment = useMutation({
    mutationFn: (body) => api.post('/commitments', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person', id] })
      queryClient.invalidateQueries({ queryKey: ['commitments'] })
      setShowNewCommitment(false)
      setNewDescription('')
      setNewOwner('me')
      setNewDueDate('')
    },
  })

  const handleSaveName = () => {
    if (editName.trim() && editName.trim() !== person.name) {
      updatePerson.mutate({ name: editName.trim() })
    }
    setIsEditingName(false)
  }

  const handleSaveRelationship = () => {
    if (editRelationship.trim() !== (person.relationship || '')) {
      updatePerson.mutate({ relationship: editRelationship.trim() })
    }
    setIsEditingRelationship(false)
  }

  const handleCreateCommitment = () => {
    if (!newDescription.trim()) return
    const body = {
      description: newDescription.trim(),
      personId: id,
      owner: newOwner,
    }
    if (newDueDate) {
      body.dueDate = new Date(newDueDate).toISOString()
    }
    createCommitment.mutate(body)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !person) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Failed to load person</p>
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
            title="Share"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/recording?personId=${id}`)}
            className="text-sm font-medium px-3 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            Record Follow-up
          </button>
          <button
            type="button"
            onClick={() => navigate(`/briefing/${id}`)}
            className="text-sm font-medium px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
          >
            Prep Meeting
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-8">
        {/* Profile */}
        <div className="flex flex-col items-center mb-8">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white mb-4 ${colorForName(person.name)}`}>
            {getInitials(person.name)}
          </div>

          {isEditingName ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              className="text-2xl font-bold text-center bg-transparent border-b-2 border-blue-500 text-neutral-900 dark:text-white outline-none"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditName(person.name || '')
                setIsEditingName(true)
              }}
              className="text-2xl font-bold text-neutral-900 dark:text-white hover:text-blue-500 transition-colors"
            >
              {person.name}
            </button>
          )}

          {(person.role || person.organization) && (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {[person.role, person.organization].filter(Boolean).join(' at ')}
            </p>
          )}

          {isEditingRelationship ? (
            <input
              type="text"
              value={editRelationship}
              onChange={(e) => setEditRelationship(e.target.value)}
              onBlur={handleSaveRelationship}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRelationship()}
              placeholder="Add relationship..."
              className="mt-1 text-sm text-center bg-transparent border-b border-blue-500 text-neutral-500 dark:text-neutral-400 outline-none"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditRelationship(person.relationship || '')
                setIsEditingRelationship(true)
              }}
              className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-blue-500 transition-colors"
            >
              {person.relationship || 'Add relationship'}
            </button>
          )}

          {person.lastContactDate && (
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
              Last contact: {formatDate(person.lastContactDate)}
            </p>
          )}
        </div>

        {/* Contact Info */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
            Contact Info
          </h2>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
            <div className="flex items-center gap-3 px-4 py-3">
              <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <div className="flex-1 min-w-0">
                <InlineEditField
                  value={person.phone}
                  placeholder="Add phone"
                  type="tel"
                  onSave={(val) => updatePerson.mutate({ phone: val })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <div className="flex-1 min-w-0">
                <InlineEditField
                  value={person.email}
                  placeholder="Add email"
                  type="email"
                  onSave={(val) => updatePerson.mutate({ email: val })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
              </svg>
              <div className="flex-1 min-w-0">
                <InlineEditField
                  value={person.role}
                  placeholder="Add role"
                  onSave={(val) => updatePerson.mutate({ role: val })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
              <div className="flex-1 min-w-0">
                <InlineEditField
                  value={person.organization}
                  placeholder="Add organization"
                  onSave={(val) => updatePerson.mutate({ organization: val })}
                />
              </div>
            </div>
            <div className="flex items-start gap-3 px-4 py-3">
              <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              <div className="flex-1 min-w-0">
                <InlineEditField
                  value={person.personalNotes}
                  placeholder="Add notes"
                  multiline
                  onSave={(val) => updatePerson.mutate({ notes: val })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">
              {person.notes?.length ?? person.noteCount ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Conversations</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">
              {person.commitments?.filter((c) => c.status !== 'done').length ?? person.openCommitments ?? 0}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Open</p>
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 text-center border border-neutral-200 dark:border-neutral-800">
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">
              {person.insights?.avgDaysBetweenContacts != null ? `${person.insights.avgDaysBetweenContacts}d` : '--'}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Avg Interval</p>
          </div>
        </div>

        {/* Frequent Topics */}
        {person.insights?.frequentTopics?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Common Topics
            </h2>
            <div className="flex flex-wrap gap-2">
              {person.insights.frequentTopics.map((topic, i) => (
                <span key={i} className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 text-sm font-medium">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Commitments */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Commitments
            </h2>
            {!showNewCommitment && (
              <button
                type="button"
                onClick={() => setShowNewCommitment(true)}
                className="text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Add commitment"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 px-3">
            {person.commitments?.map((c) => (
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
                onUpdateDueDate={(commitmentId, dueDate) =>
                  updateCommitmentDueDate.mutate({ commitmentId, dueDate })
                }
              />
            ))}

            {(!person.commitments || person.commitments.length === 0) && !showNewCommitment && (
              <div className="py-6 text-center">
                <p className="text-sm text-neutral-400 dark:text-neutral-500">No commitments yet</p>
              </div>
            )}

            {/* Inline new commitment form */}
            {showNewCommitment && (
              <div className="py-3 px-1">
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCommitment()}
                  placeholder="What's the commitment?"
                  className="w-full text-[15px] font-semibold tracking-tight bg-transparent text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none mb-3"
                  autoFocus
                />

                <div className="flex items-center gap-3 mb-3">
                  {/* Owner toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700">
                    <button
                      type="button"
                      onClick={() => setNewOwner('me')}
                      className={`px-3 py-1 text-xs font-semibold transition-colors ${
                        newOwner === 'me'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      Me
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewOwner('them')}
                      className={`px-3 py-1 text-xs font-semibold transition-colors ${
                        newOwner === 'them'
                          ? 'bg-orange-500 text-white'
                          : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                      }`}
                    >
                      Them
                    </button>
                  </div>

                  {/* Due date */}
                  <input
                    type="datetime-local"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="flex-1 text-xs px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCommitment(false)
                      setNewDescription('')
                      setNewOwner('me')
                      setNewDueDate('')
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateCommitment}
                    disabled={!newDescription.trim() || createCommitment.isPending}
                    className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40"
                  >
                    {createCommitment.isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <AddToCalendarSheet
          open={!!calendarCommitment}
          commitment={calendarCommitment}
          onClose={() => setCalendarCommitment(null)}
          onAdded={() => {
            if (calendarCommitment) {
              api.patch(`/commitments/${calendarCommitment.id}`, { addedToCalendar: true })
                .then(() => queryClient.invalidateQueries({ queryKey: ['person', id] }))
                .catch(() => {})
            }
            setCalendarCommitment(null)
          }}
        />

        {/* Timeline */}
        {timeline?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
              Timeline
            </h2>
            <div className="relative">
              <div className="absolute left-[17px] top-3 bottom-3 w-px bg-neutral-200 dark:bg-neutral-800" />
              <div className="space-y-0">
                {timeline.map((event, i) => (
                  <div key={i} className="relative flex gap-3 py-3">
                    {/* Dot */}
                    <div className="relative z-10 mt-0.5 flex-shrink-0">
                      {event.type === 'conversation' && (
                        <div className="w-[9px] h-[9px] rounded-full bg-blue-500 ring-4 ring-neutral-50 dark:ring-black ml-[4px]" />
                      )}
                      {event.type === 'commitment_created' && (
                        <div className="w-[9px] h-[9px] rounded-full bg-orange-500 ring-4 ring-neutral-50 dark:ring-black ml-[4px]" />
                      )}
                      {event.type === 'commitment_completed' && (
                        <div className="w-[9px] h-[9px] rounded-full bg-green-500 ring-4 ring-neutral-50 dark:ring-black ml-[4px]" />
                      )}
                      {event.type === 'quote' && (
                        <div className="w-[9px] h-[9px] rounded-full bg-purple-500 ring-4 ring-neutral-50 dark:ring-black ml-[4px]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {event.type === 'conversation' && (
                        <button
                          type="button"
                          onClick={() => navigate(`/note/${event.noteId}`)}
                          className="w-full text-left group"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                            </svg>
                            <span className="text-sm font-medium text-neutral-900 dark:text-white group-hover:text-blue-500 transition-colors truncate">
                              {event.title}
                            </span>
                          </div>
                          {event.summary && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5 ml-5.5">
                              {event.summary}
                            </p>
                          )}
                          {event.sentiment && event.sentiment !== 'neutral' && (
                            <span className={`inline-block mt-1 ml-5.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              event.sentiment === 'positive' ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
                              event.sentiment === 'negative' ? 'bg-red-500/10 text-red-500' :
                              'bg-neutral-200/60 dark:bg-neutral-800 text-neutral-500'
                            }`}>
                              {event.sentiment}
                            </span>
                          )}
                        </button>
                      )}

                      {event.type === 'commitment_created' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${
                              event.owner === 'me' ? 'text-blue-500' : 'text-orange-500'
                            }`}>
                              {event.owner === 'me' ? 'You' : 'Them'}
                            </span>
                            <span className="text-xs text-neutral-400">committed</span>
                          </div>
                          <p className="text-sm text-neutral-900 dark:text-white mt-0.5">
                            {event.description}
                          </p>
                        </div>
                      )}

                      {event.type === 'commitment_completed' && (
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm text-green-600 dark:text-green-400">
                            Completed: {event.description}
                          </span>
                        </div>
                      )}

                      {event.type === 'quote' && (
                        <div>
                          <p className="text-sm italic text-neutral-700 dark:text-neutral-300 border-l-2 border-purple-400 pl-2">
                            "{event.text}"
                          </p>
                          <span className="text-[11px] text-neutral-400 mt-0.5 block">— {event.speaker}</span>
                        </div>
                      )}
                    </div>

                    {/* Date */}
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500 flex-shrink-0 mt-0.5 tabular-nums">
                      {formatDate(event.date)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Delete */}
        <div className="mt-12">
          {showDeleteConfirm ? (
            <div className="bg-red-500/10 rounded-2xl p-4 text-center">
              <p className="text-sm text-red-500 font-medium mb-3">
                Are you sure? This will remove this person and their associations.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => deletePerson.mutate()}
                  disabled={deletePerson.isPending}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {deletePerson.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-3 rounded-2xl text-red-500 text-sm font-medium hover:bg-red-500/10 transition-colors"
            >
              Delete Person
            </button>
          )}
        </div>
      </div>

      <ShareSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        commitments={person.commitments}
        personName={person.name}
      />
    </div>
  )
}
