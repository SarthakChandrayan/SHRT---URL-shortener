import { useCallback, useEffect, useState } from 'react'
import { ApiError, getShortUrl, listUrls, updateUrlExpiration, type UrlStats } from './api.ts'
import { AuthOverlay } from './AuthOverlay.tsx'
import { useAuth } from './AuthContext.tsx'
import { copyText } from './copy.ts'
import { parseExpiresInput } from './validate.ts'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; urls: UrlStats[] }
  | { kind: 'error'; message: string }

type DashboardProps = {
  onCreate: () => void
}

export function Dashboard({ onCreate }: DashboardProps) {
  const { status } = useAuth()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expireNotice, setExpireNotice] = useState<{
    id: string
    kind: 'error' | 'ok'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const urls = await listUrls()
      setState({ kind: 'ready', urls })
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof ApiError || error instanceof Error
            ? error.message
            : 'Could not load click stats',
      })
    }
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

    void load()

    function onFocus() {
      void load()
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [status, load])

  useEffect(() => {
    if (!copiedId) {
      return
    }

    const timer = window.setTimeout(() => setCopiedId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copiedId])

  useEffect(() => {
    if (expireNotice?.kind !== 'ok') {
      return
    }

    const timer = window.setTimeout(() => setExpireNotice(null), 1600)
    return () => window.clearTimeout(timer)
  }, [expireNotice])

  async function handleCopy(id: string, shortUrl: string) {
    try {
      await copyText(shortUrl)
      setCopiedId(id)
    } catch {
      setCopiedId(null)
    }
  }

  async function saveExpiration(id: string, expiresAt: string | null) {
    if (savingId) {
      return
    }

    setSavingId(id)
    setExpireNotice(null)

    try {
      await updateUrlExpiration(id, expiresAt)
      await load()
      setExpireNotice({
        id,
        kind: 'ok',
        text: expiresAt ? 'Expiration updated.' : 'Expiration removed.',
      })
    } catch (error) {
      setExpireNotice({
        id,
        kind: 'error',
        text:
          error instanceof ApiError || error instanceof Error
            ? error.message
            : 'Could not update expiration',
      })
    } finally {
      setSavingId(null)
    }
  }

  function handleSetExpiration(id: string, currentExpiresAt: string | null) {
    const expiration = parseExpiresInput(
      drafts[id] ?? toDatetimeLocal(currentExpiresAt),
    )

    if ('error' in expiration) {
      setExpireNotice({ id, kind: 'error', text: expiration.error })
      return
    }

    if (!expiration.expiresAt) {
      setExpireNotice({
        id,
        kind: 'error',
        text: 'Pick a date, or choose Never expire',
      })
      return
    }

    void saveExpiration(id, expiration.expiresAt)
  }

  if (status === 'loading') {
    return (
      <div className="dash">
        <section className="console dash-console">
          <p className="status">Checking your session…</p>
        </section>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return (
      <div className="dash">
        <div className="dash-intro">
          <div>
            <p className="kicker">Click tracking</p>
            <h1 className="headline">
              See which links
              <br />
              <span className="headline-accent">get used.</span>
            </h1>
            <p className="lede">
              Sign in to see the short links you've created and how many
              clicks each one has.
            </p>
          </div>
        </div>
        <section className="console dash-console">
          <div className="console-frame" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="console-label">Short URLs</div>
          <div className="dash-empty">
            <p className="status">You need to sign in to view your dashboard.</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => setAuthOpen(true)}
            >
              Sign in
            </button>
          </div>
        </section>
        <AuthOverlay
          open={authOpen}
          message="Sign in to see your links."
          onClose={() => setAuthOpen(false)}
        />
      </div>
    )
  }

  const urls = state.kind === 'ready' ? state.urls : []
  const totalClicks = urls.reduce((sum, url) => sum + url.clickCount, 0)
  const activeCount = urls.filter((url) => !isExpired(url.expiresAt)).length

  return (
    <div className="dash">
      <div className="dash-intro">
        <div>
          <p className="kicker">Click tracking</p>
          <h1 className="headline">
            See which links
            <br />
            <span className="headline-accent">get used.</span>
          </h1>
          <p className="lede">
            Every successful redirect records device, browser, OS, and
            referrer. Open a short URL to add a click, then come back to
            this page.
          </p>
        </div>
        <div className="dash-actions">
          <button
            className="button button-ghost"
            type="button"
            onClick={() => {
              void handleRefresh()
            }}
            disabled={state.kind === 'loading' || refreshing}
          >
            {state.kind === 'loading' || refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="button button-primary" type="button" onClick={onCreate}>
            Shorten URL
          </button>
        </div>
      </div>

      <div className="metrics" aria-live="polite">
        <div className="metric">
          <div className="metric-value">{state.kind === 'ready' ? urls.length : '—'}</div>
          <div className="metric-label">Links</div>
        </div>
        <div className="metric">
          <div className="metric-value">{state.kind === 'ready' ? totalClicks : '—'}</div>
          <div className="metric-label">Clicks</div>
        </div>
        <div className="metric">
          <div className="metric-value">{state.kind === 'ready' ? activeCount : '—'}</div>
          <div className="metric-label">Active</div>
        </div>
      </div>

      <section className="console is-live dash-console" aria-live="polite">
        <div className="console-frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="console-label">Short URLs</div>

        {state.kind === 'loading' ? (
          <p className="status">Loading click stats…</p>
        ) : state.kind === 'error' ? (
          <p className="status status-error">{state.message}</p>
        ) : urls.length === 0 ? (
          <div className="dash-empty">
            <p className="status">No short URLs yet.</p>
            <button className="button button-ghost again" type="button" onClick={onCreate}>
              Create one
            </button>
          </div>
        ) : (
          <ul className="link-list">
            {urls.map((url) => {
              const shortUrl = getShortUrl(url.shortCode)
              const expired = isExpired(url.expiresAt)

              return (
                <li key={url.id} className="link-card">
                  <div className="link-card-top">
                    <a
                      className="link-short"
                      href={shortUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortUrl}
                    </a>
                    <button
                      className={`button button-ghost${copiedId === url.id ? ' is-copied' : ''}`}
                      type="button"
                      onClick={() => {
                        void handleCopy(url.id, shortUrl)
                      }}
                    >
                      {copiedId === url.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="original">Original · {url.originalUrl}</p>
                  <div className="link-meta">
                    <span className="click-count">
                      {url.clickCount} {url.clickCount === 1 ? 'click' : 'clicks'}
                    </span>
                    <span>Last {formatWhen(url.lastClickedAt)}</span>
                    <span className={expired ? 'badge badge-expired' : 'badge'}>
                      {expirationLabel(url.expiresAt)}
                    </span>
                  </div>
                  {url.clickCount > 0 ? (
                    <div className="link-analytics">
                      <p>
                        <span className="analytics-label">Device</span>
                        {formatBreakdown(url.analytics.devices)}
                      </p>
                      <p>
                        <span className="analytics-label">Browser</span>
                        {formatBreakdown(url.analytics.browsers)}
                      </p>
                      <p>
                        <span className="analytics-label">OS</span>
                        {formatBreakdown(url.analytics.operatingSystems)}
                      </p>
                      <p>
                        <span className="analytics-label">From</span>
                        {formatBreakdown(url.analytics.referrers)}
                      </p>
                    </div>
                  ) : null}
                  <div className="link-expire">
                    <label className="label" htmlFor={`expire-${url.id}`}>
                      Expiration
                    </label>
                    <input
                      id={`expire-${url.id}`}
                      className="field expire-input"
                      type="datetime-local"
                      value={drafts[url.id] ?? toDatetimeLocal(url.expiresAt)}
                      disabled={savingId === url.id}
                      onChange={(event) => {
                        setDrafts((current) => ({
                          ...current,
                          [url.id]: event.target.value,
                        }))
                      }}
                    />
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={savingId === url.id}
                      onClick={() => handleSetExpiration(url.id, url.expiresAt)}
                    >
                      {savingId === url.id ? 'Saving…' : 'Set'}
                    </button>
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={savingId === url.id || !url.expiresAt}
                      onClick={() => {
                        setDrafts((current) => ({ ...current, [url.id]: '' }))
                        void saveExpiration(url.id, null)
                      }}
                    >
                      Never expire
                    </button>
                  </div>
                  {expireNotice?.id === url.id ? (
                    <p
                      className={
                        expireNotice.kind === 'error'
                          ? 'status status-error'
                          : 'status'
                      }
                    >
                      {expireNotice.text}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function formatBreakdown(
  items: { label: string; count: number }[],
): string {
  if (items.length === 0) {
    return '—'
  }

  return items.map((item) => `${item.label} ${item.count}`).join(' · ')
}

function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now())
}

function expirationLabel(expiresAt: string | null): string {
  if (!expiresAt) {
    return 'Never expires'
  }

  if (isExpired(expiresAt)) {
    return 'Expired'
  }

  return `Active until ${formatWhen(expiresAt)}`
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) {
    return ''
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatWhen(iso: string | null): string {
  if (!iso) {
    return 'never'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}
