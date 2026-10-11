export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

export function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now())
}

export function formatWhen(iso: string | null): string {
  if (!iso) {
    return 'never'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 hours ago", "in 2 days", "just now". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000

  if (Math.abs(seconds) < 45) {
    return 'just now'
  }

  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'minute') {
      return relativeFormatter.format(Math.round(seconds / size), unit)
    }
  }

  return 'just now'
}

export function toDatetimeLocal(iso: string | null): string {
  if (!iso) {
    return ''
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export type ExpiryPreset = 'never' | '1h' | '1d' | '7d' | '30d' | 'custom'

export const EXPIRY_PRESETS: Array<{ value: ExpiryPreset; label: string }> = [
  { value: 'never', label: 'Never' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
]

const PRESET_MS: Record<Exclude<ExpiryPreset, 'never' | 'custom'>, number> = {
  '1h': 3600_000,
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}

/** Resolves a preset (or a datetime-local value for "custom") to an ISO date. */
export function resolveExpiry(
  preset: ExpiryPreset,
  custom: string,
): { expiresAt: string | null } | { error: string } {
  if (preset === 'never') {
    return { expiresAt: null }
  }

  if (preset !== 'custom') {
    return { expiresAt: new Date(Date.now() + PRESET_MS[preset]).toISOString() }
  }

  if (!custom.trim()) {
    return { error: 'Pick an expiration date' }
  }

  const ms = Date.parse(custom)

  if (Number.isNaN(ms)) {
    return { error: 'Enter a valid expiration date' }
  }

  if (ms <= Date.now()) {
    return { error: 'Expiration must be in the future' }
  }

  return { expiresAt: new Date(ms).toISOString() }
}

/** Last `days` days ending today, as UTC YYYY-MM-DD (what the API expects). */
export function utcRange(days: number): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
