import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { getShortUrl, listUrls, type ClickBreakdown, type UrlStats } from './api.ts'
import { useAuth } from './AuthContext.tsx'
import { copyText } from './copy.ts'
import { displayHost, formatWhen, isExpired, plural, relativeTime } from './format.ts'
import {
  ChevronIcon,
  CopyIcon,
  EditIcon,
  ExternalIcon,
  PlusIcon,
  QrIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  CheckIcon,
} from './icons.tsx'
import { DeleteLinkModal, EditLinkModal, QrModal } from './LinkModals.tsx'
import { useToast } from './Toast.tsx'

const ClicksOverTime = lazy(() => import('./ClicksOverTime.tsx'))

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; urls: UrlStats[] }
  | { kind: 'error'; message: string }

type Filter = 'all' | 'active' | 'expired'
type Sort = 'newest' | 'oldest' | 'clicks' | 'recent'

type DialogState = { kind: 'edit' | 'delete' | 'qr'; link: UrlStats } | null

type DashboardProps = {
  onCreate: () => void
  onSignIn: () => void
}

export function Dashboard({ onCreate, onSignIn }: DashboardProps) {
  const { status } = useAuth()
  const toast = useToast()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')

  const load = useCallback(async () => {
    try {
      const urls = await listUrls()
      setState({ kind: 'ready', urls })
    } catch (error) {
      setState((current) =>
        // Keep showing stale data on a failed background refresh.
        current.kind === 'ready'
          ? current
          : {
              kind: 'error',
              message: error instanceof Error ? error.message : 'Could not load your links',
            },
      )
      if (error instanceof Error) {
        toast(error.message, 'error')
      }
    }
  }, [toast])

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

  const urls = useMemo(() => (state.kind === 'ready' ? state.urls : []), [state])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()

    const filtered = urls.filter((url) => {
      const expired = isExpired(url.expiresAt)
      if (filter === 'active' && expired) {
        return false
      }
      if (filter === 'expired' && !expired) {
        return false
      }
      return (
        !needle ||
        url.shortCode.toLowerCase().includes(needle) ||
        url.originalUrl.toLowerCase().includes(needle)
      )
    })

    const time = (iso: string | null) => (iso ? Date.parse(iso) : 0)

    return filtered.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return time(a.createdAt) - time(b.createdAt)
        case 'clicks':
          return b.clickCount - a.clickCount || time(b.createdAt) - time(a.createdAt)
        case 'recent':
          return time(b.lastClickedAt) - time(a.lastClickedAt)
        default:
          return time(b.createdAt) - time(a.createdAt)
      }
    })
  }, [urls, query, filter, sort])

  async function handleCopy(id: string, shortUrl: string) {
    try {
      await copyText(shortUrl)
      setCopiedId(id)
    } catch {
      toast('Could not copy the link', 'error')
    }
  }

  function handleDeleted(id: string) {
    setState((current) =>
      current.kind === 'ready'
        ? { kind: 'ready', urls: current.urls.filter((url) => url.id !== id) }
        : current,
    )
    if (openId === id) {
      setOpenId(null)
    }
  }

  if (status === 'loading') {
    return (
      <div className="dash">
        <DashSkeleton />
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
              Sign in to see the short links you've created and how each one is
              performing.
            </p>
          </div>
          <button className="button button-primary button-compact" type="button" onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <GuestPreview onSignIn={onSignIn} />
      </div>
    )
  }

  const totalClicks = urls.reduce((sum, url) => sum + url.clickCount, 0)
  const activeCount = urls.filter((url) => !isExpired(url.expiresAt)).length
  const topLink = urls.reduce<UrlStats | null>(
    (best, url) => (url.clickCount > (best?.clickCount ?? 0) ? url : best),
    null,
  )
  const dialogShortUrl = dialog ? getShortUrl(dialog.link.shortCode) : ''

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Your links</h1>
          <p className="dash-lede">Manage your short links and see how they perform.</p>
        </div>
        <div className="dash-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => {
              void handleRefresh()
            }}
            disabled={state.kind === 'loading' || refreshing}
          >
            <RefreshIcon size={16} className={refreshing ? 'spin' : undefined} />
          </button>
          <button className="button button-primary button-compact" type="button" onClick={onCreate}>
            <PlusIcon size={14} />
            New link
          </button>
        </div>
      </div>

      {state.kind === 'loading' ? (
        <DashSkeleton />
      ) : state.kind === 'error' ? (
        <section className="dash-panel dash-message">
          <p className="status status-error">{state.message}</p>
          <button
            className="button button-ghost button-compact"
            type="button"
            onClick={() => {
              setState({ kind: 'loading' })
              void load()
            }}
          >
            Try again
          </button>
        </section>
      ) : urls.length === 0 ? (
        <section className="dash-panel dash-empty">
          <p className="dash-empty-title">No short links yet</p>
          <p className="dash-lede">
            Create your first link and its clicks will show up here.
          </p>
          <button className="button button-primary button-compact" type="button" onClick={onCreate}>
            <PlusIcon size={14} />
            Create a link
          </button>
        </section>
      ) : (
        <>
          <div className="stats" role="list">
            <Stat label="Links" value={urls.length.toLocaleString()} />
            <Stat label="Total clicks" value={totalClicks.toLocaleString()} />
            <Stat
              label="Active"
              value={activeCount.toLocaleString()}
              hint={urls.length > activeCount ? `${urls.length - activeCount} expired` : undefined}
            />
            <Stat
              label="Top link"
              value={topLink ? `/${topLink.shortCode}` : '—'}
              hint={topLink ? plural(topLink.clickCount, 'click') : 'No clicks yet'}
              mono
            />
          </div>

          <div className="toolbar">
            <label className="search">
              <SearchIcon size={15} />
              <span className="label">Search links</span>
              <input
                type="search"
                placeholder="Search by alias or destination"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="chips" role="radiogroup" aria-label="Filter links">
              {(['all', 'active', 'expired'] as const).map((value) => (
                <button
                  key={value}
                  className={`chip${filter === value ? ' is-active' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <label className="select">
              <span className="label">Sort links</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="clicks">Most clicks</option>
                <option value="recent">Recently clicked</option>
              </select>
              <ChevronIcon size={14} />
            </label>
          </div>

          <section className="dash-panel" aria-live="polite">
            {visible.length === 0 ? (
              <div className="dash-message">
                <p className="status">No links match these filters.</p>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <ul className="link-list">
                {visible.map((url) => (
                  <LinkCard
                    key={url.id}
                    url={url}
                    open={openId === url.id}
                    copied={copiedId === url.id}
                    onToggle={() => setOpenId(openId === url.id ? null : url.id)}
                    onCopy={(shortUrl) => {
                      void handleCopy(url.id, shortUrl)
                    }}
                    onDialog={(kind) => setDialog({ kind, link: url })}
                  />
                ))}
              </ul>
            )}
          </section>
          <p className="dash-count">
            Showing {visible.length} of {plural(urls.length, 'link')}
          </p>
        </>
      )}

      <EditLinkModal
        key={`edit-${dialog?.kind === 'edit' ? dialog.link.id : ''}`}
        link={dialog?.kind === 'edit' ? dialog.link : null}
        shortUrl={dialogShortUrl}
        onClose={() => setDialog(null)}
        onSaved={() => {
          void load()
        }}
      />
      <DeleteLinkModal
        key={`delete-${dialog?.kind === 'delete' ? dialog.link.id : ''}`}
        link={dialog?.kind === 'delete' ? dialog.link : null}
        shortUrl={dialogShortUrl}
        onClose={() => setDialog(null)}
        onDeleted={handleDeleted}
      />
      <QrModal
        link={dialog?.kind === 'qr' ? dialog.link : null}
        shortUrl={dialogShortUrl}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  mono,
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
}) {
  return (
    <div className="stat" role="listitem">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${mono ? ' stat-value-mono' : ''}`} title={value}>
        {value}
      </span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  )
}

type LinkCardProps = {
  url: UrlStats
  open: boolean
  copied: boolean
  onToggle: () => void
  onCopy: (shortUrl: string) => void
  onDialog: (kind: 'edit' | 'delete' | 'qr') => void
}

function LinkCard({ url, open, copied, onToggle, onCopy, onDialog }: LinkCardProps) {
  const shortUrl = getShortUrl(url.shortCode)
  const expired = isExpired(url.expiresAt)
  const detailsId = `link-details-${url.id}`

  return (
    <li className={`link-card${open ? ' is-open' : ''}${expired ? ' is-expired' : ''}`}>
      <div className="link-row">
        <div className="link-main">
          <div className="link-title">
            <a className="link-short" href={shortUrl} target="_blank" rel="noreferrer">
              {shortUrl.replace(/^https?:\/\//, '')}
            </a>
            {expired ? (
              <span className="badge badge-expired">Expired</span>
            ) : url.expiresAt ? (
              <span className="badge" title={formatWhen(url.expiresAt)}>
                Expires {relativeTime(url.expiresAt)}
              </span>
            ) : null}
          </div>
          <p className="original" title={url.originalUrl}>
            <span className="original-host">{displayHost(url.originalUrl)}</span>
            {url.originalUrl}
          </p>
          <p className="link-meta">
            Created {relativeTime(url.createdAt)}
            {url.lastClickedAt ? ` · Last click ${relativeTime(url.lastClickedAt)}` : ''}
          </p>
        </div>
        <div className="link-aside">
          <button
            className="click-count"
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={onToggle}
          >
            <strong>{url.clickCount.toLocaleString()}</strong>
            {url.clickCount === 1 ? 'click' : 'clicks'}
          </button>
          <div className="link-tools">
            <button
              className={`icon-button${copied ? ' is-copied' : ''}`}
              type="button"
              aria-label={copied ? 'Copied' : `Copy ${shortUrl}`}
              title={copied ? 'Copied' : 'Copy link'}
              onClick={() => onCopy(shortUrl)}
            >
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Show QR code"
              title="QR code"
              onClick={() => onDialog('qr')}
            >
              <QrIcon size={15} />
            </button>
            <a
              className="icon-button"
              href={url.originalUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open destination"
              title="Open destination (not counted as a click)"
            >
              <ExternalIcon size={15} />
            </a>
            <button
              className="icon-button"
              type="button"
              aria-label="Edit link"
              title="Edit"
              onClick={() => onDialog('edit')}
            >
              <EditIcon size={15} />
            </button>
            <button
              className="icon-button icon-button-danger"
              type="button"
              aria-label="Delete link"
              title="Delete"
              onClick={() => onDialog('delete')}
            >
              <TrashIcon size={15} />
            </button>
            <button
              className={`icon-button details-toggle${open ? ' is-open' : ''}`}
              type="button"
              aria-label={open ? 'Hide analytics' : 'Show analytics'}
              title={open ? 'Hide analytics' : 'Analytics'}
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={onToggle}
            >
              <ChevronIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="link-details" id={detailsId}>
          <Suspense fallback={<div className="skeleton skeleton-chart" />}>
            <ClicksOverTime urlId={url.id} />
          </Suspense>
          {url.clickCount > 0 ? (
            <div className="breakdowns">
              <BreakdownCard label="Browsers" items={url.analytics.browsers} total={url.clickCount} />
              <BreakdownCard
                label="Operating systems"
                items={url.analytics.operatingSystems}
                total={url.clickCount}
              />
              <BreakdownCard label="Referrers" items={url.analytics.referrers} total={url.clickCount} />
              <BreakdownCard label="Countries" items={url.analytics.countries} total={url.clickCount} />
            </div>
          ) : (
            <p className="status">No clicks yet. Share the link to start collecting analytics.</p>
          )}
          <p className="link-detail-meta">
            Created {formatWhen(url.createdAt)} ·{' '}
            {url.expiresAt
              ? `${expired ? 'Expired' : 'Expires'} ${formatWhen(url.expiresAt)}`
              : 'Never expires'}
          </p>
        </div>
      ) : null}
    </li>
  )
}

const BREAKDOWN_LIMIT = 5

function BreakdownCard({
  label,
  items,
  total,
}: {
  label: string
  items: ClickBreakdown[]
  total: number
}) {
  if (items.length === 0) {
    return null
  }

  const shown = items.slice(0, BREAKDOWN_LIMIT)
  const rest = items.slice(BREAKDOWN_LIMIT).reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="breakdown">
      <p className="breakdown-title">{label}</p>
      <ul className="breakdown-list">
        {shown.map((item) => (
          <BreakdownRow key={item.label} label={displayLabel(item.label)} count={item.count} total={total} />
        ))}
        {rest > 0 ? <BreakdownRow label="Other" count={rest} total={total} /> : null}
      </ul>
    </div>
  )
}

function BreakdownRow({ label, count, total }: { label: string; count: number; total: number }) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <li className="breakdown-row">
      <span className="breakdown-bar" style={{ width: `${share}%` }} aria-hidden="true" />
      <span className="breakdown-label" title={label}>
        {label}
      </span>
      <span className="breakdown-count">
        {count.toLocaleString()} <span className="breakdown-share">{share}%</span>
      </span>
    </li>
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
    return 'Direct / none'
  }

  if (label === 'desktop' || label === 'mobile' || label === 'tablet') {
    return label[0].toUpperCase() + label.slice(1)
  }

  return label
}

function DashSkeleton() {
  return (
    <div className="dash-skeleton" aria-busy="true" aria-label="Loading your links">
      <div className="stats">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="stat">
            <span className="skeleton skeleton-line skeleton-short" />
            <span className="skeleton skeleton-line skeleton-value" />
          </div>
        ))}
      </div>
      <div className="dash-panel">
        {[0, 1, 2].map((key) => (
          <div key={key} className="link-card">
            <span className="skeleton skeleton-line skeleton-medium" />
            <span className="skeleton skeleton-line skeleton-long" />
          </div>
        ))}
      </div>
    </div>
  )
}

