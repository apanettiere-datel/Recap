import { createContext, useContext, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

const AuthFetchContext = createContext(null)

export function useAuthFetch() {
  const fn = useContext(AuthFetchContext)
  return fn || fetch.bind(window)
}

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ClerkFetchProvider({ children }) {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const navigate = useNavigate()
  const stateRef = useRef({ getToken, isSignedIn, isLoaded, navigate })
  useEffect(() => { stateRef.current = { getToken, isSignedIn, isLoaded, navigate } })

  const authFetch = useCallback(async (url, options = {}) => {
    const { getToken: gt, isSignedIn: si, isLoaded: il, navigate: nav } = stateRef.current
    if (!il) throw new Error('Auth loading')
    if (!si) { nav('/sign-in'); throw new Error('Not signed in') }
    let token = null
    try { token = await gt() } catch (e) { console.error('[authFetch] getToken() threw:', e) }
    if (!token) throw new Error('Auth token unavailable')
    const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } })
    if (response.status === 401) console.error(`[authFetch] 401 from ${url}`)
    return response
  }, [])

  return <AuthFetchContext.Provider value={authFetch}>{children}</AuthFetchContext.Provider>
}

function devFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer dev-token' },
  })
}

export function AuthFetchProvider({ children }) {
  if (!CLERK_KEY) return <AuthFetchContext.Provider value={devFetch}>{children}</AuthFetchContext.Provider>
  return <ClerkFetchProvider>{children}</ClerkFetchProvider>
}
