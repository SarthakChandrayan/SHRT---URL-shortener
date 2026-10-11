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

export const ALIAS_MIN_LENGTH = 3
export const ALIAS_MAX_LENGTH = 32

// Keep in sync with backend/src/alias.ts. The server is the source of truth
// (it also rejects reserved words); this just gives instant feedback.
export function validateAlias(value: string): string | null {
  const alias = value.trim()

  if (!alias) {
    return null
  }

  if (alias.length < ALIAS_MIN_LENGTH || alias.length > ALIAS_MAX_LENGTH) {
    return `Alias must be ${ALIAS_MIN_LENGTH}–${ALIAS_MAX_LENGTH} characters`
  }

  if (!/^[A-Za-z0-9_-]+$/.test(alias)) {
    return 'Use letters, numbers, hyphens and underscores only'
  }

  return null
}
