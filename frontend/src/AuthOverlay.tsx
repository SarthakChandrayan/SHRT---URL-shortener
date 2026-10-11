import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext.tsx'
import { Modal } from './Modal.tsx'

type AuthMode = 'signup' | 'signin'
type AuthStep = 'credentials' | 'verify' | 'forgot' | 'reset'

type AuthOverlayProps = {
  open: boolean
  onClose: () => void
  /** Error carried back from a failed Google redirect; opens on "Sign in". */
  oauthError?: string | null
}

export function AuthOverlay({ open, onClose, oauthError = null }: AuthOverlayProps) {
  const {
    signUpWithEmail,
    signInWithEmail,
    verifyEmailOtp,
    resendVerificationEmail,
    requestPasswordReset,
    resetPassword,
    signInWithGoogle,
  } = useAuth()
  const [mode, setMode] = useState<AuthMode>(oauthError ? 'signin' : 'signup')
  const [step, setStep] = useState<AuthStep>('credentials')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(oauthError)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      return
    }

    setName('')
    setEmail('')
    setPassword('')
    setCode('')
    setConfirmPassword('')
    setError(null)
    setNotice(null)
    setSubmitting(false)
    setStep('credentials')
    setMode('signup')
  }, [open])

  if (!open) {
    return null
  }

  function handleClose() {
    onClose()
  }

  function switchMode(next: AuthMode) {
    setError(null)
    setNotice(null)
    setCode('')
    setStep('credentials')
    setMode(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result =
      mode === 'signup'
        ? await signUpWithEmail(name, email, password)
        : await signInWithEmail(email, password)

    if (result.kind === 'needs-verification') {
      setStep('verify')
      setSubmitting(false)
      return
    }

    if (result.kind === 'error') {
      setError(result.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result = await verifyEmailOtp(email, code)

    if (result.kind === 'error') {
      setError(result.message)
      setSubmitting(false)
      return
    }

    if (result.kind === 'verified') {
      setMode('signin')
      setStep('credentials')
      setCode('')
      setNotice('Email verified. Sign in to continue.')
    }

    setSubmitting(false)
  }

  async function handleResend() {
    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result = await resendVerificationEmail(email)

    if (result) {
      setError(result)
    } else {
      setNotice('A new code is on its way.')
      setCode('')
    }

    setSubmitting(false)
  }

  async function handleGoogle() {
    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result = await signInWithGoogle()

    if (result) {
      setError(result)
      setSubmitting(false)
    }
  }

  function goTo(next: AuthStep) {
    setError(null)
    setNotice(null)
    setCode('')
    setStep(next)
  }

  async function handleSendResetCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result = await requestPasswordReset(email)

    setSubmitting(false)

    if (result) {
      setError(result)
      return
    }

    // The service answers the same whether or not the email has an account,
    // so this doesn't reveal which emails are registered.
    setPassword('')
    setConfirmPassword('')
    setCode('')
    setStep('reset')
    setNotice(event ? null : 'A new code is on its way.')
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords don’t match')
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    const result = await resetPassword(email, code, password)

    if (result.kind === 'error') {
      setError(result.message)
      setSubmitting(false)
      return
    }

    // 'signed-in' closes the dialog via the auth status change.
    if (result.kind === 'reset') {
      setMode('signin')
      setStep('credentials')
      setCode('')
      setConfirmPassword('')
      setNotice('Password updated. Sign in with your new password.')
    }

    setSubmitting(false)
  }

  if (step === 'forgot') {
    return (
      <Modal key="forgot" open title="Reset your password" onClose={handleClose}>
        <p className="auth-copy">
          Enter your account email and we’ll send you a 6-digit code to set a new password.
        </p>
        <form className="auth-form" onSubmit={(event) => void handleSendResetCode(event)}>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="reset-email">
              Email
            </label>
            <input
              id="reset-email"
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
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
        <p className="auth-verify-actions">
          <button
            className="link-button"
            type="button"
            disabled={submitting}
            onClick={() => {
              setMode('signin')
              goTo('credentials')
            }}
          >
            Back to sign in
          </button>
        </p>
        {error ? <p className="status status-error auth-error" role="alert">{error}</p> : null}
      </Modal>
    )
  }

  if (step === 'reset') {
    return (
      <Modal key="reset" open title="Set a new password" onClose={handleClose}>
        <p className="auth-copy">
          If <span className="auth-email">{email}</span> has an account, we sent it a
          6-digit code. Enter it below with your new password.
        </p>
        <form className="auth-form" onSubmit={(event) => void handleResetPassword(event)}>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="reset-otp">
              Code
            </label>
            <input
              id="reset-otp"
              className="field auth-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              required
              minLength={6}
              maxLength={6}
              disabled={submitting}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              required
              minLength={8}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor="reset-confirm">
              Confirm new password
            </label>
            <input
              id="reset-confirm"
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              required
              minLength={8}
              disabled={submitting}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <button
            className="button button-primary"
            type="submit"
            disabled={submitting || code.length !== 6}
          >
            {submitting ? 'Please wait…' : 'Update password'}
          </button>
        </form>
        <p className="auth-verify-actions">
          <button
            className="link-button"
            type="button"
            disabled={submitting}
            onClick={() => {
              void handleSendResetCode()
            }}
          >
            Resend code
          </button>
          <button
            className="link-button"
            type="button"
            disabled={submitting}
            onClick={() => goTo('forgot')}
          >
            Use a different email
          </button>
        </p>
        {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
        {error ? <p className="status status-error auth-error" role="alert">{error}</p> : null}
      </Modal>
    )
  }

  if (step === 'verify') {
    return (
      <Modal key="verify" open title="Check your email" onClose={handleClose}>

          <p className="auth-copy">
            Enter the 6-digit code we sent to <span className="auth-email">{email}</span>.
          </p>

          <form className="auth-form" onSubmit={(event) => void handleVerify(event)}>
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="auth-otp">
                Code
              </label>
              <input
                id="auth-otp"
                className="field auth-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                required
                minLength={6}
                maxLength={6}
                disabled={submitting}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Please wait…' : 'Verify email'}
            </button>
          </form>

          <p className="auth-verify-actions">
            <button
              className="link-button"
              type="button"
              disabled={submitting}
              onClick={() => {
                void handleResend()
              }}
            >
              Resend code
            </button>
            <button
              className="link-button"
              type="button"
              disabled={submitting}
              onClick={() => {
                setStep('credentials')
                setCode('')
                setError(null)
                setNotice(null)
              }}
            >
              Use a different email
            </button>
          </p>

          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          {error ? <p className="status status-error auth-error" role="alert">{error}</p> : null}
      </Modal>
    )
  }

  const heading = mode === 'signup' ? 'Create an account' : 'Welcome back'
  const subtitle =
    mode === 'signup'
      ? 'Save your short links and see how they get used.'
      : 'Sign in to manage the links you\'ve created.'

  return (
    <Modal key="credentials" open title={heading} onClose={handleClose}>

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
            <div className="auth-field-row">
              <label className="auth-field-label" htmlFor="auth-password">
                Password
              </label>
              {mode === 'signin' ? (
                <button
                  className="link-button auth-forgot"
                  type="button"
                  disabled={submitting}
                  onClick={() => goTo('forgot')}
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
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

        {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
        {error ? <p className="status status-error auth-error" role="alert">{error}</p> : null}
    </Modal>
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
