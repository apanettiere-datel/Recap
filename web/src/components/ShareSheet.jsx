import { useState, useEffect } from 'react'

function formatNoteForText(note) {
  let text = `${note.title || 'Untitled Note'}\n`
  if (note.recordedAt) {
    text += `${new Date(note.recordedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`
  }
  text += '\n'
  if (note.summary) text += `${note.summary}\n\n`
  if (note.commitments?.length > 0) {
    text += 'Commitments:\n'
    note.commitments.forEach((c) => {
      const status = c.status === 'completed' ? '[x]' : '[ ]'
      text += `${status} ${c.description}`
      if (c.dueDate) text += ` (due ${new Date(c.dueDate).toLocaleDateString()})`
      text += '\n'
    })
    text += '\n'
  }
  if (note.quotes?.length > 0) {
    text += 'Key Quotes:\n'
    note.quotes.forEach((q) => {
      text += `"${q.text || q}"${q.speaker ? ` — ${q.speaker}` : ''}\n`
    })
    text += '\n'
  }
  text += '— Shared from Recap'
  return text
}

function formatCommitmentsForText(commitments, personName) {
  let text = `Commitments${personName ? ` with ${personName}` : ''}\n\n`
  commitments.forEach((c) => {
    const status = c.status === 'completed' ? '[x]' : '[ ]'
    text += `${status} ${c.description}`
    if (c.owner) text += ` (${c.owner === 'me' ? 'You' : 'Them'})`
    if (c.dueDate) text += ` — due ${new Date(c.dueDate).toLocaleDateString()}`
    text += '\n'
  })
  text += '\n— Shared from Recap'
  return text
}

export default function ShareSheet({ open, onClose, note, commitments, personName }) {
  const [copied, setCopied] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setCopied(false)
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const text = note
    ? formatNoteForText(note)
    : commitments
      ? formatCommitmentsForText(commitments, personName)
      : ''

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: note ? (note.title || 'Recap Note') : 'Recap Commitments',
          text,
        })
        onClose()
      } catch {
        // user cancelled
      }
    }
  }

  const handleEmail = () => {
    const subject = encodeURIComponent(note ? (note.title || 'Recap Note') : 'Recap Commitments')
    const body = encodeURIComponent(text)
    window.open(`mailto:?subject=${subject}&body=${body}`)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', animation: 'fadeIn 200ms ease' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm"
        style={{ animation: 'slideUp 280ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <div className="w-9 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        </div>

        <div className="px-6 pb-6 pt-3 sm:pt-5">
          <h2 className="text-[17px] font-semibold text-neutral-900 dark:text-white text-center tracking-tight">
            Share
          </h2>

          {/* Preview */}
          <div className="mt-4 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800 max-h-40 overflow-auto">
            <pre className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap font-sans">
              {text}
            </pre>
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className={`h-[50px] rounded-[14px] flex items-center justify-center gap-2 text-[17px] font-semibold tracking-tight transition-all ${
                copied
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-500 text-white hover:bg-blue-600 active:opacity-85'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                  Copy to Clipboard
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleEmail}
              className="h-[46px] rounded-[14px] border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white flex items-center justify-center gap-2 text-[15px] font-semibold tracking-tight hover:bg-neutral-50 dark:hover:bg-neutral-800 active:opacity-70 transition-all"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Email
            </button>

            {typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="h-[46px] rounded-[14px] border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white flex items-center justify-center gap-2 text-[15px] font-semibold tracking-tight hover:bg-neutral-50 dark:hover:bg-neutral-800 active:opacity-70 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                Share...
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
