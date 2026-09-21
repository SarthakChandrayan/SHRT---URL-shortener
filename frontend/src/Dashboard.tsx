import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { ApiError, getShortUrl, listUrls, updateUrlExpiration, type UrlStats } from './api.ts'
import { AuthOverlay } from './AuthOverlay.tsx'
import { useAuth } from './AuthContext.tsx'
import { copyText } from './copy.ts'
import { parseExpiresInput } from './validate.ts'

const ClicksOverTime = lazy(() => import('./ClicksOverTime.tsx'))

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
  const [openId, setOpenId] = useState<string | null>(null)
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
        <p className="status">Checking your session…</p>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return (
      <div className="dash">
        <div className="dash-head dash-head-guest">
          <div>
            <h1 className="dash-title">Your links</h1>
            <p className="dash-lede">
              Sign in to see the short links you've created and how many
              clicks each one has.
            </p>
          </div>
          <button
            className="button button-primary button-compact"
            type="button"
            onClick={() => setAuthOpen(true)}
          >
            Sign in
          </button>
        </div>
        <GuestPreview onSignIn={() => setAuthOpen(true)} />
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
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Your links</h1>
          <p className="dash-stats">
            {state.kind === 'ready'
              ? `${urls.length} ${urls.length === 1 ? 'link' : 'links'} · ${totalClicks} ${totalClicks === 1 ? 'click' : 'clicks'} · ${activeCount} active`
              : state.kind === 'loading'
                ? 'Loading…'
                : 'Could not load stats'}
          </p>
        </div>
        <div className="dash-actions">
          <button
            className="text-action"
            type="button"
            onClick={() => {
              void handleRefresh()
            }}
            disabled={state.kind === 'loading' || refreshing}
          >
            {state.kind === 'loading' || refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="button button-primary button-compact"
            type="button"
            onClick={onCreate}
          >
            Shorten URL
          </button>
        </div>
      </div>

      <section className="dash-panel" aria-live="polite">
        {state.kind === 'loading' ? (
          <p className="status">Loading click stats…</p>
        ) : state.kind === 'error' ? (
          <p className="status status-error">{state.message}</p>
        ) : urls.length === 0 ? (
          <div className="dash-empty">
            <p className="status">No short URLs yet.</p>
            <button
              className="button button-ghost button-compact"
              type="button"
              onClick={onCreate}
            >
              Create one
            </button>
          </div>
        ) : (
          <ul className="link-list">
            {urls.map((url) => {
              const shortUrl = getShortUrl(url.shortCode)
              const expired = isExpired(url.expiresAt)
              const open = openId === url.id

              return (
                <li key={url.id} className={`link-card${open ? ' is-open' : ''}`}>
                  <div className="link-row">
                    <div className="link-main">
                      <a
                        className="link-short"
                        href={shortUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortUrl}
                      </a>
                      <p className="original" title={url.originalUrl}>
                        {url.originalUrl}
                      </p>
                    </div>
                    <div className="link-aside">
                      <span className="click-count">
                        {url.clickCount} {url.clickCount === 1 ? 'click' : 'clicks'}
                      </span>
                      {expired ? (
                        <span className="badge badge-expired">Expired</span>
                      ) : null}
                      <button
                        className={`text-action${copiedId === url.id ? ' is-copied' : ''}`}
                        type="button"
                        onClick={() => {
                          void handleCopy(url.id, shortUrl)
                        }}
                      >
                        {copiedId === url.id ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : url.id)}
                      >
                        {open ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="link-details">
                      <p className="link-detail-meta">
                        Last click {formatWhen(url.lastClickedAt)}
                        {url.expiresAt
                          ? ` · ${expired ? 'Expired' : 'Expires'} ${formatWhen(url.expiresAt)}`
                          : ' · Never expires'}
                      </p>
                      <Suspense
                        fallback={
                          <section className="clicks-over-time" aria-live="polite">
                            <p className="clicks-over-time-kicker">Last 7 days</p>
                            <p className="status">Loading daily clicks…</p>
                          </section>
                        }
                      >
                        <ClicksOverTime urlId={url.id} />
                      </Suspense>
                      {url.clickCount > 0 ? (
                        <div className="link-analytics">
                          <AnalyticsRow
                            label="Device"
                            items={url.analytics.devices}
                          />
                          <AnalyticsRow
                            label="Browser"
                            items={url.analytics.browsers}
                          />
                          <AnalyticsRow
                            label="OS"
                            items={url.analytics.operatingSystems}
                          />
                          <AnalyticsRow
                            label="From"
                            items={url.analytics.referrers}
                          />
                          <AnalyticsRow
                            label="Country"
                            items={url.analytics.countries}
                          />
                        </div>
                      ) : (
                        <p className="status">No clicks yet.</p>
                      )}
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
                          className="button button-ghost button-compact"
                          type="button"
                          disabled={savingId === url.id}
                          onClick={() => handleSetExpiration(url.id, url.expiresAt)}
                        >
                          {savingId === url.id ? 'Saving…' : 'Set'}
                        </button>
                        <button
                          className="button button-ghost button-compact"
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
                    </div>
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

type PreviewLink = {
  code: string
  original: string
  clicks: number
  lastClick: string
  open?: boolean
  devices?: { label: string; count: number }[]
  countries?: { label: string; count: number }[]
  referrers?: { label: string; count: number }[]
}

const PREVIEW_LINKS: PreviewLink[] = [
  {
    code: 'docs',
    original: 'https://example.com/getting-started',
    clicks: 48,
    lastClick: '2 hours ago',
    open: true,
    devices: [
      { label: 'desktop', count: 31 },
      { label: 'mobile', count: 17 },
    ],
    countries: [
      { label: 'India', count: 29 },
      { label: 'United States', count: 12 },
      { label: 'Germany', count: 7 },
    ],
    referrers: [
      { label: 'direct', count: 22 },
      { label: 'twitter.com', count: 16 },
      { label: 'google.com', count: 10 },
    ],
  },
  {
    code: 'launch',
    original: 'https://example.com/announcement',
    clicks: 12,
    lastClick: 'yesterday',
  },
  {
    code: 'bio',
    original: 'https://example.com/about',
    clicks: 3,
    lastClick: '4 days ago',
  },
]

function GuestPreview({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="dash-panel dash-preview">
      <p className="dash-preview-tag">Example</p>
      <ul className="link-list">
        {PREVIEW_LINKS.map((link) => {
          const shortUrl = getShortUrl(link.code)

          return (
            <li key={link.code} className={`link-card${link.open ? ' is-open' : ''}`}>
              <div className="link-row">
                <div className="link-main">
                  <span className="link-short">{shortUrl}</span>
                  <p className="original" title={link.original}>
                    {link.original}
                  </p>
                </div>
                <div className="link-aside">
                  <span className="click-count">
                    {link.clicks} {link.clicks === 1 ? 'click' : 'clicks'}
                  </span>
                  <span className="text-action">{link.open ? 'Hide' : 'Details'}</span>
                </div>
              </div>
              {link.open ? (
                <div className="link-details">
                  <p className="link-detail-meta">Last click {link.lastClick} · Never expires</p>
                  <div className="link-analytics">
                    <AnalyticsRow label="Device" items={link.devices ?? []} />
                    <AnalyticsRow label="From" items={link.referrers ?? []} />
                    <AnalyticsRow label="Country" items={link.countries ?? []} />
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <button className="dash-preview-cover" type="button" onClick={onSignIn}>
        Sign in to see your links
      </button>
    </section>
  )
}

function AnalyticsRow({
  label,
  items,
}: {
  label: string
  items: { label: string; count: number }[]
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <p>
      <span className="analytics-label">{label}</span>
      <Breakdown items={items} />
    </p>
  )
}

function displayLabel(label: string): string {
  if (label === 'unknown') {
    return 'Unidentified'
  }

  if (label === 'local') {
    return 'This device'
  }

  if (label === 'direct') {
    return 'Direct'
  }

  if (label === 'desktop' || label === 'mobile' || label === 'tablet') {
    return label[0].toUpperCase() + label.slice(1)
  }

  return label
}

function Breakdown({
  items,
}: {
  items: { label: string; count: number }[]
}) {
  return (
    <span className="analytics-items">
      {items.map((item) => (
        <span key={item.label} className="analytics-item">
          <span className="analytics-item-label">{displayLabel(item.label)}</span>
          <span className="analytics-item-count">
            {item.count} {item.count === 1 ? 'click' : 'clicks'}
          </span>
        </span>
      ))}
    </span>
  )
}

function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now())
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
