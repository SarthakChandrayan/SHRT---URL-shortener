import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext.tsx'

type AuthMode = 'signup' | 'signin'

type AuthOverlayProps = {
  open: boolean
  message?: string
  onClose: () => void
}

export function AuthOverlay({ open, message, onClose }: AuthOverlayProps) {
  const { signUpWithEmail, signInWithEmail, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<AuthMode>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!open) {
    return null
  }

  function reset() {
    setName('')
    setEmail('')
    setPassword('')
    setError(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)

    const result =
      mode === 'signup'
        ? await signUpWithEmail(name, email, password)
        : await signInWithEmail(email, password)

    if (result) {
      setError(result)
      setSubmitting(false)
      return
    }

    // Success — the parent watches auth status and closes this overlay.
    setSubmitting(false)
  }

  async function handleGoogle() {
    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)

    const result = await signInWithGoogle()

    if (result) {
      setError(result)
      setSubmitting(false)
    }
    // On success the browser navigates away to Google, so nothing else to do.
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Authentication">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close"
        onClick={handleClose}
      />
      <div className="overlay-panel console is-armed">
        <div className="console-frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <button className="overlay-close" type="button" onClick={handleClose} aria-label="Close">
          ×
        </button>
        <div className="console-label">
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </div>

        {message ? <p className="status auth-message">{message}</p> : null}

        <button
          className="button button-ghost auth-google"
          type="button"
          onClick={() => {
            void handleGoogle()
          }}
          disabled={submitting}
        >
          Continue with Google
        </button>

        <div className="auth-divider" aria-hidden="true">
          <span>or</span>
        </div>

        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          {mode === 'signup' ? (
            <>
              <label className="label" htmlFor="auth-name">
                Name
              </label>
              <input
                id="auth-name"
                className="field"
                type="text"
                autoComplete="name"
                placeholder="Name"
                value={name}
                disabled={submitting}
                onChange={(event) => setName(event.target.value)}
              />
            </>
          ) : null}
          <label className="label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            className="field"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            required
            disabled={submitting}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label className="label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            className="field"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="Password"
            value={password}
            required
            minLength={8}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting
              ? 'Please wait…'
              : mode === 'signup'
                ? 'Sign up'
                : 'Sign in'}
          </button>
        </form>

        <p className={error ? 'status status-error' : 'status'}>
          {error ??
            (mode === 'signup'
              ? 'Already have an account?'
              : "Don't have an account yet?")}{' '}
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setError(null)
              setMode(mode === 'signup' ? 'signin' : 'signup')
            }}
          >
            {mode === 'signup' ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  )
}
