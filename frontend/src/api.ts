export type CreatedUrl = {
  id: string
  originalUrl: string
  shortCode: string
  createdAt: string
  expiresAt: string | null
}

export type UrlStats = CreatedUrl & {
  clickCount: number
  lastClickedAt: string | null
}

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function apiUrl(path: string): string {
  const origin = import.meta.env.VITE_API_ORIGIN?.trim()
  if (!origin) {
    return path
  }
  return `${trimTrailingSlash(origin)}${path}`
}

function shortOrigin(): string {
  const fromEnv = import.meta.env.VITE_SHORT_ORIGIN?.trim()
  if (fromEnv) {
    return trimTrailingSlash(fromEnv)
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }

  return ''
}

export function getShortUrl(shortCode: string): string {
  const origin = shortOrigin()
  return origin ? `${origin}/${shortCode}` : `/${shortCode}`
}

export async function createShortUrl(originalUrl: string): Promise<CreatedUrl> {
  const payload = await requestJson('/api/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalUrl }),
  })

  if (!isCreatedUrl(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

export async function listUrls(): Promise<UrlStats[]> {
  const payload = await requestJson('/api/urls', { cache: 'no-store' })

  if (!Array.isArray(payload) || !payload.every(isUrlStats)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response

  try {
    response = await fetch(apiUrl(path), init)
  } catch {
    throw new ApiError('Could not reach the server. Check that the API is running.')
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(messageForStatus(response.status, payload), response.status)
  }

  return payload
}

function messageForStatus(status: number, payload: unknown): string {
  if (status === 502 || status === 503 || status === 504) {
    return 'Could not reach the server. Check that the API is running.'
  }

  if (status >= 500) {
    return 'Something went wrong. Try again.'
  }

  if (status === 404) {
    return 'The shortening service could not be found'
  }

  if (status === 410) {
    return 'This short URL has expired'
  }

  if (status === 400) {
    return readErrorMessage(payload) ?? 'Enter a valid HTTP or HTTPS URL'
  }

  return readErrorMessage(payload) ?? 'Could not shorten this URL'
}

function readErrorMessage(payload: unknown): string | null {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string' &&
    payload.error.trim().length > 0
  ) {
    return payload.error
  }

  return null
}

function isCreatedUrl(payload: unknown): payload is CreatedUrl {
  if (payload === null || typeof payload !== 'object') {
    return false
  }

  const record = payload as Record<string, unknown>

  return (
    typeof record.id === 'string' &&
    typeof record.originalUrl === 'string' &&
    typeof record.shortCode === 'string'
  )
}

function isUrlStats(payload: unknown): payload is UrlStats {
  if (!isCreatedUrl(payload)) {
    return false
  }

  const record = payload as CreatedUrl & Record<string, unknown>

  return (
    typeof record.clickCount === 'number' &&
    (record.lastClickedAt === null || typeof record.lastClickedAt === 'string')
  )
}
