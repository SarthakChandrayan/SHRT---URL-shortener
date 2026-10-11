import { createAuthClient } from '@neondatabase/neon-js/auth'
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla'

const NEON_AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL?.trim()

if (!NEON_AUTH_URL && import.meta.env.DEV) {
  console.warn(
    'VITE_NEON_AUTH_URL is not set — sign in / sign up will not work. See frontend/.env.example.',
  )
}

let cachedJwt: string | null = null

function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3
}

function isJwtExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) {
      return true
    }
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number
    }
    if (typeof json.exp !== 'number') {
      return false
    }
    // Refresh a few seconds early so we don't send a token that's about to die.
    return json.exp * 1000 <= Date.now() + 15_000
  } catch {
    return true
  }
}

function rememberJwt(token: string | null | undefined) {
  if (token && looksLikeJwt(token) && !isJwtExpired(token)) {
    cachedJwt = token
  }
}

function jwtFromResponse(response: Response | undefined) {
  const header = response?.headers.get('set-auth-jwt')
  rememberJwt(header)
}

// The frontend (Vite) and the Neon Auth service live on different origins,
// so the session cookie has to be explicitly sent/accepted cross-site.
export const authClient = createAuthClient(NEON_AUTH_URL ?? '', {
  adapter: BetterAuthVanillaAdapter({
    fetchOptions: {
      credentials: 'include',
      onSuccess: (ctx) => {
        jwtFromResponse(ctx.response)
        rememberJwt(
          ctx.data &&
            typeof ctx.data === 'object' &&
            'session' in ctx.data &&
            ctx.data.session &&
            typeof ctx.data.session === 'object' &&
            'token' in ctx.data.session
            ? String(ctx.data.session.token ?? '')
            : null,
        )
      },
    },
  }),
})

export async function getAccessToken(): Promise<string | null> {
  if (cachedJwt && !isJwtExpired(cachedJwt)) {
    return cachedJwt
  }

  try {
    const { data } = await authClient.getSession()
    rememberJwt(data?.session?.token)
    if (cachedJwt && !isJwtExpired(cachedJwt)) {
      return cachedJwt
    }
  } catch {
    // Fall through to the JWT plugin endpoint.
  }

  try {
    const { data } = await authClient.token()
    rememberJwt(data?.token)
  } catch {
    cachedJwt = null
  }

  return cachedJwt && !isJwtExpired(cachedJwt) ? cachedJwt : null
}

export function clearAccessToken() {
  cachedJwt = null
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  account_not_linked:
    'This email already has a SHRT account that was created with a password and never verified. Sign in with your password below, or use “Forgot password?” to set a new one. Either way you’ll verify your email, and after that Continue with Google will work too.',
  access_denied: 'Google sign-in was cancelled.',
  email_not_found: 'Google didn’t share an email address for this account.',
}

/**
 * Better Auth sends OAuth failures back as `?error=<code>` on the callback
 * URL. Reads it, strips it from the address bar, and returns a readable
 * message (or null when there's no error).
 */
let takenOAuthError: string | null | undefined

export function takeOAuthError(): string | null {
  // Idempotent: StrictMode calls state initializers twice, and the first
  // call has already cleaned the URL.
  if (takenOAuthError !== undefined) {
    return takenOAuthError
  }

  const url = new URL(window.location.href)
  const code = url.searchParams.get('error')

  if (!code) {
    takenOAuthError = null
    return null
  }

  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)

  takenOAuthError =
    OAUTH_ERROR_MESSAGES[code.toLowerCase()] ??
    `Google sign-in didn’t complete (${code.replaceAll('_', ' ')}). Try again, or use email and password.`
  return takenOAuthError
}
