export const UTM_FIELDS = [
  { key: 'utm_source', label: 'Source', placeholder: 'newsletter' },
  { key: 'utm_medium', label: 'Medium', placeholder: 'email' },
  { key: 'utm_campaign', label: 'Campaign', placeholder: 'spring-launch' },
  { key: 'utm_term', label: 'Term', placeholder: 'optional' },
  { key: 'utm_content', label: 'Content', placeholder: 'optional' },
] as const

export type UtmKey = (typeof UTM_FIELDS)[number]['key']
export type UtmParams = Partial<Record<UtmKey, string>>

export function hasUtm(params: UtmParams): boolean {
  return Object.values(params).some((value) => value?.trim())
}

/**
 * Adds UTM parameters to a URL, replacing any existing values for the same
 * keys. Returns the input unchanged if it isn't a valid URL.
 */
export function applyUtm(url: string, params: UtmParams): string {
  if (!hasUtm(params)) {
    return url
  }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return url
  }

  for (const { key } of UTM_FIELDS) {
    const value = params[key]?.trim()
    if (value) {
      parsed.searchParams.set(key, value)
    }
  }

  return parsed.href
}
