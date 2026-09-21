import { getAccessToken } from './auth.ts'

export type CreatedUrl = {
  id: string
  originalUrl: string
  shortCode: string
  createdAt: string
  expiresAt: string | null
}

export type ClickBreakdown = {
  label: string
  count: number
}

export type UrlAnalytics = {
  devices: ClickBreakdown[]
  browsers: ClickBreakdown[]
  operatingSystems: ClickBreakdown[]
  referrers: ClickBreakdown[]
  countries: ClickBreakdown[]
}

export type UrlStats = CreatedUrl & {
  clickCount: number
  lastClickedAt: string | null
  analytics: UrlAnalytics
}

export type DailyClicks = {
  date: string
  clicks: number
}

export type UrlClicksOverTime = {
  startDate: string
  endDate: string
  data: DailyClicks[]
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
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ originalUrl }),
  })

  if (!isCreatedUrl(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

let listUrlsInflight: Promise<UrlStats[]> | null = null

export function listUrls(): Promise<UrlStats[]> {
  if (listUrlsInflight) {
    return listUrlsInflight
  }

  listUrlsInflight = (async () => {
    try {
      const payload = await requestJson('/api/urls', {
        cache: 'no-store',
        headers: await authHeader(),
      })

      if (!Array.isArray(payload) || !payload.every(isUrlStats)) {
        throw new ApiError('Unexpected response from the server')
      }

      return payload
    } finally {
      listUrlsInflight = null
    }
  })()

  return listUrlsInflight
}

export async function getUrlAnalytics(id: string, init?: RequestInit): Promise<UrlClicksOverTime> {
  const { headers, ...rest } = init ?? {}
  const payload = await requestJson(`/api/urls/${encodeURIComponent(id)}/analytics`, {
    cache: 'no-store',
    ...rest,
    headers: { ...(await authHeader()), ...headers },
  })

  if (!isUrlClicksOverTime(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

export async function updateUrlExpiration(
  id: string,
  expiresAt: string | null,
): Promise<CreatedUrl> {
  const payload = await requestJson(`/api/urls/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ expiresAt }),
  })

  if (!isCreatedUrl(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

async function authHeader(): Promise<HeadersInit> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response

  try {
    response = await fetch(apiUrl(path), init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }

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
    return readErrorMessage(payload) ?? 'The shortening service could not be found'
  }

  if (status === 410) {
    return 'This short URL has expired'
  }

  if (status === 400) {
    return readErrorMessage(payload) ?? 'Enter a valid HTTP or HTTPS URL'
  }

  if (status === 401) {
    return readErrorMessage(payload) ?? 'Sign in to continue'
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
    (record.lastClickedAt === null || typeof record.lastClickedAt === 'string') &&
    isUrlAnalytics(record.analytics)
  )
}

function isUrlAnalytics(value: unknown): value is UrlAnalytics {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    isBreakdownList(record.devices) &&
    isBreakdownList(record.browsers) &&
    isBreakdownList(record.operatingSystems) &&
    isBreakdownList(record.referrers) &&
    isBreakdownList(record.countries)
  )
}

function isUrlClicksOverTime(value: unknown): value is UrlClicksOverTime {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.startDate === 'string' &&
    typeof record.endDate === 'string' &&
    Array.isArray(record.data) &&
    record.data.every(isDailyClicks)
  )
}

function isDailyClicks(value: unknown): value is DailyClicks {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as DailyClicks).date === 'string' &&
    typeof (value as DailyClicks).clicks === 'number'
  )
}

function isBreakdownList(value: unknown): value is ClickBreakdown[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ClickBreakdown).label === 'string' &&
        typeof (item as ClickBreakdown).count === 'number',
    )
  )
}
