import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  checkAliasAvailability,
  createShortUrl,
  getShortPrefix,
  getShortUrl,
  type CreatedUrl,
} from './api.ts'
import { useAuth } from './AuthContext.tsx'
import { copyText } from './copy.ts'
import {
  EXPIRY_PRESETS,
  formatWhen,
  resolveExpiry,
  type ExpiryPreset,
} from './format.ts'
import {
  ChartIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CopyIcon,
  ExternalIcon,
  LinkIcon,
  QrIcon,
  ShareIcon,
} from './icons.tsx'
import { clearPending, readPending, savePending, type PendingShorten } from './pending.ts'
import { QrCode } from './QrCode.tsx'
import { useToast } from './Toast.tsx'
import { ALIAS_MAX_LENGTH, validateAlias, validateOriginalUrl } from './validate.ts'

const WORK_STEPS = ['Checking URL', 'Creating short code', 'Saving']

type View =
  | { kind: 'form'; error: string | null }
  | { kind: 'success'; created: CreatedUrl; shortUrl: string }

type AliasCheck =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

type HomeProps = {
  onRequireAuth: () => void
  onOpenDashboard: () => void
  onBusyChange: (busy: boolean) => void
}

export function Home({ onRequireAuth, onOpenDashboard, onBusyChange }: HomeProps) {
  const { status } = useAuth()
  const toast = useToast()
  const [input, setInput] = useState('')
  const [alias, setAlias] = useState('')
  const [preset, setPreset] = useState<ExpiryPreset>('never')
  const [custom, setCustom] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [workStep, setWorkStep] = useState(0)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [view, setView] = useState<View>({ kind: 'form', error: null })
  const [aliasCheck, setAliasCheck] = useState<AliasCheck>({ kind: 'idle' })
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const probe = inspectUrl(input)
  const aliasError = validateAlias(alias)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    onBusyChange(loading)
  }, [loading, onBusyChange])

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

  // Live alias availability (signed-in only; the endpoint needs a session).
  useEffect(() => {
    const value = alias.trim()

    if (!value || aliasError || status !== 'authenticated') {
      setAliasCheck({ kind: 'idle' })
      return
    }

    const controller = new AbortController()
    setAliasCheck({ kind: 'checking' })

    const timer = window.setTimeout(() => {
      checkAliasAvailability(value, { signal: controller.signal })
        .then((result) => {
          setAliasCheck(
            result.available
              ? { kind: 'available' }
              : { kind: 'unavailable', reason: result.reason },
          )
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setAliasCheck({ kind: 'idle' })
          }
        })
    }, 400)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [alias, aliasError, status])

  async function performShorten(pending: PendingShorten) {
    const expiry = resolveExpiry(pending.preset, pending.custom)

    if ('error' in expiry) {
      setOptionsOpen(true)
      setView({ kind: 'form', error: expiry.error })
      return
    }

    submittingRef.current = true
    setLoading(true)
    setView({ kind: 'form', error: null })

    try {
      const created = await createShortUrl(pending.url, {
        alias: pending.alias,
        expiresAt: expiry.expiresAt,
      })
      setView({ kind: 'success', created, shortUrl: getShortUrl(created.shortCode) })
      setCopied(false)
      setShowQr(false)
    } catch (error) {
      setView({
        kind: 'form',
        error: error instanceof Error ? error.message : 'Could not shorten this URL',
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

    const url = input.trim()
    const validationError = validateOriginalUrl(url) ?? aliasError

    if (validationError) {
      if (aliasError) {
        setOptionsOpen(true)
      }
      setView({ kind: 'form', error: validationError })
      return
    }

    if (aliasCheck.kind === 'unavailable') {
      setOptionsOpen(true)
      setView({ kind: 'form', error: aliasCheck.reason })
      return
    }

    const pending: PendingShorten = { url, alias: alias.trim(), preset, custom }

    if (status !== 'authenticated') {
      // Hold the request until the visitor signs up/in, then resume it —
      // even across a full-page Google OAuth redirect.
      savePending(pending)
      onRequireAuth()
      return
    }

    await performShorten(pending)
  }

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

    const pending = readPending()
    if (!pending) {
      return
    }

    clearPending()
    setInput(pending.url)
    setAlias(pending.alias)
    setPreset(pending.preset)
    setCustom(pending.custom)
    if (pending.alias || pending.preset !== 'never') {
      setOptionsOpen(true)
    }
    void performShorten(pending)
    // One-shot resume after sign-in; performShorten's identity doesn't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function handleCopy(shortUrl: string) {
    try {
      await copyText(shortUrl)
      setCopied(true)
    } catch {
      toast('Could not copy. Select the link and copy it manually.', 'error')
    }
  }

  async function handleShare(shortUrl: string) {
    try {
      await navigator.share({ url: shortUrl })
    } catch {
      // User dismissed the share sheet.
    }
  }

  function handleReset() {
    clearPending()
    setInput('')
    setAlias('')
    setPreset('never')
    setCustom('')
    setCopied(false)
    setShowQr(false)
    setView({ kind: 'form', error: null })
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const consoleState = loading
    ? 'is-busy'
    : view.kind === 'success'
      ? 'is-live'
      : probe.locked
        ? 'is-armed'
        : ''

  const optionsSummary = [
    alias.trim() ? `/${alias.trim()}` : null,
    preset !== 'never'
      ? `expires ${EXPIRY_PRESETS.find((item) => item.value === preset)?.label.toLowerCase()}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="intro">
        <p className="kicker">Link shortener &amp; analytics</p>
        <h1 className="headline">
          Shorten a long URL.
          <br />
          <span className="headline-accent">Keep the destination.</span>
        </h1>
        <p className="lede">
          Paste a link to get a short one you can share anywhere. Pick a custom
          alias, set it to expire, and see who clicks.
        </p>
        <ul className="features">
          <li>
            <LinkIcon size={18} />
            <span>
              <strong>Custom aliases</strong>
              Short links people remember
            </span>
          </li>
          <li>
            <ChartIcon size={18} />
            <span>
              <strong>Click analytics</strong>
              Devices, countries and referrers
            </span>
          </li>
          <li>
            <QrIcon size={18} />
            <span>
              <strong>QR codes</strong>
              Ready for print and slides
            </span>
          </li>
        </ul>
      </div>

      <section className={`console ${consoleState}`.trim()} aria-live="polite">
        <div className="console-frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="console-label">
          {view.kind === 'success' ? 'Your short link' : loading ? 'Creating' : 'Destination URL'}
        </div>

        {view.kind === 'form' ? (
          <form className="shorten" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="form">
              <label className="label" htmlFor="original-url">
                Destination URL
              </label>
              <input
                ref={inputRef}
                id="original-url"
                className="field"
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://example.com/very/long/path"
                value={input}
                disabled={loading}
                aria-invalid={Boolean(view.error)}
                aria-describedby="url-status"
                onChange={(event) => {
                  setInput(event.target.value)
                  if (view.error) {
                    setView({ kind: 'form', error: null })
                  }
                }}
              />
              <button className="button button-primary" type="submit" disabled={loading}>
                {loading ? 'Shortening…' : 'Shorten URL'}
              </button>
            </div>

            <div className="readout" aria-hidden="true">
              <span className={probe.locked ? 'on' : ''}>
                LOCK {probe.locked ? 'OK' : 'WAIT'}
              </span>
              <span>PROTO {probe.protocol}</span>
              <span>HOST {probe.host}</span>
              <span>{String(probe.chars).padStart(3, '0')} CH</span>
            </div>

            <button
              className={`options-toggle${optionsOpen ? ' is-open' : ''}`}
              type="button"
              aria-expanded={optionsOpen}
              aria-controls="shorten-options"
              onClick={() => setOptionsOpen((open) => !open)}
            >
              <ChevronIcon size={14} />
              Options
              {!optionsOpen && optionsSummary ? (
                <span className="options-summary">{optionsSummary}</span>
              ) : null}
            </button>

            {optionsOpen ? (
              <div className="options" id="shorten-options">
                <div className="option">
                  <label className="option-label" htmlFor="custom-alias">
                    Custom alias <span className="option-hint">optional</span>
                  </label>
                  <div
                    className={`prefixed-field${aliasError || aliasCheck.kind === 'unavailable' ? ' is-invalid' : ''}`}
                  >
                    <span className="prefixed-field-prefix">{getShortPrefix()}</span>
                    <input
                      id="custom-alias"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="my-link"
                      maxLength={ALIAS_MAX_LENGTH}
                      value={alias}
                      disabled={loading}
                      aria-describedby="alias-status"
                      onChange={(event) => {
                        setAlias(event.target.value.replace(/\s/g, '-'))
                        if (view.error) {
                          setView({ kind: 'form', error: null })
                        }
                      }}
                    />
                  </div>
                  <p
                    id="alias-status"
                    className={`option-status${
                      aliasError || aliasCheck.kind === 'unavailable'
                        ? ' is-error'
                        : aliasCheck.kind === 'available'
                          ? ' is-ok'
                          : ''
                    }`}
                  >
                    {aliasError ??
                      (aliasCheck.kind === 'checking'
                        ? 'Checking availability…'
                        : aliasCheck.kind === 'available'
                          ? 'Available'
                          : aliasCheck.kind === 'unavailable'
                            ? aliasCheck.reason
                            : 'Leave blank for a random 7-character code.')}
                  </p>
                </div>

                <div className="option">
                  <span className="option-label" id="expiry-label">
                    Expires
                  </span>
                  <div className="chips" role="radiogroup" aria-labelledby="expiry-label">
                    {EXPIRY_PRESETS.map((item) => (
                      <button
                        key={item.value}
                        className={`chip${preset === item.value ? ' is-active' : ''}`}
                        type="button"
                        role="radio"
                        aria-checked={preset === item.value}
                        disabled={loading}
                        onClick={() => setPreset(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {preset === 'custom' ? (
                    <input
                      className="field field-compact expire-input"
                      type="datetime-local"
                      aria-label="Custom expiration date"
                      value={custom}
                      disabled={loading}
                      onChange={(event) => setCustom(event.target.value)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            <p id="url-status" className={view.error ? 'status status-error' : 'status'}>
              {loading
                ? WORK_STEPS[workStep]
                : (view.error ?? 'HTTP and HTTPS URLs only.')}
            </p>
          </form>
        ) : (
          <div className="result">
            <div className="result-row">
              <p className="short-url">{view.shortUrl}</p>
              <button
                className={`button button-primary result-copy${copied ? ' is-copied' : ''}`}
                type="button"
                onClick={() => {
                  void handleCopy(view.shortUrl)
                }}
              >
                {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="result-tools">
              <a className="tool" href={view.shortUrl} target="_blank" rel="noreferrer">
                <ExternalIcon size={14} />
                Open
              </a>
              <button
                className={`tool${showQr ? ' is-active' : ''}`}
                type="button"
                aria-expanded={showQr}
                onClick={() => setShowQr((value) => !value)}
              >
                <QrIcon size={14} />
                QR code
              </button>
              {canShare ? (
                <button
                  className="tool"
                  type="button"
                  onClick={() => {
                    void handleShare(view.shortUrl)
                  }}
                >
                  <ShareIcon size={14} />
                  Share
                </button>
              ) : null}
            </div>

            {showQr ? <QrCode value={view.shortUrl} name={view.created.shortCode} /> : null}

            <dl className="result-meta">
              <div>
                <dt>Destination</dt>
                <dd title={view.created.originalUrl}>{view.created.originalUrl}</dd>
              </div>
              <div>
                <dt>
                  <ClockIcon size={12} /> Expires
                </dt>
                <dd>
                  {view.created.expiresAt ? formatWhen(view.created.expiresAt) : 'Never'}
                </dd>
              </div>
            </dl>

            <div className="result-actions">
              <button className="button button-ghost" type="button" onClick={handleReset}>
                Create another
              </button>
              <button className="button button-ghost" type="button" onClick={onOpenDashboard}>
                View dashboard
              </button>
            </div>
          </div>
        )}
      </section>
    </>
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
      (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)

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
