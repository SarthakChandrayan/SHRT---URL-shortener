import type { UrlStats } from './api.ts'
import { isExpired } from './format.ts'

const COLUMNS = [
  'short_url',
  'alias',
  'destination',
  'tags',
  'clicks',
  'click_limit',
  'password_protected',
  'status',
  'created_at',
  'expires_at',
  'last_clicked_at',
] as const

/**
 * Quotes a CSV cell. Values starting with = + - @ are prefixed with ' so
 * spreadsheet apps don't execute them as formulas (CSV injection).
 */
function cell(value: string | number | boolean | null): string {
  if (value === null) {
    return ''
  }

  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }

  return /[",\n\r]/.test(text) || text !== String(value) ? `"${text.replaceAll('"', '""')}"` : text
}

export function linksToCsv(urls: UrlStats[], shortUrl: (code: string) => string): string {
  const rows = urls.map((url) => {
    const limitReached = url.maxClicks !== null && url.clickCount >= url.maxClicks
    const status = isExpired(url.expiresAt) ? 'expired' : limitReached ? 'limit_reached' : 'active'

    return [
      shortUrl(url.shortCode),
      url.shortCode,
      url.originalUrl,
      url.tags.join(' | '),
      url.clickCount,
      url.maxClicks,
      url.hasPassword,
      status,
      url.createdAt,
      url.expiresAt,
      url.lastClickedAt,
    ]
      .map(cell)
      .join(',')
  })

  // BOM so Excel opens UTF-8 correctly.
  return `﻿${[COLUMNS.join(','), ...rows].join('\r\n')}\r\n`
}