type PreviewLink = {
  code: string
  original: string
  clicks: number
  created: string
}

const PREVIEW_LINKS: PreviewLink[] = [
  { code: 'docs', original: 'https://example.com/getting-started', clicks: 48, created: '2 days ago' },
  { code: 'launch', original: 'https://example.com/announcement', clicks: 12, created: 'last week' },
  { code: 'bio', original: 'https://example.com/about', clicks: 3, created: 'last month' },
]

function GuestPreview({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="dash-preview" aria-label="Example dashboard">
      <div className="stats" aria-hidden="true">
        <Stat label="Links" value="3" />
        <Stat label="Total clicks" value="63" />
        <Stat label="Active" value="3" />
        <Stat label="Top link" value="/docs" hint="48 clicks" mono />
      </div>
      <div className="dash-panel" aria-hidden="true">
        <ul className="link-list">
          {PREVIEW_LINKS.map((link) => (
            <li key={link.code} className="link-card">
              <div className="link-row">
                <div className="link-main">
                  <span className="link-short">
                    {getShortUrl(link.code).replace(/^https?:\/\//, '')}
                  </span>
                  <p className="original">
                    <span className="original-host">{displayHost(link.original)}</span>
                    {link.original}
                  </p>
                  <p className="link-meta">Created {link.created}</p>
                </div>
                <div className="link-aside">
                  <span className="click-count">
                    <strong>{link.clicks}</strong>
                    clicks
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <button className="dash-preview-cover" type="button" onClick={onSignIn}>
        <span className="button button-primary button-compact">Sign in to see your links</span>
      </button>
    </section>
  )
}
