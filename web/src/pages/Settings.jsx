import { useTheme } from '@/lib/theme'
import { useApi } from '@/lib/api'
import { useAuthFetch } from '@/lib/authFetch'
import { useState } from 'react'
import { useClerk } from '@clerk/clerk-react'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ClerkSignOut() {
  const { signOut } = useClerk()
  return (
    <button
      type="button"
      onClick={() => signOut()}
      className="w-full py-3 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-red-500 text-sm font-semibold hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
      </svg>
      Sign Out
    </button>
  )
}

export default function Settings() {
  const { mode, setMode } = useTheme()
  const api = useApi()
  const authFetch = useAuthFetch()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(null)

  const handleExport = async (type) => {
    setExporting(type)
    try {
      const path = type === 'contacts' ? '/api/people/export' : '/api/commitments/export'
      const r = await authFetch(path)
      if (!r.ok) throw new Error(`Export failed: ${r.status}`)
      const text = await r.text()
      const blob = new Blob([text], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = type === 'contacts' ? 'recap-contacts.csv' : 'recap-commitments.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
    }
    setExporting(null)
  }

  const handleDeleteAll = async () => {
    setDeleting(true)
    try {
      await api.del('/users')
    } catch {
      // ignore
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
    window.location.reload()
  }

  const themeOptions = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ]

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-black/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-8">
        {/* Theme */}
        <div>
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
            Appearance
          </h2>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className="w-full flex items-center justify-between px-4 py-3.5 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
              >
                <span className="text-sm text-neutral-900 dark:text-white">{option.label}</span>
                {mode === option.value && (
                  <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Export Data */}
        <div>
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
            Export Data
          </h2>
          <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <button
              type="button"
              onClick={() => handleExport('contacts')}
              disabled={exporting === 'contacts'}
              className="w-full flex items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
            >
              <span className="text-sm text-neutral-900 dark:text-white">
                {exporting === 'contacts' ? 'Exporting...' : 'Export Contacts (CSV)'}
              </span>
              <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleExport('commitments')}
              disabled={exporting === 'commitments'}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors text-left"
            >
              <span className="text-sm text-neutral-900 dark:text-white">
                {exporting === 'commitments' ? 'Exporting...' : 'Export Commitments (CSV)'}
              </span>
              <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Account */}
        <div>
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
            Account
          </h2>
          <div className="space-y-3">
            {CLERK_KEY && <ClerkSignOut />}

            {showDeleteConfirm ? (
              <div className="bg-red-500/10 rounded-2xl p-4 text-center">
                <p className="text-sm text-red-500 font-medium mb-3">
                  This will permanently delete all your data. This action cannot be undone.
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
                    onClick={handleDeleteAll}
                    disabled={deleting}
                    className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Delete Everything'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-3 rounded-2xl text-red-500 text-sm font-medium hover:bg-red-500/10 transition-colors border border-neutral-200 dark:border-neutral-800"
              >
                Delete All Data
              </button>
            )}
          </div>
        </div>

        {/* Version */}
        <div className="text-center pt-8">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">Recap v1.0.0</p>
          <p className="text-xs text-neutral-300 dark:text-neutral-600 mt-1">Conversation Intelligence</p>
        </div>
      </div>
    </div>
  )
}
