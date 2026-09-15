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
