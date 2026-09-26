import React, { Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { useAuthFetch } from './lib/authFetch'
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp } from '@clerk/clerk-react'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Lazy-loaded pages
const Feed = React.lazy(() => import('./pages/Feed'))
const People = React.lazy(() => import('./pages/People'))
const Insights = React.lazy(() => import('./pages/Insights'))
const Report = React.lazy(() => import('./pages/Report'))
const Settings = React.lazy(() => import('./pages/Settings'))
const Recording = React.lazy(() => import('./pages/Recording'))
const NoteDetail = React.lazy(() => import('./pages/NoteDetail'))
const PersonDetail = React.lazy(() => import('./pages/PersonDetail'))
const Chat = React.lazy(() => import('./pages/Chat'))
const Search = React.lazy(() => import('./pages/Search'))
const DailyBriefing = React.lazy(() => import('./pages/DailyBriefing'))
const Briefing = React.lazy(() => import('./pages/Briefing'))
const Commitments = React.lazy(() => import('./pages/Commitments'))
const Archive = React.lazy(() => import('./pages/Archive'))
const Entities = React.lazy(() => import('./pages/Entities'))

function Loading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
      <div className="w-6 h-6 border-2 border-neutral-300 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppRoutes() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Feed />} />
          <Route path="people" element={<People />} />
          <Route path="insights" element={<Insights />} />
          <Route path="report" element={<Report />} />
          <Route path="settings" element={<Settings />} />
          <Route path="recording" element={<Recording />} />
          <Route path="note/:id" element={<NoteDetail />} />
          <Route path="person/:id" element={<PersonDetail />} />
          <Route path="chat" element={<Chat />} />
          <Route path="search" element={<Search />} />
          <Route path="daily" element={<DailyBriefing />} />
          <Route path="briefing/:personId" element={<Briefing />} />
          <Route path="commitments" element={<Commitments />} />
          <Route path="archive" element={<Archive />} />
          <Route path="entities" element={<Entities />} />
        </Route>
        {CLERK_KEY && (
          <>
            <Route path="sign-in/*" element={<ClerkSignInPage />} />
            <Route path="sign-up/*" element={<ClerkSignUpPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}

function ClerkSignInPage() {
  return (
    <div className="flex items-center justify-center h-screen">
      <SignIn routing="path" path="/sign-in" />
    </div>
  )
}

function ClerkSignUpPage() {
  return (
    <div className="flex items-center justify-center h-screen">
      <SignUp routing="path" path="/sign-up" />
    </div>
  )
}

const API_BASE = import.meta.env.VITE_API_URL || ''

function UserSync() {
  const authFetch = useAuthFetch()
  useEffect(() => {
    authFetch(`${API_BASE}/api/users/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {})
  }, [authFetch])
  return null
}

export default function App() {
  if (CLERK_KEY) {
    return <AuthGuardedApp />
  }
  return <><UserSync /><AppRoutes /></>
}

function AuthGuardedApp() {
  const location = useLocation()
  const isAuthPage = location.pathname.startsWith('/sign-in') || location.pathname.startsWith('/sign-up')

  if (isAuthPage) {
    return <AppRoutes />
  }

  return (
    <>
      <SignedIn>
        <UserSync />
        <AppRoutes />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}
