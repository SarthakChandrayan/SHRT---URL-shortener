import { useState } from 'react'
import { getOverview, viewerTimezone } from './api.ts'
import { useAuth } from './AuthContext.tsx'
import { formatRange, lastDays, SERIES, type RangeDays } from './analytics-format.ts'
import {
  BreakdownPanel,
  Heatmap,
  Kpi,
  RangePicker,
  TopLinksTable,
} from './AnalyticsWidgets.tsx'
import { PlusIcon, RefreshIcon } from './icons.tsx'
import { TrendChart } from './TrendChart.tsx'
import { useReport } from './useReport.ts'

type AnalyticsPageProps = {
  onSignIn: () => void
  onCreate: () => void
}

export function AnalyticsPage({ onSignIn, onCreate }: AnalyticsPageProps) {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="dash analytics">
        <div className="skeleton skeleton-chart" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    return (
      <div className="dash analytics">
        <div className="dash-head dash-head-guest">
          <div>
            <h1 className="dash-title">Analytics</h1>
            <p className="dash-lede">
              Sign in to see clicks, unique visitors, traffic sources and the best times to
              share, across all your links.
            </p>
          </div>
          <button className="button button-primary button-compact" type="button" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return <Overview onCreate={onCreate} />
}

function Overview({ onCreate }: { onCreate: () => void }) {
  const [days, setDays] = useState<RangeDays>(30)
  const range = lastDays(days)
  const report = useReport(`${range.startDate}:${range.endDate}`, (signal) =>
    getOverview(range, { signal }),
  )
  const data = report.data
  const total = data?.totals.clicks ?? 0
  const perVisitor =
    data && data.totals.visitors > 0 ? (data.totals.clicks / data.totals.visitors).toFixed(1) : '—'

  return (
    <div className={`dash analytics${report.loading && data ? ' is-refreshing' : ''}`}>
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Analytics</h1>
          <p className="dash-lede">
            All your links · {formatRange(range)} · times in {viewerTimezone().replaceAll('_', ' ')}
          </p>
        </div>
        <div className="dash-actions analytics-actions">
          <RangePicker value={days} onChange={setDays} />
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh"
            title="Refresh"
            disabled={report.loading}
            onClick={report.retry}
          >
            <RefreshIcon size={16} className={report.loading && data ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {report.error && !data ? (
        <section className="dash-panel dash-message">
          <p className="status status-error">{report.error}</p>
          <button className="button button-ghost button-compact" type="button" onClick={report.retry}>
            Try again
          </button>
        </section>
      ) : !data ? (
        <AnalyticsSkeleton />
      ) : data.links.total === 0 ? (
        <section className="dash-panel dash-empty">
          <p className="dash-empty-title">No links yet</p>
          <p className="dash-lede">Create a link and its analytics will appear here.</p>
          <button className="button button-primary button-compact" type="button" onClick={onCreate}>
            <PlusIcon size={14} />
            Create a link
          </button>
        </section>
      ) : (
        <>
          <div className="kpis">
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
            <Kpi label="Clicks per visitor" value={perVisitor} hint="Average in this period" />
            <Kpi
              label="New links"
              value={data.links.createdInRange}
              hint={`${data.links.total.toLocaleString()} links in total`}
            />
          </div>

          <section className="card">
            <h2 className="card-title">Clicks over time</h2>
            <TrendChart series={data.series} height={260} />
          </section>

          <div className="card-grid card-grid-2">
            <section className="card">
              <h2 className="card-title">Top links</h2>
              <TopLinksTable links={data.topLinks} totalClicks={total} />
            </section>
            <section className="card card-flush">
              <BreakdownPanel
                title="Traffic sources"
                items={data.breakdowns.sources}
                total={total}
                emptyText="No clicks in this period"
              />
            </section>
          </div>

          <div className="card-grid card-grid-4">
            <BreakdownPanel title="Countries" items={data.breakdowns.countries} total={total} />
            <BreakdownPanel title="Devices" items={data.breakdowns.devices} total={total} />
            <BreakdownPanel title="Browsers" items={data.breakdowns.browsers} total={total} />
            <BreakdownPanel
              title="Operating systems"
              items={data.breakdowns.operatingSystems}
              total={total}
            />
          </div>

          <section className="card">
            <h2 className="card-title">When people click</h2>
            <Heatmap cells={data.heatmap} />
          </section>

          <p className="analytics-note">
            Bots, link-preview fetchers (WhatsApp, Slack, X…) and repeated rapid clicks aren’t
            counted. Unique visitors are counted per day without storing IP addresses.
          </p>
        </>
      )}
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="dash-skeleton" aria-busy="true" aria-label="Loading analytics">
      <div className="kpis">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="kpi">
            <span className="skeleton skeleton-line skeleton-short" />
            <span className="skeleton skeleton-line skeleton-value" />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
    </div>
  )
}

export default AnalyticsPage
