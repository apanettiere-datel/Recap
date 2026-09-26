import { formatRelativeDate, formatDuration, getInitials, colorForName, sentimentColor } from '@/lib/format'
import { Highlight } from '@/lib/highlight'
import { formatTimestamp } from '@/lib/useNoteAudio'

/**
 * A conversation in a list. With `terms`, matches are highlighted and transcript
 * snippets from search results are shown.
 */
export default function NoteCard({ note, onClick, onRetry, onOpenAt, terms }) {
  const people = (note.people || []).filter((p) => p.relationship !== 'organization')
  const failed = !note.isProcessing && !!note.processingError
  const openCommitments = (note.commitments || []).filter((c) => c.status !== 'completed').length

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
      className={`group w-full text-left bg-white dark:bg-neutral-900 rounded-2xl p-4 border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 hover:shadow-md hover:-translate-y-px ${
        failed ? 'border-red-500/30' : 'border-neutral-200 dark:border-neutral-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-white leading-snug line-clamp-2 flex-1">
          {note.isPinned && (
            <svg className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24" aria-label="Pinned">
              <path d="M16 3a1 1 0 01.7 1.7L15 6.4v4.2l2.7 2.7a1 1 0 01-.7 1.7H13v5a1 1 0 01-2 0v-5H7a1 1 0 01-.7-1.7L9 10.6V6.4L7.3 4.7A1 1 0 018 3h8z" />
            </svg>
          )}
          {note.isProcessing && !note.title
            ? <span className="text-neutral-500 dark:text-neutral-400">New recording</span>
            : <Highlight text={note.title || 'Untitled note'} terms={terms} />}
        </h3>
        <span className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap shrink-0 pt-0.5">
          {formatRelativeDate(note.recordedAt)}
        </span>
      </div>

      {note.isProcessing ? (
        <div className="flex items-center gap-2 my-2">
          <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-blue-600 dark:text-blue-400">{note.processingStage || 'Processing'}…</span>
        </div>
      ) : failed ? (
        <div className="flex items-center gap-3 my-2">
          <span className="text-sm text-red-600 dark:text-red-400 flex-1 line-clamp-1">Processing failed</span>
          {onRetry && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRetry() }}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      ) : note.summary ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed mb-2">
          <Highlight text={note.summary} terms={terms} />
        </p>
      ) : null}

      {note.hits?.length > 0 && onOpenAt ? (
        <div className="mt-2 mb-2 space-y-1">
          {note.hits.slice(0, 3).map((hit, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenAt(hit.start) }}
              className="w-full flex items-start gap-2 text-left rounded-lg px-2 py-1.5 -mx-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              title="Play from this moment"
            >
              <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400 pt-0.5">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                {formatTimestamp(hit.start)}
              </span>
              <span className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2">
                <Highlight text={hit.text} terms={terms} />
              </span>
            </button>
          ))}
          {note.transcriptMatches > note.hits.length && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {note.transcriptMatches} matches in transcript
            </p>
          )}
        </div>
      ) : note.snippets?.length > 0 && (
        <div className="mt-2 mb-2 space-y-1.5">
          {note.snippets.slice(0, 2).map((s, i) => (
            <p key={i} className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed pl-3 border-l-2 border-yellow-400/70">
              <Highlight text={s} terms={terms} />
            </p>
          ))}
          {note.transcriptMatches > 0 && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500 pl-3">
              {note.transcriptMatches} match{note.transcriptMatches === 1 ? '' : 'es'} in transcript
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {note.sentiment && !note.isProcessing && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${sentimentColor(note.sentiment)}`}>
              {note.sentiment}
            </span>
          )}
          {note.duration > 0 && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{formatDuration(note.duration)}</span>
          )}
          {openCommitments > 0 && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              · {openCommitments} open item{openCommitments === 1 ? '' : 's'}
            </span>
          )}
          {note.isArchived && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">Archived</span>
          )}
          {(note.tags || []).slice(0, 3).map((t) => (
            <span key={t.id} className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
              <Highlight text={t.label} terms={terms} />
            </span>
          ))}
        </div>

        {people.length > 0 && (
          <div className="flex -space-x-1.5 shrink-0">
            {people.slice(0, 3).map((person) => (
              <div
                key={person.id}
                title={person.name}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white dark:ring-neutral-900 ${colorForName(person.name)}`}
              >
                {getInitials(person.name)}
              </div>
            ))}
            {people.length > 3 && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-neutral-500 bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300 ring-2 ring-white dark:ring-neutral-900">
                +{people.length - 3}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function NoteCardSkeleton() {
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-200 dark:border-neutral-800 animate-pulse">
      <div className="flex justify-between gap-4 mb-3">
        <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-2/3" />
        <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-12" />
      </div>
      <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-full mb-2" />
      <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-4/5 mb-3" />
      <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-full w-16" />
    </div>
  )
}
