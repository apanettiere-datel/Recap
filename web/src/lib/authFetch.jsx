/* eslint-disable react-refresh/only-export-components -- context module: hooks and provider live together */
import { createContext, useContext, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

const AuthFetchContext = createContext(null)
const AuthHeadersContext = createContext(null)

const defaultFetch = (...args) => fetch(...args)

export function useAuthFetch() {
  const fn = useContext(AuthFetchContext)
  return fn || defaultFetch
}

const noHeaders = () => ({})

/** Resolves the Authorization header, for requests not made through fetch (e.g. XHR uploads). */
export function useAuthHeaders() {
  return useContext(AuthHeadersContext) || noHeaders
}

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ClerkFetchProvider({ children }) {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const navigate = useNavigate()
  const stateRef = useRef({ getToken, isSignedIn, isLoaded, navigate })
  useEffect(() => { stateRef.current = { getToken, isSignedIn, isLoaded, navigate } })

  const getHeaders = useCallback(async () => {
    const { getToken: gt, isSignedIn: si, isLoaded: il, navigate: nav } = stateRef.current
    if (!il) throw new Error('Still signing you in. Please try again in a moment.')
    if (!si) { nav('/sign-in'); throw new Error('Please sign in again.') }
    let token = null
    try { token = await gt() } catch (e) { console.error('[authFetch] getToken() threw:', e) }
    if (!token) throw new Error('Your session could not be verified. Please sign in again.')
    return { Authorization: `Bearer ${token}` }
  }, [])

  const authFetch = useCallback(async (url, options = {}) => {
    const auth = await getHeaders()
    const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), ...auth } })
    if (response.status === 401) console.error(`[authFetch] 401 from ${url}`)
    return response
  }, [getHeaders])

  return (
    <AuthHeadersContext.Provider value={getHeaders}>
      <AuthFetchContext.Provider value={authFetch}>{children}</AuthFetchContext.Provider>
    </AuthHeadersContext.Provider>
  )
}

function devFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer dev-token' },
  })
}
const devHeaders = () => ({ Authorization: 'Bearer dev-token' })

export function AuthFetchProvider({ children }) {
  if (!CLERK_KEY) {
    return (
      <AuthHeadersContext.Provider value={devHeaders}>
        <AuthFetchContext.Provider value={devFetch}>{children}</AuthFetchContext.Provider>
      </AuthHeadersContext.Provider>
    )
  }
  return <ClerkFetchProvider>{children}</ClerkFetchProvider>
}
