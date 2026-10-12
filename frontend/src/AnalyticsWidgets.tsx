import { useState } from 'react'
import type { ClickBreakdown, HeatmapCell, TopLink } from './api.ts'
import { getShortUrl } from './api.ts'
import {
  breakdownLabel,
  delta,
  formatCount,
  formatHour,
  RANGE_OPTIONS,
  WEEKDAYS,
  type RangeDays,
} from './analytics-format.ts'
import { displayHost } from './format.ts'

export function RangePicker({
  value,
  onChange,
  small,
}: {
  value: RangeDays
  onChange: (days: RangeDays) => void
  small?: boolean
}) {
  return (
    <div className={`chips${small ? ' chips-small' : ''}`} role="radiogroup" aria-label="Date range">
      {RANGE_OPTIONS.map((days) => (
        <button
          key={days}
          className={`chip${value === days ? ' is-active' : ''}`}
          type="button"
          role="radio"
          aria-checked={value === days}
          onClick={() => onChange(days)}
        >
          {small ? (
            `${days}d`
          ) : (
            <>
              <span className="chip-prefix">Last </span>
              {days} days
            </>
          )}
        </button>
      ))}
    </div>
  )
}

export function DeltaBadge({
  current,
  previous,
  days,
}: {
  current: number
  previous: number
  days: number
}) {
  const change = delta(current, previous)
  const period = `vs previous ${days} days`

  if (change.kind === 'none') {
    return <span className="delta delta-flat">No data {period}</span>
  }

  if (change.kind === 'new') {
    return (
      <span className="delta delta-up" title={`0 ${period}`}>
        New {period}
      </span>
    )
  }

  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■'
  const word = change.direction === 'up' ? 'up' : change.direction === 'down' ? 'down' : 'no change'

  return (
    <span
      className={`delta delta-${change.direction}`}
      title={`${previous.toLocaleString()} ${period}`}
    >
      <span aria-hidden="true">{arrow}</span>
      <span className="label">{word}</span> {change.percent}%{' '}
      <span className="delta-period">{period}</span>
    </span>
  )
}

