import { useState, type FormEvent } from 'react'
import { deleteUrl, updateUrl, type UrlPatch, type UrlStats } from './api.ts'
import { copyText } from './copy.ts'
import {
  EXPIRY_PRESETS,
  plural,
  resolveExpiry,
  toDatetimeLocal,
  type ExpiryPreset,
} from './format.ts'
import { CopyIcon } from './icons.tsx'
import { Modal } from './Modal.tsx'
import { QrCode } from './QrCode.tsx'
import { useToast } from './Toast.tsx'
import { TagInput } from './TagInput.tsx'
import { validateOriginalUrl } from './validate.ts'

type LinkModalProps = {
  link: UrlStats | null
  shortUrl: string
  onClose: () => void
}

export function EditLinkModal({
  link,
  shortUrl,
  onClose,
  onSaved,
}: LinkModalProps & { onSaved: () => void }) {
  // The parent keys this component by link id, so state starts fresh per link.
  const toast = useToast()
  const initialCustom = toDatetimeLocal(link?.expiresAt ?? null)
  const [destination, setDestination] = useState(link?.originalUrl ?? '')
  const [preset, setPreset] = useState<ExpiryPreset>(link?.expiresAt ? 'custom' : 'never')
  const [custom, setCustom] = useState(initialCustom)
  const [tags, setTags] = useState<string[]>(link?.tags ?? [])
  const [maxClicks, setMaxClicks] = useState(link?.maxClicks?.toString() ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!link || saving) {
      return
    }

    const patch: UrlPatch = {}
    const nextDestination = destination.trim()

    if (nextDestination !== link.originalUrl) {
      const invalid = validateOriginalUrl(nextDestination)
      if (invalid) {
        setError(invalid)
        return
      }
      patch.originalUrl = nextDestination
    }

    // Leave an unchanged expiry alone — re-sending an already-passed date
    // would be rejected as "not in the future".
    const expiryUnchanged =
      (preset === 'never' && !link.expiresAt) ||
      (preset === 'custom' && Boolean(link.expiresAt) && custom === initialCustom)

    if (!expiryUnchanged) {
      const expiry = resolveExpiry(preset, custom)
      if ('error' in expiry) {
        setError(expiry.error)
        return
      }
      patch.expiresAt = expiry.expiresAt
    }

    if (tags.join(',') !== link.tags.join(',')) {
      patch.tags = tags
    }

    const limitText = maxClicks.trim()
    const limit = limitText ? Number(limitText) : null
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      setError('Click limit must be a whole number of 1 or more')
      return
    }
    if (limit !== link.maxClicks) {
      patch.maxClicks = limit
    }

    if (removePassword) {
      patch.password = null
    } else if (newPassword) {
      if (newPassword.length < 4) {
        setError('Link password must be at least 4 characters')
        return
      }
      patch.password = newPassword
    }

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }

    setSaving(true)
    setError(null)

    try {
      await updateUrl(link.id, patch)
      toast('Link updated')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this link')
      setSaving(false)
    }
  }

  return (
    <Modal open={Boolean(link)} title="Edit link" onClose={onClose}>
      <p className="modal-subject">{shortUrl}</p>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="auth-field">
          <label className="auth-field-label" htmlFor="edit-destination">
            Destination URL
          </label>
          <input
            id="edit-destination"
            className="field"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={destination}
            disabled={saving}
            onChange={(event) => {
              setDestination(event.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="auth-field">
          <span className="auth-field-label" id="edit-expiry-label">
            Expires
          </span>
          <div className="chips" role="radiogroup" aria-labelledby="edit-expiry-label">
            {EXPIRY_PRESETS.map((item) => (
              <button
                key={item.value}
                className={`chip${preset === item.value ? ' is-active' : ''}`}
                type="button"
                role="radio"
                aria-checked={preset === item.value}
                disabled={saving}
                onClick={() => {
                  setPreset(item.value)
                  setError(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <input
              className="field expire-input"
              type="datetime-local"
              aria-label="Custom expiration date"
              value={custom}
              disabled={saving}
              onChange={(event) => {
                setCustom(event.target.value)
                setError(null)
              }}
            />
          ) : null}
          <p className="option-status">
            Presets count from now. Expired links show visitors an “expired” page.
          </p>
        </div>
        <div className="option-pair">
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="edit-max-clicks">
              Click limit
            </label>
            <input
              id="edit-max-clicks"
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="Unlimited"
              value={maxClicks}
              disabled={saving}
              onChange={(event) => {
                setMaxClicks(event.target.value)
                setError(null)
              }}
            />
          </div>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="edit-password">
              {link?.hasPassword ? 'New password' : 'Password'}
            </label>
            <input
              id="edit-password"
              className="field"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              placeholder={link?.hasPassword ? 'Keep current' : 'No password'}
              value={newPassword}
              disabled={saving || removePassword}
              onChange={(event) => {
                setNewPassword(event.target.value)
                setError(null)
              }}
            />
          </div>
        </div>
        {link?.hasPassword ? (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={removePassword}
              disabled={saving}
              onChange={(event) => {
                setRemovePassword(event.target.checked)
                setNewPassword('')
              }}
            />
            Remove password protection
          </label>
        ) : null}
        {link && link.maxClicks !== null ? (
          <p className="option-status">
            {link.clickCount.toLocaleString()} of {link.maxClicks.toLocaleString()} visits used.
            Raise the limit to reopen a link that’s reached it.
          </p>
        ) : null}
        <div className="auth-field">
          <label className="auth-field-label" htmlFor="edit-tags">
            Tags
          </label>
          <TagInput id="edit-tags" tags={tags} onChange={setTags} disabled={saving} />
        </div>
        {error ? (
          <p className="status status-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DeleteLinkModal({
  link,
  shortUrl,
  onClose,
  onDeleted,
}: LinkModalProps & { onDeleted: (id: string) => void }) {
  const toast = useToast()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!link || deleting) {
      return
    }

    setDeleting(true)
    setError(null)

    try {
      await deleteUrl(link.id)
      toast('Link deleted')
      onDeleted(link.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this link')
      setDeleting(false)
    }
  }

  return (
    <Modal open={Boolean(link)} title="Delete this link?" onClose={onClose} size="small">
      <p className="modal-subject">{shortUrl}</p>
      <p className="auth-copy">
        Anyone who opens it will see a “not found” page
        {link && link.clickCount > 0
          ? `, and its ${plural(link.clickCount, 'recorded click')} will be deleted`
          : ''}
        . This can't be undone.
      </p>
      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="button button-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-danger-solid"
          type="button"
          disabled={deleting}
          onClick={() => {
            void handleDelete()
          }}
        >
          {deleting ? 'Deleting…' : 'Delete link'}
        </button>
      </div>
    </Modal>
  )
}

export function QrModal({ link, shortUrl, onClose }: LinkModalProps) {
  const toast = useToast()

  return (
    <Modal open={Boolean(link)} title="QR code" onClose={onClose} size="small">
      <p className="modal-subject">{shortUrl}</p>
      {link ? (
        <div className="qr-modal">
          <QrCode value={shortUrl} name={link.shortCode} size={220} />
          <button
            className="button button-ghost button-compact"
            type="button"
            onClick={() => {
              copyText(shortUrl).then(
                () => toast('Link copied'),
                () => toast('Could not copy the link', 'error'),
              )
            }}
          >
            <CopyIcon size={14} />
            Copy link
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
