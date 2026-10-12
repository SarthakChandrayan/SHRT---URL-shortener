export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 24

// Mirrors backend/src/link-options.ts.
export function normalizeTag(value: string): string | null {
  const tag = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!tag || tag.length > MAX_TAG_LENGTH || !/^[a-z0-9][a-z0-9 _-]*$/.test(tag)) {
    return null
  }
  return tag
}
