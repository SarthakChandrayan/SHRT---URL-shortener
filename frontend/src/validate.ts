const MAX_URL_LENGTH = 2048

export function validateOriginalUrl(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return 'Enter a destination URL'
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return 'URL must be 2048 characters or fewer'
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    return 'Enter a valid URL'
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only HTTP and HTTPS URLs are supported'
  }

  if (!url.hostname || /\s/.test(url.hostname)) {
    return 'Enter a valid HTTP or HTTPS URL'
  }

  return null
}

export function parseExpiresInput(
  value: string,
): { error: string } | { expiresAt: string | null } {
  const trimmed = value.trim()

  if (!trimmed) {
    return { expiresAt: null }
  }

  const ms = Date.parse(trimmed)

  if (Number.isNaN(ms)) {
    return { error: 'Enter a valid expiration date' }
  }

  if (ms <= Date.now()) {
    return { error: 'Expiration must be in the future' }
  }

  return { expiresAt: new Date(ms).toISOString() }
}
