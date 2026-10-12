import { getAccessToken } from './auth.ts'

export type CreatedUrl = {
  id: string
  originalUrl: string
  shortCode: string
  createdAt: string
  expiresAt: string | null
  tags: string[]
  maxClicks: number | null
  hasPassword: boolean
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

export type DeviceClicks = {
  deviceType: string
  clicks: number
}

export type UrlClicksOverTime = {
  startDate: string
  endDate: string
  data: DailyClicks[]
  devices: DeviceClicks[]
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

  // Production links use this site. Vercel proxies /:shortCode to the backend.
  return window.location.origin
}

/** e.g. "shrt.example.com/" — shown in front of the custom-alias field. */
export function getShortPrefix(): string {
  return `${shortOrigin().replace(/^https?:\/\//, '')}/`
}

export function getShortUrl(shortCode: string): string {
  const origin = shortOrigin()
  return origin ? `${origin}/${shortCode}` : `/${shortCode}`
}

export type CreateUrlOptions = {
  alias?: string | null
  expiresAt?: string | null
  tags?: string[]
  password?: string | null
  maxClicks?: number | null
}

export async function createShortUrl(
  originalUrl: string,
  options: CreateUrlOptions = {},
): Promise<CreatedUrl> {
  const payload = await requestJson('/api/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      originalUrl,
      alias: options.alias?.trim() || undefined,
      expiresAt: options.expiresAt ?? undefined,
      tags: options.tags?.length ? options.tags : undefined,
      password: options.password || undefined,
      maxClicks: options.maxClicks ?? undefined,
    }),
  })

  if (!isCreatedUrl(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return withLinkDefaults(payload)
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

      return payload.map(withLinkDefaults)
    } finally {
      listUrlsInflight = null
    }
  })()

  return listUrlsInflight
}

export async function getUrlAnalytics(
  id: string,
  range: { startDate: string; endDate: string } | null,
  init?: RequestInit,
): Promise<UrlClicksOverTime> {
  const { headers, ...rest } = init ?? {}
  const query = range
    ? `?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`
    : ''
  const payload = await requestJson(`/api/urls/${encodeURIComponent(id)}/analytics${query}`, {
    cache: 'no-store',
    ...rest,
    headers: { ...(await authHeader()), ...headers },
  })

  if (!isUrlClicksOverTime(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload
}

export type UrlPatch = {
  originalUrl?: string
  expiresAt?: string | null
  tags?: string[]
  /** A new password, or `null` to remove protection. */
  password?: string | null
  maxClicks?: number | null
}

export async function updateUrl(id: string, patch: UrlPatch): Promise<CreatedUrl> {
  const payload = await requestJson(`/api/urls/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(patch),
  })

  if (!isCreatedUrl(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return withLinkDefaults(payload)
}

export type ApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const payload = await requestJson('/api/account/keys', {
    cache: 'no-store',
    headers: await authHeader(),
  })

  if (!Array.isArray(payload)) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload as ApiKey[]
}

/** Returns the new key's plaintext value — the only time it's available. */
export async function createApiKey(name: string): Promise<ApiKey & { key: string }> {
  const payload = await requestJson('/api/account/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ name }),
  })

  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof (payload as { key?: unknown }).key !== 'string'
  ) {
    throw new ApiError('Unexpected response from the server')
  }

  return payload as ApiKey & { key: string }
}

export async function revokeApiKey(id: string): Promise<void> {
  await requestJson(`/api/account/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
}

/** Downloads everything stored about the account as a JSON file. */
export async function downloadAccountExport(): Promise<void> {
  const payload = await requestJson('/api/account/export', {
    cache: 'no-store',
    headers: await authHeader(),
  })

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `shrt-export-${new Date().toISOString().slice(0, 10)}.json`)
}

/** Deletes the account's links, clicks, and API keys from the SHRT API. */
export async function deleteAccountData(): Promise<void> {
  await requestJson('/api/account', {
    method: 'DELETE',
    headers: await authHeader(),
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function deleteUrl(id: string): Promise<void> {
  await requestJson(`/api/urls/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
}

export type AliasAvailability = { available: true } | { available: false; reason: string }

export async function checkAliasAvailability(
  alias: string,
  init?: RequestInit,
): Promise<AliasAvailability> {
  const { headers, ...rest } = init ?? {}
  const payload = await requestJson(
    `/api/urls/alias-availability?alias=${encodeURIComponent(alias)}`,
    { cache: 'no-store', ...rest, headers: { ...(await authHeader()), ...headers } },
  )

  if (payload !== null && typeof payload === 'object' && 'available' in payload) {
    const record = payload as { available: unknown; reason?: unknown }
    if (record.available === true) {
      return { available: true }
    }
    return {
      available: false,
      reason: typeof record.reason === 'string' ? record.reason : 'Unavailable',
    }
  }

  throw new ApiError('Unexpected response from the server')
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

  if (response.status === 204) {
    return null
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
    return readErrorMessage(payload) ?? 'Not found'
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

  if (status === 403) {
    return readErrorMessage(payload) ?? 'You don’t have access to do that'
  }

  if (status === 409) {
    return readErrorMessage(payload) ?? 'That alias is already taken'
  }

  if (status === 429) {
    return 'Too many requests. Wait a moment and try again.'
  }

  return readErrorMessage(payload) ?? 'Something went wrong. Try again.'
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

/** Tolerates an older API that doesn't return the newer link fields yet. */
function withLinkDefaults<T extends CreatedUrl>(url: T): T {
  return {
    ...url,
    tags: Array.isArray(url.tags) ? url.tags : [],
    maxClicks: typeof url.maxClicks === 'number' ? url.maxClicks : null,
    hasPassword: url.hasPassword === true,
  }
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
    record.data.every(isDailyClicks) &&
    Array.isArray(record.devices) &&
    record.devices.every(isDeviceClicks)
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

function isDeviceClicks(value: unknown): value is DeviceClicks {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as DeviceClicks).deviceType === 'string' &&
    typeof (value as DeviceClicks).clicks === 'number'
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
