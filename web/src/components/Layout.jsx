import { NavLink, Outlet } from 'react-router-dom'
import { useTheme } from '@/lib/theme'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const navItems = [
  { to: '/', label: 'Feed', icon: FeedIcon },
  { to: '/people', label: 'People', icon: PeopleIcon },
  { to: '/insights', label: 'Insights', icon: InsightsIcon },
  { to: '/report', label: 'Report', icon: ReportIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function Layout() {
  const { theme, mode, appearance, toggle } = useTheme()

  return (
    <div className="flex h-screen w-screen bg-neutral-100 dark:bg-black text-neutral-900 dark:text-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="p-5 pb-2">
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">Recap</h1>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
          <button
            onClick={toggle}
            className="flex items-center gap-2 text-xs cursor-pointer text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            {appearance === 'dark' ? '☀ Light mode' : '● Dark mode'}
          </button>
          {CLERK_KEY && <ClerkUser theme={theme} />}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto md:pb-0 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 flex border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 safe-area-bottom">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-neutral-400 dark:text-neutral-500'
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function ClerkUser({ theme }) {
  let UserButton
  try {
    ;({ UserButton } = require('@clerk/clerk-react'))
  } catch {
    return null
  }
  return (
    <div className="mt-3">
      <UserButton
        appearance={{
          elements: { avatarBox: { width: 28, height: 28 } },
        }}
      />
    </div>
  )
}

/* ---------- Icons (simple SVG) ---------- */

function FeedIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="4" rx="1" />
      <rect x="14" y="10" width="7" height="7" rx="1" />
      <rect x="3" y="13" width="7" height="4" rx="1" />
      <line x1="3" y1="20" x2="10" y2="20" />
      <line x1="14" y1="20" x2="21" y2="20" />
    </svg>
  )
}

function PeopleIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <circle cx="17" cy="9" r="3" />
      <path d="M21 21v-1.5a3 3 0 0 0-3-3h-.5" />
    </svg>
  )
}

function InsightsIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <line x1="10" y1="24" x2="14" y2="24" />
    </svg>
  )
}

function ReportIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  )
}

function SettingsIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
    </svg>
  )
}
