import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createShortUrl, getShortUrl } from './api.ts'
import { AuthOverlay } from './AuthOverlay.tsx'
import { useAuth } from './AuthContext.tsx'
import { ProfileOverlay } from './ProfileOverlay.tsx'
import { copyText } from './copy.ts'
import { Dashboard } from './Dashboard.tsx'
import { validateOriginalUrl } from './validate.ts'

const PENDING_URL_KEY = 'shrt:pendingUrl'

type Screen = 'home' | 'dashboard'

type View =
  | { kind: 'form'; error: string | null }
  | { kind: 'success'; shortUrl: string; originalUrl: string }

function readScreen(): Screen {
  return window.location.pathname.replace(/\/$/, '') === '/dashboard'
    ? 'dashboard'
    : 'home'
}

const WORK_STEPS = ['Checking URL', 'Creating short code', 'Saving']

function App() {
  const { status, user, signOut } = useAuth()
  const [screen, setScreen] = useState<Screen>(readScreen)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [workStep, setWorkStep] = useState(0)
  const [view, setView] = useState<View>({ kind: 'form', error: null })
  const [authOpen, setAuthOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    function onPopState() {
      setScreen(readScreen())
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function go(next: Screen) {
    const path = next === 'dashboard' ? '/dashboard' : '/'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setScreen(next)
  }

  const probe = inspectUrl(input)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!loading) {
      setWorkStep(0)
      return
    }

    const timer = window.setInterval(() => {
      setWorkStep((step) => (step + 1) % WORK_STEPS.length)
    }, 520)
    return () => window.clearInterval(timer)
  }, [loading])

  async function performShorten(originalUrl: string) {
    submittingRef.current = true
    setLoading(true)
    setView({ kind: 'form', error: null })

    try {
      const created = await createShortUrl(originalUrl)
      setView({
        kind: 'success',
        shortUrl: getShortUrl(created.shortCode),
        originalUrl: created.originalUrl,
      })
      setCopied(false)
    } catch (error) {
      setView({
        kind: 'form',
        error:
          error instanceof Error ? error.message : 'Could not shorten this URL',
      })
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submittingRef.current || loading) {
      return
    }

    const originalUrl = input.trim()
    const validationError = validateOriginalUrl(originalUrl)

    if (validationError) {
      setView({ kind: 'form', error: validationError })
      return
    }

    if (status !== 'authenticated') {
      // Hold the request until the visitor signs up/in, then resume it —
      // even across a full-page Google OAuth redirect.
      window.sessionStorage.setItem(PENDING_URL_KEY, originalUrl)
      setAuthOpen(true)
      return
    }

    await performShorten(originalUrl)
  }

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

    // Always close the overlay once we're signed in, whether or not there
    // was a pending URL waiting to be shortened.
    setAuthOpen(false)

    const pending = window.sessionStorage.getItem(PENDING_URL_KEY)
    if (!pending) {
      return
    }

    window.sessionStorage.removeItem(PENDING_URL_KEY)
    setInput(pending)
    void performShorten(pending)
    // performShorten is stable enough for this one-shot resume; re-running
    // it on every render identity change isn't necessary here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function handleCopy(shortUrl: string) {
    try {
      await copyText(shortUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function handleReset() {
    window.sessionStorage.removeItem(PENDING_URL_KEY)
    setInput('')
    setCopied(false)
    setView({ kind: 'form', error: null })
  }

  const consoleState = loading
    ? 'is-busy'
    : view.kind === 'success'
      ? 'is-live'
      : probe.locked
        ? 'is-armed'
        : ''

  return (
    <div className={`page${screen === 'dashboard' ? ' is-dashboard' : ''}`}>
      <div className="atmosphere" aria-hidden="true">
        <div className="atmosphere-light" />
        <div className="atmosphere-mesh" />
      </div>

      <header className="header">
        <div className="chrome-inner">
          <a
            className={`brand${loading ? ' is-busy' : ''}`}
            href="/"
            onClick={(event) => {
              event.preventDefault()
              go('home')
            }}
          >
            <img
              className="brand-mark"
              src="/shrtlogo.png"
              alt=""
              width={40}
              height={40}
            />
            <span className="brand-name">SHRT</span>
          </a>
          <nav className="nav" aria-label="Primary">
            <a
              className={`nav-link${screen === 'home' ? ' is-active' : ''}`}
              href="/"
              onClick={(event) => {
                event.preventDefault()
                go('home')
              }}
            >
              Shorten
            </a>
            <a
              className={`nav-link${screen === 'dashboard' ? ' is-active' : ''}`}
              href="/dashboard"
              onClick={(event) => {
                event.preventDefault()
                go('dashboard')
              }}
            >
              Dashboard
            </a>
          </nav>
          <div className="auth-controls">
            {status === 'authenticated' && user ? (
              <>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => setProfileOpen(true)}
                >
                  My profile
                </button>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => {
                    void signOut()
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setAuthOpen(true)}
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {screen === 'dashboard' ? (
          <Dashboard onCreate={() => go('home')} />
        ) : (
          <>
        <div className="intro">
          <p className="kicker">Create a short link</p>
          <h1 className="headline">
            Shorten a long URL.
            <br />
            <span className="headline-accent">Keep the destination.</span>
          </h1>
          <p className="lede">
            Paste a link and get a compact identifier that redirects to the
            original address.
          </p>
        </div>

        <section className={`console ${consoleState}`.trim()} aria-live="polite">
          <div className="console-frame" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="console-label">
            {view.kind === 'success' ? 'Short URL' : loading ? 'Creating' : 'Original URL'}
          </div>

          {view.kind === 'form' ? (
            <>
              <form className="form" onSubmit={handleSubmit}>
                <label className="label" htmlFor="original-url">
                  Destination URL
                </label>
                <input
                  id="original-url"
                  className="field"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  placeholder="https://example.com/very/long/path"
                  value={input}
                  disabled={loading}
                  aria-invalid={view.kind === 'form' && Boolean(view.error)}
                  aria-describedby="url-status"
                  onChange={(event) => {
                    setInput(event.target.value)
                    if (view.kind === 'form' && view.error) {
                      setView({ kind: 'form', error: null })
                    }
                  }}
                />
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Shortening…' : 'Shorten URL'}
                </button>
              </form>
              <div className="readout" aria-hidden="true">
                <span className={probe.locked ? 'on' : ''}>
                  LOCK {probe.locked ? 'OK' : 'WAIT'}
                </span>
                <span>PROTO {probe.protocol}</span>
                <span>HOST {probe.host}</span>
                <span>{String(probe.chars).padStart(3, '0')} CH</span>
              </div>
              <p
                id="url-status"
                className={view.error ? 'status status-error' : 'status'}
              >
                {loading
                  ? WORK_STEPS[workStep]
                  : (view.error ?? 'HTTP and HTTPS URLs only.')}
              </p>
            </>
          ) : (
            <div className="result">
              <div className="result-row">
                <p className="short-url">{view.shortUrl}</p>
                <button
                  className={`button button-ghost${copied ? ' is-copied' : ''}`}
                  type="button"
                  onClick={() => {
                    void handleCopy(view.shortUrl)
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="original">Original · {view.originalUrl}</p>
              <div className="result-actions">
                <button
                  className="button button-ghost again"
                  type="button"
                  onClick={handleReset}
                >
                  Create another
                </button>
                <button
                  className="button button-ghost again"
                  type="button"
                  onClick={() => go('dashboard')}
                >
                  View dashboard
                </button>
              </div>
            </div>
          )}
        </section>
          </>
        )}
      </main>

      <footer className="footer">
        <div className="chrome-inner">
          <span>Local</span>
          <span className="footer-rule" />
          <span>{screen === 'dashboard' ? 'GET /api/urls' : 'POST /api/urls'}</span>
        </div>
      </footer>

      <AuthOverlay
        open={authOpen}
        message="Sign up or sign in to get your short link."
        onClose={() => {
          window.sessionStorage.removeItem(PENDING_URL_KEY)
          setAuthOpen(false)
        }}
      />
      <ProfileOverlay open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}

function inspectUrl(value: string) {
  const trimmed = value.trim()
  const chars = trimmed.length

  if (!trimmed) {
    return { protocol: '—', host: 'idle', chars, locked: false }
  }

  try {
    const url = new URL(trimmed)
    const locked =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname)

    return {
      protocol: url.protocol.replace(':', '').toUpperCase(),
      host: url.hostname || '—',
      chars,
      locked,
    }
  } catch {
    return { protocol: '—', host: 'parsing', chars, locked: false }
  }
}

export default App
