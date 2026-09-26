import { Component } from 'react'

/**
 * Keeps one broken page from blanking the whole app. Also recovers from the
 * "failed to fetch dynamically imported module" error users hit after a deploy
 * replaces the lazily-loaded page bundles.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const staleBundle = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(error?.message || '')

    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">
            {staleBundle ? 'Recap was updated' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
            {staleBundle
              ? 'A new version is available. Reload to continue.'
              : 'This page hit an unexpected error. Your recordings and notes are safe.'}
          </p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary">Reload</button>
            {!staleBundle && (
              <button type="button" onClick={() => this.setState({ error: null })} className="btn-ghost">Try again</button>
            )}
          </div>
        </div>
      </div>
    )
  }
}
