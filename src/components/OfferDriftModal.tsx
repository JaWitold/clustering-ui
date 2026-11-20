import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, ExternalLink, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { AssignmentChange, AuctionDynamics, AuctionSegment } from '../types/clustering'
import { api } from '../api/client'
import { TRAITS } from '../utils/featureFormat'
import { CHANGE_TYPES, addDays, errorMessage, featureLabel, segmentColor, segmentName, signed, urgencyClass } from '../utils/drift'
import { PlotlyChart } from './PlotlyChart'

interface OfferDriftModalProps {
  offerId: string
  productName: string | null
  /** Last day of the trail (the day the forecast list shows). */
  day: string
  segments: AuctionSegment[]
  onClose: () => void
  onOpenOfferAssignments?: (offerId: string) => void
}

const TRAIL_DAYS = 30
const CHART_MARGIN = { l: 48, r: 16, t: 16, b: 36 }

/** One auction: where its switch margin is heading, which segments it approaches, which features move it, and what already happened. */
export const OfferDriftModal: React.FC<OfferDriftModalProps> = ({ offerId, productName, day, segments, onClose, onOpenOfferAssignments }) => {
  const [trail, setTrail] = useState<AuctionDynamics[]>([])
  const [changes, setChanges] = useState<AssignmentChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.offerAuctionDynamics(offerId, { from: addDays(day, -(TRAIL_DAYS - 1)), to: day }),
      api.listAssignmentChanges({ offerId, 'per-page': 100 }),
    ])
      .then(([dynamics, history]) => {
        if (cancelled) return
        setTrail(dynamics)
        setChanges(history.changes)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [offerId, day])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const latest = trail.length > 0 ? trail[trail.length - 1] : null
  const previous = trail.length > 1 ? trail[trail.length - 2] : null
  const acceleration =
    latest?.switchMarginVelocity != null && previous?.switchMarginVelocity != null ? latest.switchMarginVelocity - previous.switchMarginVelocity : null

  const marginChart = useMemo(() => {
    const days = trail.map((row) => row.day)
    const eventDays = changes.filter((c) => c.type !== 'New' && days.includes(c.day))
    return {
      data: [
        {
          x: days,
          y: trail.map((row) => row.switchMargin),
          type: 'scatter',
          mode: 'lines+markers',
          name: 'Switch margin',
          line: { color: '#a78bfa', width: 2.5, shape: 'spline' },
          marker: { size: 4 },
          fill: 'tozeroy',
          fillcolor: 'rgba(167,139,250,0.08)',
          hovertemplate: '%{x}<br>margin %{y:.3f}<extra></extra>',
        },
        {
          x: eventDays.map((c) => c.day),
          y: eventDays.map((c) => trail.find((row) => row.day === c.day)?.switchMargin ?? 0),
          text: eventDays.map((c) => `${c.type}: ${c.fromSegment?.name ?? '—'} → ${c.toSegment.name ?? `#${c.toSegment.id}`}`),
          type: 'scatter',
          mode: 'markers',
          name: 'Events',
          marker: { size: 11, symbol: 'diamond', color: '#fbbf24', line: { color: '#0b1120', width: 1.5 } },
          hovertemplate: '%{x}<br>%{text}<extra></extra>',
        },
      ],
      layout: {
        margin: CHART_MARGIN,
        showlegend: false,
        yaxis: { title: { text: 'margin', font: { size: 11 } }, zerolinecolor: '#f43f5e', zerolinewidth: 2 },
        xaxis: { type: 'date', tickformat: '%b %d' },
      },
    }
  }, [trail, changes])

  const distanceChart = useMemo(() => {
    if (!latest) return { data: [], layout: {} }
    const nearest = [...latest.distances].sort((a, b) => a.distance - b.distance).slice(0, 4).map((d) => d.segmentId)
    return {
      data: nearest.map((segmentId) => ({
        x: trail.map((row) => row.day),
        y: trail.map((row) => row.distances.find((d) => d.segmentId === segmentId)?.distance ?? null),
        type: 'scatter',
        mode: 'lines',
        name: `${segmentName(segmentId, segments)}${segmentId === latest.segment ? ' (held)' : ''}`,
        line: { color: segmentColor(segmentId, segments), width: segmentId === latest.segment ? 3.5 : 1.8, dash: segmentId === latest.segment ? 'solid' : 'dot' },
        hovertemplate: '%{x}<br>distance %{y:.3f}<extra>%{fullData.name}</extra>',
      })),
      layout: {
        margin: CHART_MARGIN,
        legend: { orientation: 'h', y: -0.25, font: { size: 10 } },
        yaxis: { title: { text: 'distance to centroid', font: { size: 11 } } },
        xaxis: { type: 'date', tickformat: '%b %d' },
      },
    }
  }, [trail, latest, segments])

  const movers = useMemo(() => {
    const top = [...(latest?.velocity ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8)
    const max = Math.max(...top.map((v) => Math.abs(v.value)), 1e-9)
    return top.map((v) => ({ ...v, share: (Math.abs(v.value) / max) * 100 }))
  }, [latest])

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Auction drift details"
        className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-800">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-100 truncate">{productName ?? 'Auction'}</h3>
            <div className="text-[11px] font-mono text-slate-500 truncate">{offerId}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenOfferAssignments && (
              <button
                onClick={() => onOpenOfferAssignments(offerId)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Assignment</span>
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start gap-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading the last {TRAIL_DAYS} days…</span>
            </div>
          )}

          {!loading && !error && !latest && (
            <div className="py-12 text-center text-sm text-slate-500">No dynamics recorded for this auction in the last {TRAIL_DAYS} days.</div>
          )}

          {!loading && latest && (
            <>
              <div
                className={`rounded-xl border p-4 ${
                  latest.daysToSwitch !== null ? 'bg-rose-950/20 border-rose-900/70' : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="px-2 py-0.5 rounded font-semibold text-slate-900" style={{ backgroundColor: segmentColor(latest.segment, segments) }}>
                    {segmentName(latest.segment, segments)}
                  </span>
                  {latest.daysToSwitch !== null && latest.predictedSegment !== null ? (
                    <>
                      <ArrowRight className="w-4 h-4 text-slate-500" />
                      <span className="px-2 py-0.5 rounded font-semibold text-slate-900" style={{ backgroundColor: segmentColor(latest.predictedSegment, segments) }}>
                        {segmentName(latest.predictedSegment, segments)}
                      </span>
                      <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${urgencyClass(latest.daysToSwitch)}`}>
                        in ~{latest.daysToSwitch} {latest.daysToSwitch === 1 ? 'day' : 'days'}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400 text-xs">No switch forecast inside the horizon.</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {latest.switchMargin !== null && latest.switchMargin < 0
                    ? 'Another segment is already nearer than the held one; the switch waits for the hysteresis streak.'
                    : latest.daysToSwitch !== null
                      ? 'Extrapolating the last day of movement, another segment becomes the nearest within the horizon.'
                      : 'At its current pace the auction stays nearest to its segment.'}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Stat label="Switch margin" value={latest.switchMargin !== null ? latest.switchMargin.toFixed(3) : '—'} hint="distance to the runner-up minus distance to the held segment" />
                  <Stat
                    label="Margin per day"
                    value={latest.switchMarginVelocity !== null ? signed(latest.switchMarginVelocity) : '—'}
                    tone={latest.switchMarginVelocity !== null && latest.switchMarginVelocity < 0 ? 'bad' : 'good'}
                    hint="negative = closing in on another segment"
                  />
                  <Stat
                    label="Acceleration"
                    value={acceleration !== null ? signed(acceleration) : '—'}
                    tone={acceleration !== null && acceleration < 0 ? 'bad' : 'good'}
                    hint="change of the daily margin move since the day before"
                  />
                  <Stat label="Runner-up" value={segmentName(latest.runnerUpSegment, segments)} hint="nearest other segment today" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Panel title="Switch margin" hint="Below the red line another segment is nearer. Diamonds mark recorded events.">
                  <PlotlyChart data={marginChart.data} layout={marginChart.layout} className="w-full h-64" />
                </Panel>
                <Panel title="Distance to the nearest segments" hint="The held segment is the solid line; a dotted line crossing under it is a switch in the making.">
                  <PlotlyChart data={distanceChart.data} layout={distanceChart.layout} className="w-full h-64" />
                </Panel>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Panel title="What moved it" hint={`Largest feature moves on ${latest.day}, in scaled units (median/IQR, weighted).`}>
                  {movers.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">No vector the day before, so no velocity.</div>
                  ) : (
                    <ul className="space-y-2">
                      {movers.map((mover) => (
                        <li key={mover.feature} className="text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-300 truncate" title={TRAITS[mover.feature]?.hint}>
                              {featureLabel(mover.feature)}
                            </span>
                            <span className={`font-mono flex items-center gap-1 ${mover.value < 0 ? 'text-sky-300' : 'text-violet-300'}`}>
                              {mover.value < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                              {signed(mover.value)}
                            </span>
                          </div>
                          <div className="h-1.5 mt-1 rounded-full bg-slate-800 overflow-hidden">
                            <div className={`h-full rounded-full ${mover.value < 0 ? 'bg-sky-500/70' : 'bg-violet-500/70'}`} style={{ width: `${mover.share}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="History" hint="Every recorded event of this auction, newest first.">
                  {changes.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">No recorded events yet.</div>
                  ) : (
                    <ol className="space-y-2 max-h-72 overflow-y-auto pr-1 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
                      {changes.map((change) => (
                        <li key={change.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-slate-500 w-20 shrink-0">{change.day}</span>
                          <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium w-20 text-center shrink-0 ${CHANGE_TYPES[change.type].className}`} title={CHANGE_TYPES[change.type].hint}>
                            {CHANGE_TYPES[change.type].label}
                          </span>
                          <span className="text-slate-400 truncate">
                            {change.fromSegment ? segmentName(change.fromSegment.id, segments) : 'start'}
                            <ArrowRight className="w-3 h-3 inline mx-1 text-slate-600" />
                            <span className="text-slate-200">{segmentName(change.toSegment.id, segments)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const Stat: React.FC<{ label: string; value: string; hint: string; tone?: 'good' | 'bad' }> = ({ label, value, hint, tone }) => (
  <div title={hint}>
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-sm font-semibold font-mono truncate ${tone === 'bad' ? 'text-rose-300' : tone === 'good' ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div>
  </div>
)

const Panel: React.FC<{ title: string; hint: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="bg-slate-950/50 border border-slate-800 rounded-xl p-4">
    <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
    <p className="text-[11px] text-slate-500 mb-3">{hint}</p>
    {children}
  </section>
)
