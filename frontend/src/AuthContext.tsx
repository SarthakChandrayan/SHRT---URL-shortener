import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { authClient, clearAccessToken } from './auth.ts'

export type AuthUser = {
  id: string
  email: string
  name: string | null
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<string | null>
  signInWithEmail: (email: string, password: string) => Promise<string | null>
  signInWithGoogle: () => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await authClient.getSession()
      if (data?.session && data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name ?? null,
        })
        setStatus('authenticated')
      } else {
        setUser(null)
        setStatus('unauthenticated')
      }
    } catch {
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function signUpWithEmail(name: string, email: string, password: string) {
    try {
      const result = await authClient.signUp.email({
        name: name.trim() || email.split('@')[0] || 'User',
        email,
        password,
      })
      if (result.error) {
        return result.error.message ?? 'Could not create your account'
      }
      await refresh()
      return null
    } catch {
      return 'Could not reach the sign-up service'
    }
  }

  async function signInWithEmail(email: string, password: string) {
    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        return result.error.message ?? 'Could not sign in'
      }
      await refresh()
      return null
    } catch {
      return 'Could not reach the sign-in service'
    }
  }

  async function signInWithGoogle() {
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: window.location.href,
      })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not sign in with Google'
    }
  }

  async function signOut() {
    try {
      await authClient.signOut()
    } finally {
      clearAccessToken()
      setUser(null)
      setStatus('unauthenticated')
    }
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
