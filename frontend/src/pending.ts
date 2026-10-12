import { EXPIRY_PRESETS, type ExpiryPreset } from './format.ts'
import { UTM_FIELDS, type UtmParams } from './utm.ts'

// A shorten request made while signed out, resumed after sign-in — even
// across a full-page Google OAuth redirect.
const PENDING_KEY = 'shrt:pendingShorten'

export type PendingShorten = {
  url: string
  alias: string
  preset: ExpiryPreset
  custom: string
  tags: string[]
  maxClicks: string
  utm: UtmParams
  /** The link password itself is never written to storage (see below). */
  wantsPassword: boolean
}

// Kept in memory only, so it survives an in-page email sign-in but not a
// full-page Google redirect — in that case the user is asked to re-enter it.
let pendingPassword: string | null = null

export function takePendingPassword(): string | null {
  const password = pendingPassword
  pendingPassword = null
  return password
}

export function savePending(pending: PendingShorten, password: string | null) {
  pendingPassword = password
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Storage can be unavailable (private mode); they'll just resubmit.
  }
}

export function clearPending() {
  pendingPassword = null
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
      tags: Array.isArray(value.tags)
        ? value.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      maxClicks: typeof value.maxClicks === 'string' ? value.maxClicks : '',
      utm: Object.fromEntries(
        UTM_FIELDS.flatMap(({ key }) => {
          const field = value.utm?.[key]
          return typeof field === 'string' ? [[key, field]] : []
        }),
      ),
      wantsPassword: value.wantsPassword === true,
    }
  } catch {
    return null
  }
}

