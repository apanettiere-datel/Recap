import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '@/lib/api'

const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

function toSeconds(stamp) {
  return stamp.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
}

/** Render an answer, turning [12:34] citations into links that play that moment. */
function AnswerText({ text, onSeek }) {
  if (!onSeek) return text
  const parts = text.split(TIMESTAMP_RE)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <button
        key={i}
        type="button"
        onClick={() => onSeek(toSeconds(part))}
        className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium tabular-nums hover:bg-blue-500/20"
        title="Play this moment"
      >
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z" /></svg>
        {part}
      </button>
    ) : part,
  )
}

export default function Chat() {
  const api = useApi()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const noteId = searchParams.get('noteId')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const { data: people } = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get('/people'),
  })

  const { data: note } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => api.get(`/notes/${noteId}`),
    enabled: !!noteId,
  })

  const sendMutation = useMutation({
    meta: { silent: true }, // errors are shown in the thread
    mutationFn: ({ message, history }) =>
      api.post('/insights/chat', { message, history, ...(noteId && { noteId }) }, { timeout: 90000 }),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply },
      ])
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` },
      ])
    },
  })

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || sendMutation.isPending) return
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    sendMutation.mutate({ message: trimmed, history: messages })
  }

  const handlePrompt = (prompt) => {
    setMessages((prev) => [...prev, { role: 'user', content: prompt }])
    sendMutation.mutate({ message: prompt, history: messages })
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Generate personalized example prompts based on people data
  const examplePrompts = noteId ? [
    'What were the action items and who owns them?',
    'What decisions were made?',
    'What questions were left open?',
    'What were the most important things they said?',
  ] : (() => {
    const prompts = [
      'What were my key takeaways this week?',
      'What commitments am I behind on?',
      'Summarize my recent conversations',
    ]
    if (people && people.length > 0) {
      const firstName = people[0].name?.split(' ')[0]
      if (firstName) {
        prompts.push(`What did ${firstName} and I discuss last time?`)
      }
      if (people.length > 1) {
        const secondName = people[1].name?.split(' ')[0]
        if (secondName) {
          prompts.push(`Do I have any open commitments with ${secondName}?`)
        }
      }
    }
    return prompts
  })()

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-blue-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Ask Recap</h1>
            {noteId && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                About: {note?.title || 'this conversation'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">{noteId ? 'Ask about this conversation' : 'Ask Recap anything'}</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6 text-center max-w-xs">
                Get insights about your conversations, commitments, and relationships.
              </p>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {examplePrompts.map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handlePrompt(prompt)}
                    className="text-left px-4 py-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 hover:border-blue-500 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-md'
                        : 'bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-800 rounded-bl-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">
                      {msg.role === 'assistant'
                        ? <AnswerText text={msg.content} onSeek={noteId ? (t) => navigate(`/note/${noteId}?t=${t}`) : null} />
                        : msg.content}
                    </p>
                  </div>
                </div>
              ))}
              {sendMutation.isPending && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 md:pb-0 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-t border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-end gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                            placeholder={noteId ? 'Ask about this conversation…' : 'Ask about your conversations…'}
              className="flex-1 px-4 py-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
