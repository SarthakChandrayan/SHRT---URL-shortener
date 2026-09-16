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
