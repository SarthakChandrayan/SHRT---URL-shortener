import type { DateRange } from './api.ts'

export const RANGE_OPTIONS = [7, 30, 90] as const
export type RangeDays = (typeof RANGE_OPTIONS)[number]

/** Series colors, validated for CVD separation and contrast on the dark surface. */
export const SERIES = {
  clicks: { label: 'Clicks', color: '#1fa2b5' },
  visitors: { label: 'Unique visitors', color: '#dc7331' },
} as const

function localIsoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The last `days` calendar days ending today, in the viewer's local time. */
export function lastDays(days: number): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return { startDate: localIsoDay(start), endDate: localIsoDay(end) }
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** 1,284 stays exact; 12,900 → 12.9K. */
export function formatCount(value: number): string {
  return Math.abs(value) < 10_000 ? value.toLocaleString() : compact.format(value)
}

export type Delta =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'change'; percent: number; direction: 'up' | 'down' | 'flat' }

/** Change vs the previous period; "new" when there was nothing before. */
export function delta(current: number, previous: number): Delta {
  if (previous === 0) {
    return current > 0 ? { kind: 'new' } : { kind: 'none' }
  }

  const percent = Math.round(((current - previous) / previous) * 100)
  return {
    kind: 'change',
    percent: Math.abs(percent),
    direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
  }
}

function parseDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function formatDay(isoDay: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(parseDay(isoDay))
}

export function formatRange(range: DateRange): string {
  const sameYear = range.startDate.slice(0, 4) === range.endDate.slice(0, 4)
  const start = formatDay(range.startDate, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
  const end = formatDay(range.endDate, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} – ${end}`
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM'
  const value = hour % 12 === 0 ? 12 : hour % 12
  return `${value} ${suffix}`
}

/** Human labels for stored analytics values. */
export function breakdownLabel(label: string): string {
  switch (label) {
    case 'unknown':
      return 'Unidentified'
    case 'local':
      return 'This device'
    case 'desktop':
    case 'mobile':
    case 'tablet':
      return label[0].toUpperCase() + label.slice(1)
    default:
      return label
  }
}
