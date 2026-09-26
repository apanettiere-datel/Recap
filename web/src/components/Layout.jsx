import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import { UserButton } from '@clerk/clerk-react'
import ErrorBoundary from './ErrorBoundary'
import PendingRecordings from './PendingRecordings'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const primaryNav = [
  { to: '/', label: 'Conversations', short: 'Home', icon: HomeIcon },
  { to: '/search', label: 'Search', short: 'Search', icon: SearchIcon, hint: '/' },
  { to: '/commitments', label: 'Commitments', short: 'To-dos', icon: CheckIcon },
  { to: '/people', label: 'People', short: 'People', icon: PeopleIcon },
]

const secondaryNav = [
  { to: '/entities', label: 'Organizations', icon: BuildingIcon },
  { to: '/insights', label: 'Insights', icon: InsightsIcon },
  { to: '/report', label: 'Weekly report', icon: ReportIcon },
  { to: '/archive', label: 'Archive', icon: ArchiveIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function Layout() {
  const { appearance, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const [moreOpen, setMoreOpen] = useState(false)
  const onRecording = location.pathname === '/recording'

  // Close the "More" sheet on navigation
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMoreOpen(false)
  }

  // Keyboard shortcuts: "/" or Cmd/Ctrl+K opens search
  useEffect(() => {
    const onKey = (e) => {
      if (onRecording) return
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(document.activeElement)
      if (cmdK || slash) {
        e.preventDefault()
        navigate('/search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onRecording])

  const secondaryActive = secondaryNav.some((n) => location.pathname.startsWith(n.to))

  return (
    <div className="flex h-[100dvh] w-full bg-neutral-50 dark:bg-black text-neutral-900 dark:text-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <div className="px-5 pt-5 pb-4 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-orange-400 flex items-center justify-center">
            <MicIcon className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Recap</span>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => navigate('/recording')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold shadow-sm shadow-red-500/20 transition-colors active:scale-[.98]"
          >
            <span className="w-2 h-2 rounded-full bg-white" />
            New recording
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
          {primaryNav.map((item) => <SidebarLink key={item.to} {...item} />)}
          <div className="pt-4 pb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">More</div>
          {secondaryNav.map((item) => <SidebarLink key={item.to} {...item} />)}
        </nav>

        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            {appearance === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
            {appearance === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {CLERK_KEY && <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain md:pb-0 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]">
        {!online && (
          <div className="bg-neutral-900 text-white dark:bg-neutral-800 text-xs text-center px-4 py-2">
            You&apos;re offline. Recordings are saved on this device and can be uploaded when you reconnect.
          </div>
        )}
        {!onRecording && <PendingRecordings />}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Mobile tab bar */}
      {!onRecording && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-xl safe-area-bottom">
          <div className="flex items-end h-[4.25rem]">
            <TabLink {...primaryNav[0]} />
            <TabLink {...primaryNav[1]} />
            <div className="flex-1 flex justify-center">
              <button
                type="button"
                onClick={() => navigate('/recording')}
                className="-mt-5 w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 flex items-center justify-center active:scale-95 transition ring-4 ring-neutral-50 dark:ring-black"
                aria-label="New recording"
              >
                <MicIcon className="w-6 h-6" />
              </button>
            </div>
            <TabLink {...primaryNav[3]} />
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 h-full text-[10px] font-medium ${
                secondaryActive || location.pathname === '/commitments' ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              <MoreIcon className="w-6 h-6" />
              More
            </button>
          </div>
        </nav>
      )}

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex items-end bg-black/40 animate-[fadeIn_.15s_ease-out]" onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-3xl bg-white dark:bg-neutral-900 p-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-[slideUp_.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto mb-3" />
            {[primaryNav[2], ...secondaryNav].map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] ${
                  isActive ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'text-neutral-800 dark:text-neutral-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                {label}
              </NavLink>
            ))}
            <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between px-4 py-2">
              <button type="button" onClick={toggle} className="flex items-center gap-3 text-[15px] text-neutral-800 dark:text-neutral-200">
                {appearance === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                {appearance === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              {CLERK_KEY && <UserButton />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-neutral-300 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function SidebarLink({ to, label, icon: Icon, hint }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-900 dark:text-white'
            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-800 dark:hover:text-neutral-200'
        }`
      }
    >
      <Icon className="w-[18px] h-[18px]" />
      <span className="flex-1">{label}</span>
      {hint && <kbd className="text-[10px] font-sans px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-400">{hint}</kbd>}
    </NavLink>
  )
}

function TabLink({ to, short, icon: Icon }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center justify-center gap-1 h-full text-[10px] font-medium ${
          isActive ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
        }`
      }
    >
      <Icon className="w-6 h-6" />
      {short}
    </NavLink>
  )
}

/* ---------- Icons ---------- */

function Svg({ className, children }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function HomeIcon({ className }) {
  return <Svg className={className}><path d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></Svg>
}

function SearchIcon({ className }) {
  return <Svg className={className}><path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></Svg>
}

function CheckIcon({ className }) {
  return <Svg className={className}><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></Svg>
}

function PeopleIcon({ className }) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <circle cx="17" cy="9" r="3" />
      <path d="M21 21v-1.5a3 3 0 0 0-3-3h-.5" />
    </Svg>
  )
}

function BuildingIcon({ className }) {
  return <Svg className={className}><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></Svg>
}

function InsightsIcon({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </Svg>
  )
}

function ReportIcon({ className }) {
  return (
    <Svg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </Svg>
  )
}

function ArchiveIcon({ className }) {
  return <Svg className={className}><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></Svg>
}

function SettingsIcon({ className }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
    </Svg>
  )
}

function MoreIcon({ className }) {
  return <Svg className={className}><path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></Svg>
}

function MicIcon({ className }) {
  return <Svg className={className}><path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></Svg>
}

function SunIcon({ className }) {
  return <Svg className={className}><path d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></Svg>
}

function MoonIcon({ className }) {
  return <Svg className={className}><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></Svg>
}
