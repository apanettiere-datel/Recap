import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import AuthProvider from './lib/AuthProvider'
import { AuthFetchProvider } from './lib/authFetch'
import { toast } from './lib/toast'
import { Toaster } from './components/Toaster'
import App from './App'
import './app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      // Retry transient failures only; a 404 or 403 won't fix itself
      retry: (failureCount, error) => failureCount < 2 && (error?.retryable ?? true),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
    },
  },
  // Every failed action tells the user, instead of silently doing nothing
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      toast.error(error?.message || 'Something went wrong. Please try again.')
    },
  }),
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthFetchProvider>
          <QueryClientProvider client={queryClient}>
            <App />
            <Toaster />
          </QueryClientProvider>
        </AuthFetchProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