export function Kpi({
  label,
  value,
  previous,
  days,
  hint,
  swatch,
}: {
  label: string
  value: number | string
  previous?: number
  days?: number
  hint?: string
  swatch?: string
}) {
  return (
    <div className="kpi">
      <span className="kpi-label">
        {swatch ? <span className="kpi-swatch" style={{ background: swatch }} aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="kpi-value">{typeof value === 'number' ? formatCount(value) : value}</span>
      {typeof value === 'number' && previous !== undefined && days !== undefined ? (
        <DeltaBadge current={value} previous={previous} days={days} />
      ) : hint ? (
        <span className="kpi-hint">{hint}</span>
      ) : null}
    </div>
  )
}

const BREAKDOWN_LIMIT = 6

export function BreakdownPanel({
  title,
  items,
  total,
  emptyText = 'No data yet',
}: {
  title: string
  items: ClickBreakdown[]
  total: number
  emptyText?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, BREAKDOWN_LIMIT)
  const hidden = items.length - visible.length

  return (
    <section className="breakdown" aria-label={title}>
      <p className="breakdown-title">{title}</p>
      {items.length === 0 ? (
        <p className="breakdown-empty">{emptyText}</p>
      ) : (
        <ul className="breakdown-list">
          {visible.map((item) => {
            const share = total > 0 ? Math.round((item.count / total) * 100) : 0
            const label = breakdownLabel(item.label)

            return (
              <li key={item.label} className="breakdown-row">
                <span className="breakdown-bar" style={{ width: `${share}%` }} aria-hidden="true" />
                <span className="breakdown-label" title={label}>
                  {label}
                </span>
                <span className="breakdown-count">
                  {formatCount(item.count)} <span className="breakdown-share">{share}%</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {hidden > 0 || expanded ? (
        <button className="text-action breakdown-more" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  )
}

/** Sequential single-hue scale: 5 steps of the clicks color by share of the max. */
function heatLevel(clicks: number, max: number): number {
  if (clicks === 0 || max === 0) {
    return 0
  }
  return Math.min(4, Math.ceil((clicks / max) * 4))
}

export function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const cell of cells) {
    if (cell.day >= 0 && cell.day < 7 && cell.hour >= 0 && cell.hour < 24) {
      grid[cell.day][cell.hour] += cell.clicks
    }
  }

  const max = Math.max(0, ...grid.flat())
  let busiest: { day: number; hour: number; clicks: number } | null = null
  grid.forEach((hours, day) =>
    hours.forEach((clicks, hour) => {
      if (clicks > 0 && (!busiest || clicks > busiest.clicks)) {
        busiest = { day, hour, clicks }
      }
    }),
  )
  const peak = busiest as { day: number; hour: number; clicks: number } | null

  return (
    <div className="heatmap">
      <p className="heatmap-summary">
        {peak ? (
          <>
            Busiest: <strong>{WEEKDAYS[peak.day]}s, {formatHour(peak.hour)}</strong> ·{' '}
            {formatCount(peak.clicks)} {peak.clicks === 1 ? 'click' : 'clicks'}
          </>
        ) : (
          'No clicks in this period'
        )}
      </p>
      <div className="heatmap-scroll">
        <table className="heatmap-grid">
          <caption className="label">Clicks by weekday and hour of day</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="label">Day</span>
              </th>
              {grid[0].map((_, hour) => (
                <th key={hour} scope="col" className="heatmap-hour">
                  {hour % 3 === 0 ? formatHour(hour).replace(' ', '').toLowerCase() : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((hours, day) => (
              <tr key={WEEKDAYS[day]}>
                <th scope="row" className="heatmap-day">
                  {WEEKDAYS[day].slice(0, 3)}
                </th>
                {hours.map((clicks, hour) => (
                  <td
                    key={hour}
                    className={`heat heat-${heatLevel(clicks, max)}`}
                    title={`${WEEKDAYS[day]} ${formatHour(hour)}: ${clicks.toLocaleString()} ${clicks === 1 ? 'click' : 'clicks'}`}
                  >
                    <span className="label">{clicks}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`heat heat-${level}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

/** Tiny inline trend for list rows; last point marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) {
    return null
  }

  const width = 88
  const height = 24
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const points = values.map((value, index) => [index * step, height - 3 - (value / max) * (height - 6)])
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]
  const total = values.reduce((sum, value) => sum + value, 0)

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`-3 0 ${width + 6} ${height}`}
      role="img"
      aria-label={`${label}: ${total.toLocaleString()} clicks in the last ${values.length} days`}
    >
      <title>{`${total.toLocaleString()} clicks in the last ${values.length} days`}</title>
      <polygon points={`0,${height} ${line} ${width},${height}`} className="sparkline-fill" />
      <polyline points={line} className="sparkline-line" />
      <circle cx={lastX} cy={lastY} r={2.5} className="sparkline-dot" />
    </svg>
  )
}

export function TopLinksTable({
  links,
  totalClicks,
}: {
  links: TopLink[]
  totalClicks: number
}) {
  if (links.length === 0) {
    return <p className="breakdown-empty">No clicks in this period</p>
  }

  return (
    <table className="top-links">
      <thead>
        <tr>
          <th scope="col">Link</th>
          <th scope="col" className="num">
            Clicks
          </th>
          <th scope="col" className="num">
            Visitors
          </th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => {
          const share = totalClicks > 0 ? (link.clicks / totalClicks) * 100 : 0
          const shortUrl = getShortUrl(link.shortCode)

          return (
            <tr key={link.id}>
              <td>
                <a className="top-link-code" href={shortUrl} target="_blank" rel="noreferrer">
                  /{link.shortCode}
                </a>
                <span className="top-link-dest" title={link.originalUrl}>
                  {displayHost(link.originalUrl)}
                </span>
                <span className="top-link-bar" aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </span>
              </td>
              <td className="num">{formatCount(link.clicks)}</td>
              <td className="num">{formatCount(link.visitors)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
