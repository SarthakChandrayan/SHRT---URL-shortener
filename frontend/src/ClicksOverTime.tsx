import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ApiError,
  getUrlAnalytics,
  type DailyClicks,
  type DeviceClicks,
  type UrlClicksOverTime,
} from './api.ts'

type ChartState =
  | { kind: 'loading' }
  | { kind: 'ready'; series: UrlClicksOverTime }
  | { kind: 'error'; message: string }

type ClicksOverTimeProps = {
  urlId: string
}

export function ClicksOverTime({ urlId }: ClicksOverTimeProps) {
  const [state, setState] = useState<ChartState>({ kind: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    setState({ kind: 'loading' })

    void getUrlAnalytics(urlId, { signal: controller.signal })
      .then((series) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'ready', series })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          kind: 'error',
          message:
            error instanceof ApiError || error instanceof Error
              ? error.message
              : 'Could not load clicks over time',
        })
      })

    return () => controller.abort()
  }, [urlId, reload])

  if (state.kind === 'loading') {
    return (
      <section className="clicks-over-time" aria-live="polite">
        <p className="clicks-over-time-kicker">Last 7 days</p>
        <p className="status">Loading daily clicks…</p>
      </section>
    )
  }

  if (state.kind === 'error') {
    return (
      <section className="clicks-over-time" aria-live="polite">
        <p className="clicks-over-time-kicker">Last 7 days</p>
        <p className="status status-error">{state.message}</p>
        <button
          className="text-action"
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          Retry
        </button>
      </section>
    )
  }

  const total = state.series.data.reduce((sum, day) => sum + day.clicks, 0)
  const rangeLabel = formatRange(state.series.startDate, state.series.endDate)
  const chartData = state.series.data.map((day) => ({
    ...day,
    label: formatTick(day.date, state.series.startDate, state.series.endDate),
  }))

  return (
    <section
      className="clicks-over-time"
      aria-label={`Clicks over the last 7 days, ${rangeLabel}. ${total} ${total === 1 ? 'click' : 'clicks'} in total.`}
    >
      <div className="clicks-over-time-head">
        <p className="clicks-over-time-kicker">Last 7 days</p>
        <p className="clicks-over-time-range">{rangeLabel}</p>
      </div>
      <div className="clicks-over-time-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid
              vertical={false}
              stroke="rgba(210, 245, 252, 0.12)"
              strokeDasharray="3 6"
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#7d93a1', fontSize: 10, fontFamily: 'IBM Plex Mono, ui-monospace, monospace' }}
              interval={0}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={28}
              tick={{ fill: '#7d93a1', fontSize: 10, fontFamily: 'IBM Plex Mono, ui-monospace, monospace' }}
              domain={[0, (max: number) => Math.max(max, 1)]}
            />
            <Tooltip
              cursor={{ fill: 'rgba(62, 198, 216, 0.08)' }}
              content={<DayTooltip />}
            />
            <Bar dataKey="clicks" fill="#3ec6d8" maxBarSize={28} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {total === 0 ? (
        <p className="status">No clicks in this period.</p>
      ) : null}
      <DeviceBreakdown devices={state.series.devices} />
    </section>
  )
}

function DeviceBreakdown({ devices }: { devices: DeviceClicks[] }) {
  const total = devices.reduce((sum, item) => sum + item.clicks, 0)

  return (
    <div className="device-breakdown">
      <p className="clicks-over-time-kicker">Device</p>
      <ul className="device-breakdown-list">
        {devices.map((item) => {
          const share = total > 0 ? (item.clicks / total) * 100 : 0

          return (
            <li key={item.deviceType} className="device-breakdown-row">
              <span className="device-breakdown-label">
                {formatDeviceLabel(item.deviceType)}
              </span>
              <span className="device-breakdown-track" aria-hidden="true">
                <span
                  className="device-breakdown-bar"
                  style={{ width: `${share}%` }}
                />
              </span>
              <span className="device-breakdown-count">
                {item.clicks} {item.clicks === 1 ? 'click' : 'clicks'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatDeviceLabel(deviceType: string): string {
  if (deviceType === 'unknown') {
    return 'Unidentified'
  }

  if (
    deviceType === 'desktop' ||
    deviceType === 'mobile' ||
    deviceType === 'tablet'
  ) {
    return deviceType[0].toUpperCase() + deviceType.slice(1)
  }

  return deviceType
}

function DayTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DailyClicks & { label: string } }>
}) {
  if (!active || !payload?.[0]) {
    return null
  }

  const day = payload[0].payload

  return (
    <div className="clicks-over-time-tooltip">
      <span>{formatTooltipDate(day.date)}</span>
      <span>
        {day.clicks} {day.clicks === 1 ? 'click' : 'clicks'}
      </span>
    </div>
  )
}

function parseUtcDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatRange(startDate: string, endDate: string): string {
  const start = parseUtcDay(startDate)
  const end = parseUtcDay(endDate)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth()

  if (sameMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${monthName(end)} ${end.getUTCFullYear()}`
  }

  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(start)
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(end)

  return `${startLabel} – ${endLabel}`
}

function formatTick(isoDay: string, startDate: string, endDate: string): string {
  const day = parseUtcDay(isoDay)
  const crossesMonth = startDate.slice(0, 7) !== endDate.slice(0, 7)

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: crossesMonth ? 'short' : undefined,
    timeZone: 'UTC',
  }).format(day)
}

function formatTooltipDate(isoDay: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseUtcDay(isoDay))
}

function monthName(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

export default ClicksOverTime
