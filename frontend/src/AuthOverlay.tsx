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

  function switchMode(next: AuthMode) {
    setError(null)
    setMode(next)
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
  }

  const heading = mode === 'signup' ? 'Create an account' : 'Welcome back'
  const subtitle =
    message ??
    (mode === 'signup'
      ? 'Save your short links and see how they get used.'
      : 'Sign in to manage the links you\'ve created.')

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close"
        onClick={handleClose}
      />
      <div className="overlay-panel">
        <button className="overlay-close" type="button" onClick={handleClose} aria-label="Close">
          ×
        </button>

        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button
            className={`auth-tab${mode === 'signup' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
          <button
            className={`auth-tab${mode === 'signin' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
        </div>

        <h2 id="auth-title" className="auth-title">
          {heading}
        </h2>
        <p className="auth-copy">{subtitle}</p>

        <button
          className="auth-google"
          type="button"
          onClick={() => {
            void handleGoogle()
          }}
          disabled={submitting}
        >
          <GoogleMark />
          Continue with Google
        </button>

        <div className="auth-divider">
          <span>or with email</span>
        </div>

        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          {mode === 'signup' ? (
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="auth-name">
                Name
              </label>
              <input
                id="auth-name"
                className="field"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                disabled={submitting}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="field"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              required
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              className="field"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={password}
              required
              minLength={8}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting
              ? 'Please wait…'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {error ? <p className="status status-error auth-error">{error}</p> : null}
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.55-5.17 3.55-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.47 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.21 7.21 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.38l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.35.6 4.6 1.8l3.45-3.45C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.62l4.01 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  )
}
