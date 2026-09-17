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

export type EmailAuthResult =
  | { kind: 'ok' }
  | { kind: 'needs-verification' }
  | { kind: 'error'; message: string }

export type VerifyEmailResult =
  | { kind: 'signed-in' }
  | { kind: 'verified' }
  | { kind: 'error'; message: string }

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<EmailAuthResult>
  signInWithEmail: (email: string, password: string) => Promise<EmailAuthResult>
  verifyEmailOtp: (email: string, otp: string) => Promise<VerifyEmailResult>
  resendVerificationEmail: (email: string) => Promise<string | null>
  signInWithGoogle: () => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function errorMessage(error: { message?: string } | null | undefined, fallback: string) {
  return error?.message?.trim() || fallback
}

function isUnverifiedEmailError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) {
    return false
  }

  const code = error.code?.toUpperCase() ?? ''
  const message = error.message?.toLowerCase() ?? ''
  return (
    code.includes('EMAIL_NOT_VERIFIED') ||
    message.includes('email not verified') ||
    message.includes('verify your email')
  )
}

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
        return true
      }
      setUser(null)
      setStatus('unauthenticated')
      return false
    } catch {
      setUser(null)
      setStatus('unauthenticated')
      return false
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function signUpWithEmail(
    name: string,
    email: string,
    password: string,
  ): Promise<EmailAuthResult> {
    try {
      const result = await authClient.signUp.email({
        name: name.trim() || email.split('@')[0] || 'User',
        email,
        password,
      })
      if (result.error) {
        return { kind: 'error', message: errorMessage(result.error, 'Could not create your account') }
      }
      if (result.data?.user?.emailVerified) {
        await refresh()
        return { kind: 'ok' }
      }
      return { kind: 'needs-verification' }
    } catch {
      return { kind: 'error', message: 'Could not reach the sign-up service' }
    }
  }

  async function signInWithEmail(email: string, password: string): Promise<EmailAuthResult> {
    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        if (isUnverifiedEmailError(result.error)) {
          return { kind: 'needs-verification' }
        }
        return { kind: 'error', message: errorMessage(result.error, 'Could not sign in') }
      }
      await refresh()
      return { kind: 'ok' }
    } catch {
      return { kind: 'error', message: 'Could not reach the sign-in service' }
    }
  }

  async function verifyEmailOtp(email: string, otp: string): Promise<VerifyEmailResult> {
    try {
      const result = await authClient.emailOtp.verifyEmail({ email, otp })
      if (result.error) {
        return { kind: 'error', message: errorMessage(result.error, 'That code did not work') }
      }
      const signedIn = await refresh()
      return signedIn ? { kind: 'signed-in' } : { kind: 'verified' }
    } catch {
      return { kind: 'error', message: 'Could not verify that code' }
    }
  }

  async function resendVerificationEmail(email: string) {
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: window.location.origin + '/',
      })
      if (result.error) {
        return errorMessage(result.error, 'Could not send a new code')
      }
      return null
    } catch {
      return 'Could not send a new code'
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
        verifyEmailOtp,
        resendVerificationEmail,
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
