import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createApiKey,
  deleteAccountData,
  downloadAccountExport,
  getShortPrefix,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
} from './api.ts'
import { useAuth } from './AuthContext.tsx'
import { copyText } from './copy.ts'
import { formatWhen, relativeTime } from './format.ts'
import { CopyIcon, DownloadIcon, KeyIcon, PlusIcon, TrashIcon } from './icons.tsx'
import { Modal } from './Modal.tsx'
import { useToast } from './Toast.tsx'

type SettingsProps = {
  onSignIn: () => void
  onDeleted: () => void
}

export function Settings({ onSignIn, onDeleted }: SettingsProps) {
  const { status, user, hasPasswordLogin } = useAuth()
  const [passwordLogin, setPasswordLogin] = useState<boolean | null | 'loading'>('loading')

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

    let cancelled = false
    void hasPasswordLogin().then((value) => {
      if (!cancelled) {
        setPasswordLogin(value)
      }
    })

    return () => {
      cancelled = true
    }
    // hasPasswordLogin is recreated each render but stable in behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  if (status === 'loading') {
    return (
      <div className="dash settings">
        <div className="skeleton skeleton-line skeleton-medium" />
      </div>
    )
  }

  if (status !== 'authenticated' || !user) {
    return (
      <div className="dash settings">
        <div className="dash-head dash-head-guest">
          <div>
            <h1 className="dash-title">Settings</h1>
            <p className="dash-lede">Sign in to manage your account.</p>
          </div>
          <button className="button button-primary button-compact" type="button" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    )
  }

  const initials = (user.name || user.email).trim().slice(0, 1).toUpperCase()

  return (
    <div className="dash settings">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Settings</h1>
          <p className="dash-lede">Your account, API access and data.</p>
        </div>
      </div>

      <section className="settings-card" aria-labelledby="settings-account">
        <h2 id="settings-account" className="settings-title">
          Account
        </h2>
        <div className="profile-identity">
          <span className="avatar avatar-large" aria-hidden="true">
            {initials}
          </span>
          <div className="profile-text">
            {user.name ? <p className="profile-name">{user.name}</p> : null}
            <p className="profile-email">{user.email}</p>
          </div>
        </div>
      </section>

      <PasswordSection passwordLogin={passwordLogin} />
      <ApiKeysSection />
      <DataSection />
      <DangerZone
        passwordLogin={passwordLogin === true}
        email={user.email}
        onDeleted={onDeleted}
      />
    </div>
  )
}

