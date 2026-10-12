import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { authClient, clearAccessToken, getAccessToken } from './auth.ts'

export type AuthUser = {
  id: string
  email: string
  name: string | null
}

export type EmailAuthResult =
  | { kind: 'ok' }
  | { kind: 'needs-verification' }
  | { kind: 'error'; message: string }

export type ResetPasswordResult =
  | { kind: 'signed-in' }
  | { kind: 'reset' }
  | { kind: 'error'; message: string }

export type DeleteAccountResult =
  | { kind: 'deleted' }
  | { kind: 'verification-sent' }
  | { kind: 'disabled' }
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
  requestPasswordReset: (email: string) => Promise<string | null>
  resetPassword: (email: string, otp: string, password: string) => Promise<ResetPasswordResult>
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>
  hasPasswordLogin: () => Promise<boolean | null>
  deleteAccount: (password: string | null) => Promise<DeleteAccountResult>
  signInWithGoogle: () => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type AuthFailure = { status: number | null; code: string; message: string }

/**
 * Neon's auth client *throws* an AuthApiError for non-2xx responses (with a
 * Supabase-style `code`, e.g. EMAIL_NOT_VERIFIED → "email_not_confirmed"),
 * while plain Better Auth returns `{ error }`. Network failures throw a
 * TypeError. This normalizes all of them; `null` means a network failure.
 */
function toFailure(error: unknown): AuthFailure | null {
  if (!error || typeof error !== 'object' || error instanceof TypeError) {
    return null
  }

  const record = error as { status?: unknown; code?: unknown; message?: unknown }
  return {
    status: typeof record.status === 'number' ? record.status : null,
    code: typeof record.code === 'string' ? record.code.toLowerCase() : '',
    message: typeof record.message === 'string' ? record.message.trim() : '',
  }
}

function errorMessage(error: unknown, fallback: string) {
  const failure = toFailure(error)
  if (!failure) {
    return 'Could not reach the sign-in service. Check your connection and try again.'
  }
  return failure.message || fallback
}

function isUnverifiedEmailError(error: unknown) {
  const failure = toFailure(error)
  if (!failure) {
    return false
  }

  const message = failure.message.toLowerCase()
  return (
    failure.code.includes('email_not_verified') ||
    failure.code.includes('email_not_confirmed') ||
    message.includes('email not verified') ||
    message.includes('email not confirmed') ||
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
    } catch (error) {
      return { kind: 'error', message: errorMessage(error, 'Could not create your account') }
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
    } catch (error) {
      if (isUnverifiedEmailError(error)) {
        return { kind: 'needs-verification' }
      }
      return { kind: 'error', message: errorMessage(error, 'Could not sign in') }
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
    } catch (error) {
      return { kind: 'error', message: errorMessage(error, 'That code did not work') }
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
    } catch (error) {
      return errorMessage(error, 'Could not send a new code')
    }
  }

  async function requestPasswordReset(email: string) {
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: 'forget-password',
      })
      if (result.error) {
        return errorMessage(result.error, 'Could not send a reset code')
      }
      return null
    } catch (error) {
      return errorMessage(error, 'Could not send a reset code')
    }
  }

  async function resetPassword(
    email: string,
    otp: string,
    password: string,
  ): Promise<ResetPasswordResult> {
    try {
      const result = await authClient.emailOtp.resetPassword({
        email: email.trim(),
        otp,
        password,
      })
      if (result.error) {
        return { kind: 'error', message: errorMessage(result.error, 'Could not reset your password') }
      }
    } catch (error) {
      return { kind: 'error', message: errorMessage(error, 'Could not reset your password') }
    }

    // Resetting also verifies the email, so signing straight in should work.
    const signIn = await signInWithEmail(email.trim(), password)
    return signIn.kind === 'ok' ? { kind: 'signed-in' } : { kind: 'reset' }
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

  async function changePassword(currentPassword: string, newPassword: string) {
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) {
        return errorMessage(result.error, 'Could not change your password')
      }
      return null
    } catch (error) {
      return errorMessage(error, 'Could not change your password')
    }
  }

  /** Whether the account has an email + password login (vs. Google only). */
  async function hasPasswordLogin() {
    try {
      const { data } = await authClient.listAccounts()
      if (!Array.isArray(data)) {
        return null
      }
      return data.some(
        (account: { providerId?: string }) => account.providerId === 'credential',
      )
    } catch {
      return null
    }
  }

  /**
   * Deletes the Neon Auth user. The caller then deletes SHRT's data with the
   * access token cached here first — it stays valid until it expires even
   * though the session is gone.
   */
  async function deleteAccount(password: string | null): Promise<DeleteAccountResult> {
    await getAccessToken()

    let result: Awaited<ReturnType<typeof authClient.deleteUser>>

    try {
      result = await authClient.deleteUser(password ? { password } : {})
    } catch (error) {
      return deleteFailure(error)
    }

    if (result.error) {
      return deleteFailure(result.error)
    }

    const message = (result.data as { message?: string } | null)?.message ?? ''
    return /verification/i.test(message) ? { kind: 'verification-sent' } : { kind: 'deleted' }
  }

  function deleteFailure(error: unknown): DeleteAccountResult {
    const failure = toFailure(error)

    // Better Auth answers 404 when account deletion isn't enabled.
    if (failure?.status === 404) {
      return { kind: 'disabled' }
    }

    if (failure?.code.includes('session_expired') || /session.*expired/i.test(failure?.message ?? '')) {
      return { kind: 'error', message: 'For your security, sign out and back in, then try again.' }
    }

    return { kind: 'error', message: errorMessage(error, 'Could not delete your account') }
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
        requestPasswordReset,
        resetPassword,
        changePassword,
        hasPasswordLogin,
        deleteAccount,
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
