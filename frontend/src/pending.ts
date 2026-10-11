import { EXPIRY_PRESETS, type ExpiryPreset } from './format.ts'

// A shorten request made while signed out, resumed after sign-in — even
// across a full-page Google OAuth redirect.
const PENDING_KEY = 'shrt:pendingShorten'

export type PendingShorten = {
  url: string
  alias: string
  preset: ExpiryPreset
  custom: string
}

export function savePending(pending: PendingShorten) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Storage can be unavailable (private mode); they'll just resubmit.
  }
}

export function clearPending() {
  try {
    window.sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export function readPending(): PendingShorten | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY)
    if (!raw) {
      return null
    }

    const value = JSON.parse(raw) as Partial<PendingShorten>
    if (typeof value.url !== 'string' || !value.url) {
      return null
    }

    const preset = EXPIRY_PRESETS.some((item) => item.value === value.preset)
      ? (value.preset as ExpiryPreset)
      : 'never'

    return {
      url: value.url,
      alias: typeof value.alias === 'string' ? value.alias : '',
      preset,
      custom: typeof value.custom === 'string' ? value.custom : '',
    }
  } catch {
    return null
  }
}