function PasswordSection({ passwordLogin }: { passwordLogin: boolean | null | 'loading' }) {
  const { changePassword } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) {
      return
    }

    if (next.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }

    if (next !== confirm) {
      setError('New passwords don’t match')
      return
    }

    setSaving(true)
    setError(null)
    const result = await changePassword(current, next)
    setSaving(false)

    if (result) {
      setError(result)
      return
    }

    setCurrent('')
    setNext('')
    setConfirm('')
    toast('Password changed. Other devices were signed out.')
  }

  return (
    <section className="settings-card" aria-labelledby="settings-password">
      <h2 id="settings-password" className="settings-title">
        Password
      </h2>
      {passwordLogin === 'loading' ? (
        <div className="skeleton skeleton-line skeleton-long" />
      ) : passwordLogin === false ? (
        <p className="settings-copy">
          You sign in with Google. To also sign in with email and password, sign out and use
          <strong> Forgot password?</strong> on the sign-in screen to set one.
        </p>
      ) : (
        <form className="settings-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="current-password">
              Current password
            </label>
            <input
              id="current-password"
              className="field field-compact"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              disabled={saving}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="option-pair">
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                className="field field-compact"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
                minLength={8}
                value={next}
                disabled={saving}
                onChange={(event) => setNext(event.target.value)}
              />
            </div>
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="confirm-new-password">
                Confirm new password
              </label>
              <input
                id="confirm-new-password"
                className="field field-compact"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                disabled={saving}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p className="status status-error" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <button className="button button-primary button-compact" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

type KeysState =
  | { kind: 'loading' }
  | { kind: 'ready'; keys: ApiKey[] }
  | { kind: 'error'; message: string }

function ApiKeysSection() {
  const toast = useToast()
  const [state, setState] = useState<KeysState>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setState({ kind: 'ready', keys: await listApiKeys() })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not load API keys',
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (creating || !name.trim()) {
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const created = await createApiKey(name.trim())
      setRevealed({ name: created.name, key: created.key })
      setName('')
      void load()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke() {
    if (!revoking || revokeBusy) {
      return
    }

    setRevokeBusy(true)

    try {
      await revokeApiKey(revoking.id)
      toast(`Revoked “${revoking.name}”`)
      setRevoking(null)
      void load()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not revoke the key', 'error')
    } finally {
      setRevokeBusy(false)
    }
  }

  const apiBase = `${window.location.origin}/api/urls`

  return (
    <section className="settings-card" aria-labelledby="settings-keys">
      <h2 id="settings-keys" className="settings-title">
        API keys
      </h2>
      <p className="settings-copy">
        Create short links from scripts and other apps. Keys can create, list, edit and delete
        your links, but can’t change account settings.
      </p>

      {revealed ? (
        <div className="key-reveal" role="status">
          <p className="key-reveal-title">
            Copy your new key “{revealed.name}” now. You won’t be able to see it again.
          </p>
          <div className="key-reveal-row">
            <code className="key-value">{revealed.key}</code>
            <button
              className="button button-primary button-compact"
              type="button"
              onClick={() => {
                copyText(revealed.key).then(
                  () => toast('API key copied'),
                  () => toast('Could not copy the key', 'error'),
                )
              }}
            >
              <CopyIcon size={14} />
              Copy
            </button>
          </div>
          <button className="link-button" type="button" onClick={() => setRevealed(null)}>
            I’ve saved it
          </button>
        </div>
      ) : null}

      <form className="key-create" onSubmit={(event) => void handleCreate(event)}>
        <label className="label" htmlFor="key-name">
          Key name
        </label>
        <input
          id="key-name"
          className="field field-compact"
          type="text"
          placeholder="Key name, e.g. “Zapier” or “CI”"
          maxLength={48}
          value={name}
          disabled={creating}
          onChange={(event) => {
            setName(event.target.value)
            setCreateError(null)
          }}
        />
        <button
          className="button button-ghost button-compact"
          type="submit"
          disabled={creating || !name.trim()}
        >
          <PlusIcon size={14} />
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </form>
      {createError ? (
        <p className="status status-error" role="alert">
          {createError}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <div className="skeleton skeleton-line skeleton-long" />
      ) : state.kind === 'error' ? (
        <p className="status status-error">{state.message}</p>
      ) : state.keys.length === 0 ? (
        <p className="status">No API keys yet.</p>
      ) : (
        <ul className="key-list">
          {state.keys.map((key) => (
            <li key={key.id} className="key-row">
              <KeyIcon size={16} />
              <div className="key-main">
                <p className="key-name">{key.name}</p>
                <p className="key-meta">
                  <code>{key.prefix}_…</code> · Created {relativeTime(key.createdAt)} ·{' '}
                  <span title={key.lastUsedAt ? formatWhen(key.lastUsedAt) : undefined}>
                    {key.lastUsedAt ? `Last used ${relativeTime(key.lastUsedAt)}` : 'Never used'}
                  </span>
                </p>
              </div>
              <button
                className="icon-button icon-button-danger"
                type="button"
                aria-label={`Revoke ${key.name}`}
                title="Revoke"
                onClick={() => setRevoking(key)}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="api-docs">
        <summary>Example request</summary>
        <pre>
          <code>{`curl -X POST ${apiBase} \\
  -H "Authorization: Bearer shrt_…" \\
  -H "Content-Type: application/json" \\
  -d '{"originalUrl": "https://example.com", "alias": "my-link", "tags": ["api"]}'`}</code>
        </pre>
        <p className="settings-copy">
          The response includes <code>shortCode</code>; your link is{' '}
          <code>{getShortPrefix()}&lt;shortCode&gt;</code>. Other options: <code>expiresAt</code>,{' '}
          <code>maxClicks</code>, <code>password</code>.
        </p>
      </details>

      <Modal
        open={revoking !== null}
        title="Revoke this key?"
        onClose={() => setRevoking(null)}
        size="small"
      >
        <p className="modal-subject">{revoking?.name}</p>
        <p className="auth-copy">
          Anything using this key will stop working immediately. This can’t be undone.
        </p>
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={() => setRevoking(null)}>
            Cancel
          </button>
          <button
            className="button button-danger-solid"
            type="button"
            disabled={revokeBusy}
            onClick={() => {
              void handleRevoke()
            }}
          >
            {revokeBusy ? 'Revoking…' : 'Revoke key'}
          </button>
        </div>
      </Modal>
    </section>
  )
}

function DataSection() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      await downloadAccountExport()
      toast('Export downloaded')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not export your data', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="settings-card" aria-labelledby="settings-data">
      <h2 id="settings-data" className="settings-title">
        Your data
      </h2>
      <p className="settings-copy">
        Download everything SHRT stores for your account: every link with its settings and every
        recorded click, as JSON. For a spreadsheet of your links, use the export button on the
        dashboard.
      </p>
      <div>
        <button
          className="button button-ghost button-compact"
          type="button"
          disabled={exporting}
          onClick={() => {
            void handleExport()
          }}
        >
          <DownloadIcon size={14} />
          {exporting ? 'Preparing…' : 'Download my data'}
        </button>
      </div>
    </section>
  )
}

type DeleteState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }

function DangerZone({
  passwordLogin,
  email,
  onDeleted,
}: {
  passwordLogin: boolean
  email: string
  onDeleted: () => void
}) {
  const { deleteAccount, signOut } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<DeleteState>({ kind: 'idle' })

  const confirmed = confirmText.trim().toLowerCase() === 'delete'

  function close() {
    setOpen(false)
    setConfirmText('')
    setPassword('')
    setState({ kind: 'idle' })
  }

  async function finish(message: string) {
    await signOut()
    toast(message)
    onDeleted()
  }

  async function handleDelete() {
    if (!confirmed || state.kind === 'busy') {
      return
    }

    setState({ kind: 'busy' })
    const result = await deleteAccount(passwordLogin ? password : null)

    if (result.kind === 'error') {
      setState({ kind: 'error', message: result.message })
      return
    }

    if (result.kind === 'disabled') {
      setState({ kind: 'disabled' })
      return
    }

    if (result.kind === 'verification-sent') {
      setState({
        kind: 'error',
        message: `We emailed ${email} a link to confirm deletion. Your links will be removed once you confirm.`,
      })
      return
    }

    // The sign-in account is gone; remove SHRT's data with the still-valid token.
    try {
      await deleteAccountData()
      await finish('Your account and all your links were deleted')
    } catch {
      setState({
        kind: 'error',
        message:
          'Your sign-in account was deleted, but removing your links failed. Contact support to finish the deletion.',
      })
    }
  }

  async function handleDeleteDataOnly() {
    setState({ kind: 'busy' })
    try {
      await deleteAccountData()
      await finish('All your links, clicks and API keys were deleted')
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not delete your data',
      })
    }
  }

  return (
    <section className="settings-card settings-danger" aria-labelledby="settings-danger">
      <h2 id="settings-danger" className="settings-title">
        Delete account
      </h2>
      <p className="settings-copy">
        Permanently deletes your account, all your short links and their click history, and your
        API keys. Your short links will stop working immediately.
      </p>
      <div>
        <button
          className="button button-ghost button-danger button-compact"
          type="button"
          onClick={() => setOpen(true)}
        >
          <TrashIcon size={14} />
          Delete account
        </button>
      </div>

      <Modal open={open} title="Delete your account?" onClose={close} size="small">
        {state.kind === 'disabled' ? (
          <>
            <p className="auth-copy">
              Deleting sign-in accounts isn’t turned on for this app yet. You can still delete all
              your links, clicks and API keys now. Your sign-in will remain, with nothing attached.
            </p>
            <div className="modal-actions">
              <button className="button button-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button
                className="button button-danger-solid"
                type="button"
                onClick={() => {
                  void handleDeleteDataOnly()
                }}
              >
                Delete my data
              </button>
            </div>
          </>
        ) : (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleDelete()
            }}
          >
            <p className="auth-copy">
              This can’t be undone. Consider downloading your data first.
            </p>
            {passwordLogin ? (
              <div className="auth-field">
                <label className="auth-field-label" htmlFor="delete-password">
                  Your password
                </label>
                <input
                  id="delete-password"
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={state.kind === 'busy'}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            ) : null}
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="delete-confirm">
                Type DELETE to confirm
              </label>
              <input
                id="delete-confirm"
                className="field"
                type="text"
                autoComplete="off"
                value={confirmText}
                disabled={state.kind === 'busy'}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </div>
            {state.kind === 'error' ? (
              <p className="status status-error" role="alert">
                {state.message}
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="button button-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button
                className="button button-danger-solid"
                type="submit"
                disabled={!confirmed || (passwordLogin && !password) || state.kind === 'busy'}
              >
                {state.kind === 'busy' ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  )
}
