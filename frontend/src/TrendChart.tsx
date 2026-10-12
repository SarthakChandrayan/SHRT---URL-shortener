import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyPoint } from './api.ts'
import { formatCount, formatDay, SERIES } from './analytics-format.ts'

const AXIS_TICK = {
  fill: '#7d93a1',
  fontSize: 10,
  fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
}

/** Rounds up to a clean axis maximum: 1, 2, 2.5, 5 × 10ⁿ (e.g. 119 → 150). */
function niceMax(value: number): number {
  if (value <= 4) {
    return 4
  }
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * magnitude >= value) ?? 10
  return step * magnitude
}

/**
 * Clicks and unique visitors per day on one shared count axis: 2px lines,
 * ~10% area washes, hairline grid, crosshair tooltip.
 */
export function TrendChart({ series, height = 220 }: { series: DailyPoint[]; height?: number }) {
  const crossesMonth =
    series.length > 0 && series[0].date.slice(0, 7) !== series[series.length - 1].date.slice(0, 7)
  const data = series.map((point) => ({
    ...point,
    label: formatDay(point.date, { day: 'numeric', month: crossesMonth ? 'short' : undefined }),
  }))
  const peak = Math.max(0, ...series.map((point) => Math.max(point.clicks, point.visitors)))
  const yMax = niceMax(peak)
  const totals = series.reduce(
    (sum, point) => ({ clicks: sum.clicks + point.clicks, visitors: sum.visitors + point.visitors }),
    { clicks: 0, visitors: 0 },
  )

  return (
    <figure className="trend">
      <figcaption className="trend-legend">
        {(['clicks', 'visitors'] as const).map((key) => (
          <span key={key} className="trend-key">
            <span className="trend-swatch" style={{ background: SERIES[key].color }} aria-hidden="true" />
            {SERIES[key].label}
            <strong>{formatCount(totals[key])}</strong>
          </span>
        ))}
      </figcaption>
      <div className="trend-chart" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {(['clicks', 'visitors'] as const).map((key) => (
                <linearGradient key={key} id={`trend-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[key].color} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={SERIES[key].color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(210, 245, 252, 0.08)" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={40}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => formatCount(value)}
              domain={[0, yMax]}
              ticks={[0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax].filter(Number.isInteger)}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(210, 245, 252, 0.35)', strokeWidth: 1 }}
              content={<TrendTooltip />}
            />
            <Area
              type="monotone"
              dataKey="visitors"
              name={SERIES.visitors.label}
              stroke={SERIES.visitors.color}
              strokeWidth={2}
              fill="url(#trend-fill-visitors)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#070d12', fill: SERIES.visitors.color }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="clicks"
              name={SERIES.clicks.label}
              stroke={SERIES.clicks.color}
              strokeWidth={2}
              fill="url(#trend-fill-clicks)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#070d12', fill: SERIES.clicks.color }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="trend-table">
        <summary>View as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                Clicks
              </th>
              <th scope="col" className="num">
                Unique visitors
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.date}>
                <td>{formatDay(point.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td className="num">{point.clicks.toLocaleString()}</td>
                <td className="num">{point.visitors.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DailyPoint }>
}) {
  if (!active || !payload?.[0]) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-title">
        {formatDay(point.date, { weekday: 'short', month: 'short', day: 'numeric' })}
      </span>
      {(['clicks', 'visitors'] as const).map((key) => (
        <span key={key} className="chart-tooltip-row">
          <span className="trend-swatch" style={{ background: SERIES[key].color }} aria-hidden="true" />
          {SERIES[key].label}
          <strong>{point[key].toLocaleString()}</strong>
        </span>
      ))}
    </div>
  )
}

export default TrendChart
