import { useCallback, useEffect, useState } from 'react'
import { AuthOverlay } from './AuthOverlay.tsx'
import { useAuth } from './AuthContext.tsx'
import { Dashboard } from './Dashboard.tsx'
import { Home } from './Home.tsx'
import { clearPending } from './pending.ts'
import { ProfileOverlay } from './ProfileOverlay.tsx'

type Screen = 'home' | 'dashboard' | 'notfound'

const TITLES: Record<Screen, string> = {
  home: 'SHRT — Short links with analytics',
  dashboard: 'Dashboard · SHRT',
  notfound: 'Page not found · SHRT',
}

function readScreen(): Screen {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/') {
    return 'home'
  }

  return path === '/dashboard' ? 'dashboard' : 'notfound'
}

function App() {
  const { status, user } = useAuth()
  const [screen, setScreen] = useState<Screen>(readScreen)
  const [busy, setBusy] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    function onPopState() {
      setScreen(readScreen())
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = TITLES[screen]
  }, [screen])

  // Close the sign-in dialog once a session appears (incl. after OAuth).
  useEffect(() => {
    if (status === 'authenticated') {
      setAuthOpen(false)
    }
  }, [status])

  const go = useCallback((next: Exclude<Screen, 'notfound'>) => {
    const path = next === 'dashboard' ? '/dashboard' : '/'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setScreen(next)
    window.scrollTo({ top: 0 })
  }, [])

  function navLink(target: Exclude<Screen, 'notfound'>, label: string) {
    const href = target === 'dashboard' ? '/dashboard' : '/'

    return (
      <a
        className={`nav-link${screen === target ? ' is-active' : ''}`}
        href={href}
        aria-current={screen === target ? 'page' : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
            return
          }
          event.preventDefault()
          go(target)
        }}
      >
        {label}
      </a>
    )
  }

  const initials = (user?.name || user?.email || '?').trim().slice(0, 1).toUpperCase()

  return (
    <div className={`page${screen === 'home' ? '' : ' is-dashboard'}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="atmosphere" aria-hidden="true">
        <div className="atmosphere-light" />
        <div className="atmosphere-mesh" />
      </div>

      <header className="header">
        <div className="chrome-inner">
          <a
            className={`brand${busy ? ' is-busy' : ''}`}
            href="/"
            onClick={(event) => {
              event.preventDefault()
              go('home')
            }}
          >
            <img className="brand-mark" src="/shrtlogo.png" alt="" width={40} height={40} />
            <span className="brand-name">SHRT</span>
          </a>
          <nav className="nav" aria-label="Primary">
            {navLink('home', 'Shorten')}
            {navLink('dashboard', 'Dashboard')}
          </nav>
          <div className="auth-controls">
            {status === 'loading' ? (
              <span className="avatar avatar-loading" aria-hidden="true" />
            ) : status === 'authenticated' && user ? (
              <button
                className="avatar"
                type="button"
                aria-label="Open account menu"
                title={user.email}
                onClick={() => setProfileOpen(true)}
              >
                {initials}
              </button>
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

      <main className="main" id="main">
        {screen === 'dashboard' ? (
          <Dashboard onCreate={() => go('home')} onSignIn={() => setAuthOpen(true)} />
        ) : screen === 'notfound' ? (
          <NotFound onHome={() => go('home')} />
        ) : (
          <Home
            onRequireAuth={() => setAuthOpen(true)}
            onOpenDashboard={() => go('dashboard')}
            onBusyChange={setBusy}
          />
        )}
      </main>

      <footer className="footer">
        <div className="chrome-inner">
          <span>© {new Date().getFullYear()} SHRT</span>
          <span className="footer-rule" />
          <span>Short links · Click analytics · QR codes</span>
        </div>
      </footer>

      <AuthOverlay
        open={authOpen}
        onClose={() => {
          clearPending()
          setAuthOpen(false)
        }}
      />
      <ProfileOverlay
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenDashboard={() => {
          setProfileOpen(false)
          go('dashboard')
        }}
      />
    </div>
  )
}

function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <div className="not-found">
      <p className="kicker">Error 404</p>
      <h1 className="dash-title">This page doesn't exist</h1>
      <p className="dash-lede">
        The address may be mistyped, or the page may have moved.
      </p>
      <button className="button button-primary button-compact" type="button" onClick={onHome}>
        Go to the shortener
      </button>
    </div>
  )
}

export default App
