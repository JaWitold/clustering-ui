import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AuctionSegment, SegmentDailyMembershipTotals } from '../types/clustering'
import { api } from '../api/client'
import { addDays, errorMessage, segmentColor, yesterday } from '../utils/drift'
import { money } from '../utils/featureFormat'
import { rangeTotals, segmentTraces, stackedTraces, TREND_METRICS, type TrendMetric } from '../utils/membershipTrends'
import { PlotlyChart } from './PlotlyChart'

/** Daily stats are kept this many days (clustering.feature_retention_days). */
const RETENTION_DAYS = 30

const CHART_CONFIG = { displayModeBar: false }

interface MembershipTrendsProps {
  clusterId: number
  segments: AuctionSegment[]
}

export const MembershipTrends: React.FC<MembershipTrendsProps> = ({ clusterId, segments }) => {
  const [metric, setMetric] = useState<TrendMetric>('profit')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [daily, setDaily] = useState<SegmentDailyMembershipTotals[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const latest = yesterday()
  const oldest = addDays(latest, -(RETENTION_DAYS - 1))
  const waitingForStart = to !== '' && from === ''

  useEffect(() => {
    if (waitingForStart) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getMembershipDailyTotals(clusterId, { from: from || undefined, to: to || undefined })
      .then((data) => !cancelled && setDaily(data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [clusterId, from, to, waitingForStart, reload])

  const days = daily[0]?.days ?? []
  const shownFrom = days[0]?.day
  const shownTo = days[days.length - 1]?.day
  const { isMoney, metricLabel, totals, lines, stacked, bySegment } = useMemo(() => {
    const color = (segmentId: number) => segmentColor(segmentId, segments)
    const definition = TREND_METRICS.find((m) => m.key === metric)
    const isMoney = definition?.money ?? false
    const metricLabel = definition?.label ?? metric
    const totals = rangeTotals(daily, metric)
    const dayCount = daily[0]?.days.length ?? 0
    const yaxis = { title: { text: isMoney ? `${metricLabel} (€)` : metricLabel }, tickformat: isMoney ? ',.0f' : ',d' }
    const xaxis = { type: 'date', tickformat: '%d.%m', dtick: 86400000 * Math.max(1, Math.ceil(dayCount / 15)) }
    const legend = { orientation: 'h', y: -0.2 }

    return {
      isMoney,
      metricLabel,
      totals,
      lines: {
        data: segmentTraces(daily, metric, color),
        layout: { title: { text: `${metricLabel} per segment, day by day`, font: { size: 14 } }, xaxis, yaxis, legend, hovermode: 'x unified' },
      },
      stacked: {
        data: stackedTraces(daily, metric, color),
        layout: { title: { text: `${metricLabel}, all segments together`, font: { size: 14 } }, barmode: 'relative', xaxis, yaxis, legend, hovermode: 'x unified' },
      },
      bySegment: {
        data: [
          {
            type: 'bar',
            orientation: 'h',
            x: totals.map((t) => t.value),
            y: totals.map((t) => t.name),
            customdata: totals.map((t) => t.offers),
            marker: { color: totals.map((t) => color(t.segmentId)) },
            hovertemplate: `%{y}<br>${metricLabel}: %{x:,}<br>%{customdata} auctions<extra></extra>`,
          },
        ],
        layout: {
          title: { text: `${metricLabel} over the range, by segment`, font: { size: 14 } },
          xaxis: { tickformat: isMoney ? ',.0f' : ',d' },
          yaxis: { autorange: 'reversed', automargin: true },
          margin: { l: 160, r: 25, t: 50, b: 40 },
        },
      },
    }
  }, [daily, metric, segments])
  const grandTotal = totals.reduce((sum, t) => sum + t.value, 0)
  const format = (value: number) => (isMoney ? money(Math.round(value * 100)) : value.toLocaleString('en-US'))

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col xl:flex-row xl:items-end gap-4 justify-between">
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Daily price changes and sales of the auctions in each segment
            {shownFrom && shownTo && (
              <>
                {' '}
                · <span className="text-slate-200">{shownFrom}</span> → <span className="text-slate-200">{shownTo}</span>
                {from === '' && to === '' && ' (default range)'}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {TREND_METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-3 py-1.5 rounded-md border ${metric === m.key ? 'bg-purple-600/20 border-purple-500/50 text-purple-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-1 text-slate-400">
            From
            <input
              type="date"
              value={from}
              min={oldest}
              max={to || latest}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-slate-400">
            To
            <input
              type="date"
              value={to}
              min={from || oldest}
              max={latest}
              onChange={(e) => setTo(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
            />
          </label>
          {[7, 14, RETENTION_DAYS].map((n) => (
            <button
              key={n}
              onClick={() => {
                setFrom(addDays(latest, -(n - 1)))
                setTo(latest)
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white"
            >
              {n}d
            </button>
          ))}
          <button
            onClick={() => {
              setFrom('')
              setTo('')
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white"
          >
            Default
          </button>
          <button onClick={() => setReload((n) => n + 1)} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white" title="Reload">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {waitingForStart && <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 text-amber-200 text-sm">Pick a start day too.</div>}
      {error && <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-sm">{error}</div>}

      {!loading && !error && daily.length === 0 && (
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-sm text-slate-400">No memberships recorded for this grouping yet.</div>
      )}

      {daily.length > 0 && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
            <span>
              {metricLabel} over the range: <span className={`font-mono text-sm ${grandTotal < 0 ? 'text-rose-300' : 'text-slate-100'}`}>{format(grandTotal)}</span>
            </span>
            <span>
              {daily.length} segments · {daily.reduce((sum, s) => sum + s.offers, 0).toLocaleString('en-US')} auctions · {days.length} days
            </span>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <PlotlyChart data={lines.data} layout={lines.layout} config={CHART_CONFIG} className="w-full h-[380px]" />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <PlotlyChart data={stacked.data} layout={stacked.layout} config={CHART_CONFIG} className="w-full h-[380px]" />
            </div>
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <PlotlyChart data={bySegment.data} layout={bySegment.layout} config={CHART_CONFIG} className="w-full h-[380px]" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
