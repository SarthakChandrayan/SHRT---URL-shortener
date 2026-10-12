import { useState } from 'react'
import { getUrlAnalytics } from './api.ts'
import { formatRange, lastDays, SERIES, type RangeDays } from './analytics-format.ts'
import { BreakdownPanel, Heatmap, Kpi, RangePicker } from './AnalyticsWidgets.tsx'
import { TrendChart } from './TrendChart.tsx'
import { useReport } from './useReport.ts'

/** Per-link analytics inside an expanded dashboard row. */
export function LinkAnalytics({ urlId }: { urlId: string }) {
  const [days, setDays] = useState<RangeDays>(7)
  const range = lastDays(days)
  const report = useReport(`${urlId}:${range.startDate}:${range.endDate}`, (signal) =>
    getUrlAnalytics(urlId, range, { signal }),
  )

  const data = report.data
  const total = data?.totals.clicks ?? 0

  return (
    <section className={`link-analytics-panel${report.loading && data ? ' is-refreshing' : ''}`} aria-busy={report.loading}>
      <div className="panel-head">
        <p className="panel-title">
          Analytics <span className="panel-sub">{formatRange(range)}</span>
        </p>
        <RangePicker value={days} onChange={setDays} small />
      </div>

      {report.error ? (
        <div className="dash-message">
          <p className="status status-error">{report.error}</p>
          <button className="text-action" type="button" onClick={report.retry}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="skeleton skeleton-chart" />
      ) : (
        <>
          <div className="kpis kpis-compact">
            <Kpi
              label={SERIES.clicks.label}
              swatch={SERIES.clicks.color}
              value={data.totals.clicks}
              previous={data.previous.clicks}
              days={days}
            />
            <Kpi
              label={SERIES.visitors.label}
              swatch={SERIES.visitors.color}
              value={data.totals.visitors}
              previous={data.previous.visitors}
              days={days}
            />
          </div>

          <TrendChart series={data.series} height={180} />

          {total === 0 ? (
            <p className="status">
              No human clicks in this period. Bots and link previews aren’t counted.
            </p>
          ) : (
            <>
              <div className="breakdowns">
                <BreakdownPanel title="Traffic sources" items={data.breakdowns.sources} total={total} />
                <BreakdownPanel title="Countries" items={data.breakdowns.countries} total={total} />
                <BreakdownPanel title="Devices" items={data.breakdowns.devices} total={total} />
                <BreakdownPanel title="Browsers" items={data.breakdowns.browsers} total={total} />
                <BreakdownPanel
                  title="Operating systems"
                  items={data.breakdowns.operatingSystems}
                  total={total}
                />
              </div>
              <details className="panel-details">
                <summary>When people click</summary>
                <Heatmap cells={data.heatmap} />
              </details>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default LinkAnalytics
