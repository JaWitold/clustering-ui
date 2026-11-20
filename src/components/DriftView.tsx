import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  History,
  Radar,
  RefreshCw,
  Repeat,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import type { AssignmentChange, AssignmentChangeType, AssignmentDrift, AuctionDynamics, AuctionSegment, SegmentTransition } from '../types/clustering'
import { api } from '../api/client'
import { CHANGE_TYPES, addDays, errorMessage, segmentColor, segmentName, signed, urgencyClass, yesterday } from '../utils/drift'
import { OfferDriftModal } from './OfferDriftModal'
import { PlotlyChart } from './PlotlyChart'

type Panel = 'forecast' | 'drift' | 'flows' | 'history'

interface DriftViewProps {
  onOpenOfferAssignments?: (offerId: string) => void
}

interface Selected {
  offerId: string
  productName: string | null
}

const PER_PAGE = 20
const INPUT = 'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500'

const PANELS: { id: Panel; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'forecast', label: 'Forecast', icon: <Radar className="w-4 h-4" />, hint: 'Who switches next, and where to' },
  { id: 'drift', label: 'Drift', icon: <Repeat className="w-4 h-4" />, hint: 'Who moved and who keeps coming back' },
  { id: 'flows', label: 'Flows', icon: <GitCompareArrows className="w-4 h-4" />, hint: 'Between which segments auctions move' },
  { id: 'history', label: 'History', icon: <History className="w-4 h-4" />, hint: 'Every recorded event' },
]

/** Segment history, drift, cycles and the switch forecast of our auctions. */
export const DriftView: React.FC<DriftViewProps> = ({ onOpenOfferAssignments }) => {
  const [panel, setPanel] = useState<Panel>('forecast')
  const [segments, setSegments] = useState<AuctionSegment[]>([])
  const [day, setDay] = useState(yesterday)
  const [to, setTo] = useState(yesterday)
  const [from, setFrom] = useState(() => addDays(yesterday(), -29))
  const [selected, setSelected] = useState<Selected | null>(null)
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    api.listAllSegments().then(setSegments).catch(console.error)
  }, [])

  const setPreset = (days: number) => {
    setTo(yesterday())
    setFrom(addDays(yesterday(), -(days - 1)))
  }
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col 2xl:flex-row 2xl:items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-purple-400" />
              <span>Segment Drift & Forecast</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              How our auctions move between segments: which will switch next, which keep cycling between two segments, and between which segments the moves happen.
              Click any auction to see where it is heading and why.
            </p>
          </div>

          {panel === 'forecast' ? (
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-wider text-slate-500" htmlFor="drift-day">
                Day
              </label>
              <input id="drift-day" type="date" value={day} max={yesterday()} onChange={(e) => e.target.value && setDay(e.target.value)} className={INPUT} />
              <button onClick={() => setDay(yesterday())} className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-slate-800 hover:bg-slate-700">
                Yesterday
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  onClick={() => setPreset(days)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border ${
                    span === days && to === yesterday() ? 'bg-purple-600/20 text-purple-200 border-purple-500/40' : 'text-slate-300 bg-slate-800 border-transparent hover:bg-slate-700'
                  }`}
                >
                  {days} days
                </button>
              ))}
              <input type="date" aria-label="First day" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={INPUT} />
              <span className="text-slate-600 text-xs">to</span>
              <input type="date" aria-label="Last day" value={to} min={from} max={yesterday()} onChange={(e) => e.target.value && setTo(e.target.value)} className={INPUT} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-5">
          {PANELS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPanel(item.id)}
              className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                panel === item.id ? 'bg-purple-600/15 border-purple-500/40' : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className={`flex items-center gap-2 text-sm font-semibold ${panel === item.id ? 'text-purple-200' : 'text-slate-200'}`}>
                {item.icon}
                <span>{item.label}</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{item.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {panel === 'forecast' && <ForecastPanel day={day} segments={segments} onSelect={setSelected} />}
      {panel === 'drift' && <DriftPanel key={`${from}|${to}`} from={from} to={to} segments={segments} onSelect={setSelected} />}
      {panel === 'flows' && (
        <FlowsPanel
          from={from}
          to={to}
          segments={segments}
          onPickPair={(fromSegment, toSegment) => {
            setPair({ from: fromSegment, to: toSegment })
            setPanel('history')
          }}
        />
      )}
      {panel === 'history' && <HistoryPanel key={`${from}|${to}|${pair?.from}|${pair?.to}`} from={from} to={to} segments={segments} pair={pair} onClearPair={() => setPair(null)} onSelect={setSelected} />}

      {selected && (
        <OfferDriftModal
          offerId={selected.offerId}
          productName={selected.productName}
          day={panel === 'forecast' ? day : to}
          segments={segments}
          onClose={() => setSelected(null)}
          onOpenOfferAssignments={onOpenOfferAssignments}
        />
      )}
    </div>
  )
}

// ---------------- Forecast ----------------

const FORECAST_SORTS = [
  { value: 'daysToSwitch', label: 'Soonest switch' },
  { value: 'switchMargin', label: 'Smallest margin' },
  { value: 'switchMarginVelocity', label: 'Margin shrinking fastest' },
  { value: '-speed', label: 'Moving fastest' },
  { value: 'productName', label: 'Product name A–Z' },
]

const ForecastPanel: React.FC<{ day: string; segments: AuctionSegment[]; onSelect: (s: Selected) => void }> = ({ day, segments, onSelect }) => {
  const [rows, setRows] = useState<AuctionDynamics[]>([])
  const [soon, setSoon] = useState<AuctionDynamics[]>([])
  const [totalCount, setTotalCount] = useState<number>()
  const [totalPages, setTotalPages] = useState<number>()
  const [sort, setSort] = useState('daysToSwitch')
  const [segment, setSegment] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listAuctionDynamics({ day, sort, search: query || undefined, segment: segment ? Number(segment) : undefined, page, 'per-page': PER_PAGE })
      .then((res) => {
        if (cancelled) return
        setRows(res.dynamics)
        setTotalCount(res.totalCount)
        setTotalPages(res.totalPages)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [day, sort, segment, query, page, reload])

  useEffect(() => {
    let cancelled = false
    api
      .listAuctionDynamics({ day, sort: 'daysToSwitch', 'per-page': 100 })
      .then((res) => !cancelled && setSoon(res.dynamics.filter((row) => row.daysToSwitch !== null)))
      .catch(() => !cancelled && setSoon([]))

    return () => {
      cancelled = true
    }
  }, [day, reload])

  const capped = soon.length === 100
  const bucket = (min: number, max: number) => soon.filter((row) => row.daysToSwitch! >= min && row.daysToSwitch! <= max).length
  const maxMargin = Math.max(...rows.map((row) => Math.abs(row.switchMargin ?? 0)), 1e-9)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Switching tomorrow" value={bucket(1, 1)} capped={capped} tone="rose" hint="forecast or already nearer another segment" />
        <Tile label="In 2–3 days" value={bucket(2, 3)} capped={capped} tone="amber" hint="at the pace of the last day" />
        <Tile label="In 4–7 days" value={bucket(4, 99)} capped={capped} tone="sky" hint="inside the forecast horizon" />
        <Tile label="Auctions on the day" value={totalCount ?? 0} tone="slate" hint={segment || query ? 'matching the filters' : `with a vector on ${day}`} />
      </div>

      <Toolbar
        search={search}
        placeholder="Product name, offer or product ID…"
        onSearch={setSearch}
        onSubmit={() => {
          setPage(0)
          setQuery(search.trim())
        }}
        loading={loading}
        onRefresh={() => setReload((n) => n + 1)}
      >
        <SegmentSelect value={segment} segments={segments} label="All segments" onChange={(value) => (setSegment(value), setPage(0))} />
        <select value={sort} onChange={(e) => (setSort(e.target.value), setPage(0))} aria-label="Sort forecast" className={INPUT}>
          {FORECAST_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Toolbar>

      {error && <ErrorBox message={error} />}

      <TableCard page={page} totalPages={totalPages} loading={loading} onPage={setPage}>
        <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Auction</th>
            <th className="px-4 py-3">Now</th>
            <th className="px-4 py-3">Forecast</th>
            <th className="px-4 py-3">Switch margin</th>
            <th className="px-4 py-3 whitespace-nowrap">Margin / day</th>
            <th className="px-4 py-3">Speed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
          {rows.map((row) => (
            <tr key={row.offerId} onClick={() => onSelect(row)} className="hover:bg-slate-800/50 transition-colors cursor-pointer">
              <AuctionCell productName={row.productName} offerId={row.offerId} />
              <td className="px-4 py-3">
                <SegmentChip id={row.segment} segments={segments} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {row.daysToSwitch !== null && row.predictedSegment !== null ? (
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
                    <SegmentChip id={row.predictedSegment} segments={segments} />
                    <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${urgencyClass(row.daysToSwitch)}`}>
                      {row.daysToSwitch === 1 ? 'tomorrow' : `${row.daysToSwitch} days`}
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-600">stays</span>
                )}
              </td>
              <td className="px-4 py-3">
                {row.switchMargin === null ? (
                  <span className="text-slate-600">—</span>
                ) : (
                  <div className="w-36" title={row.switchMargin < 0 ? 'Another segment is already nearer' : `Runner-up: ${segmentName(row.runnerUpSegment, segments)}`}>
                    <div className={`font-mono font-semibold ${row.switchMargin < 0 ? 'text-rose-300' : 'text-slate-200'}`}>{row.switchMargin.toFixed(3)}</div>
                    <div className="h-1.5 mt-1 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.switchMargin < 0 ? 'bg-rose-500/80' : 'bg-purple-500/70'}`}
                        style={{ width: `${(Math.abs(row.switchMargin) / maxMargin) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap font-mono">
                {row.switchMarginVelocity === null ? (
                  <span className="text-slate-600">—</span>
                ) : (
                  <span className={`inline-flex items-center gap-1 ${row.switchMarginVelocity < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                    {row.switchMarginVelocity < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                    {signed(row.switchMarginVelocity)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-slate-400">{row.speed !== null ? row.speed.toFixed(3) : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && loading && <EmptyRow columns={6}>Loading…</EmptyRow>}
          {rows.length === 0 && !loading && (
            <EmptyRow columns={6}>
              No dynamics for {day}. They are recorded after the daily assignment; backfill a day with <code className="text-slate-400">record-auction-dynamics --day={day}</code>.
            </EmptyRow>
          )}
        </tbody>
      </TableCard>
    </div>
  )
}

// ---------------- Drift ----------------

type Path = { spans: { segment: number; left: number; width: number; from: string; to: string }[]; ticks: { left: number; type: AssignmentChangeType; day: string }[] }

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000

/** The segments an auction held over the period, as shares of the period's width, plus its proposals and cancellations. */
const pathOf = (events: AssignmentChange[], current: number, from: string, to: string): Path => {
  const total = dayNumber(to) - dayNumber(from) + 1
  const share = (day: string): number => ((dayNumber(day) - dayNumber(from)) / total) * 100
  const moves = events.filter((e) => (e.type === 'Switched' || e.type === 'Promoted') && e.fromSegment !== null && e.fromSegment.id !== e.toSegment.id)
  const spans: Path['spans'] = []
  let segment = moves[0]?.fromSegment?.id ?? current
  let start = from

  for (const move of moves) {
    spans.push({ segment, left: share(start), width: share(move.day) - share(start), from: start, to: addDays(move.day, -1) })
    segment = move.toSegment.id
    start = move.day
  }
  spans.push({ segment, left: share(start), width: 100 - share(start), from: start, to })

  return {
    spans: spans.filter((span) => span.width > 0),
    ticks: events.filter((e) => e.type === 'Proposed' || e.type === 'Restarted' || e.type === 'Cancelled').map((e) => ({ left: share(e.day), type: e.type, day: e.day })),
  }
}

const DriftPanel: React.FC<{ from: string; to: string; segments: AuctionSegment[]; onSelect: (s: Selected) => void }> = ({ from, to, segments, onSelect }) => {
  const [rows, setRows] = useState<AssignmentDrift[]>([])
  const [events, setEvents] = useState<Record<string, AssignmentChange[]>>({})
  const [transitions, setTransitions] = useState<SegmentTransition[]>([])
  const [totalCount, setTotalCount] = useState<number>()
  const [totalPages, setTotalPages] = useState<number>()
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listAssignmentDrifts({ from, to, page, 'per-page': PER_PAGE })
      .then(async (res) => {
        const byOffer: Record<string, AssignmentChange[]> = {}
        for (let historyPage = 0; res.drifts.length > 0 && historyPage < 5; historyPage++) {
          const history = await api.listAssignmentChanges({ offerIds: res.drifts.map((row) => row.offerId), dayFrom: from, dayTo: to, sort: 'day', page: historyPage, 'per-page': 100 })
          for (const change of history.changes) (byOffer[change.offerId] ??= []).push(change)
          if (history.totalPages === undefined || historyPage + 1 >= history.totalPages) break
        }
        if (cancelled) return
        setRows(res.drifts)
        setEvents(byOffer)
        setTotalCount(res.totalCount)
        setTotalPages(res.totalPages)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [from, to, page])

  useEffect(() => {
    let cancelled = false
    api
      .listSegmentTransitions({ from, to })
      .then((res) => !cancelled && setTransitions(res))
      .catch(() => !cancelled && setTransitions([]))

    return () => {
      cancelled = true
    }
  }, [from, to])

  const traffic = useMemo(() => {
    const pairs = new Map<string, { a: number; b: number; there: number; back: number }>()
    for (const row of transitions) {
      const [a, b] = row.fromSegmentId < row.toSegmentId ? [row.fromSegmentId, row.toSegmentId] : [row.toSegmentId, row.fromSegmentId]
      const pair = pairs.get(`${a}-${b}`) ?? { a, b, there: 0, back: 0 }
      if (row.fromSegmentId === a) pair.there += row.moves
      else pair.back += row.moves
      pairs.set(`${a}-${b}`, pair)
    }
    const twoWay = [...pairs.values()]
      .filter((pair) => pair.there > 0 && pair.back > 0)
      .sort((x, y) => Math.min(y.there, y.back) - Math.min(x.there, x.back))
      .slice(0, 8)
      .reverse()
    const labels = twoWay.map((pair) => `${segmentName(pair.a, segments)} ⇄ ${segmentName(pair.b, segments)}`)
    return {
      count: twoWay.length,
      data: [
        { type: 'bar', orientation: 'h', y: labels, x: twoWay.map((pair) => -pair.back), customdata: twoWay.map((pair) => pair.back), name: 'back', marker: { color: '#38bdf8' }, hovertemplate: '%{customdata} moves back<extra></extra>' },
        { type: 'bar', orientation: 'h', y: labels, x: twoWay.map((pair) => pair.there), name: 'there', marker: { color: '#a78bfa' }, hovertemplate: '%{x} moves there<extra></extra>' },
      ],
      layout: {
        barmode: 'relative',
        bargap: 0.35,
        showlegend: false,
        margin: { l: 210, r: 16, t: 8, b: 32 },
        xaxis: { tickformat: ',d', zerolinecolor: '#64748b', title: { text: '← moves back · moves there →', font: { size: 10 } } },
        yaxis: { automargin: true, tickfont: { size: 11 } },
      },
    }
  }, [transitions, segments])

  const maxMoves = Math.max(...rows.map((row) => row.moves), 1)
  const legend = [...new Set(rows.flatMap((row) => pathOf(events[row.offerId] ?? [], row.segmentId, from, to).spans.map((span) => span.segment)))]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-semibold text-slate-200">How to read this</h3>
          <p className="text-xs text-slate-400 mt-2">
            <span className="font-semibold text-slate-200">{totalCount ?? '…'}</span> auctions changed between {from} and {to}.
          </p>
          <ul className="text-xs text-slate-400 mt-3 space-y-2">
            <li>
              <span className="text-slate-200">Path</span> shows the segment each auction held, day by day. A repeating colour pattern is a{' '}
              <span className="text-purple-300">cycle</span>: the auction moved back into a segment it had left.
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-0.5 h-3 bg-amber-400" /> proposed candidate
              <span className="inline-block w-0.5 h-3 bg-slate-400 ml-2" /> cancelled
            </li>
            <li>Cycling auctions come first, then the ones that moved most. Click a row for the full picture.</li>
          </ul>
        </div>

        <div className="xl:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-semibold text-slate-200">Where the cycling happens</h3>
          <p className="text-[11px] text-slate-500 mb-1">Segment pairs with moves in both directions; the more balanced the two bars, the more auctions bounce between the pair.</p>
          {traffic.count > 0 ? (
            <PlotlyChart data={traffic.data} layout={traffic.layout} className="w-full h-56" />
          ) : (
            <div className="h-56 flex items-center justify-center text-xs text-slate-500">No pair of segments has moves in both directions in this period.</div>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          {legend.map((id) => (
            <SegmentChip key={id} id={id} segments={segments} />
          ))}
        </div>
      )}

      <TableCard page={page} totalPages={totalPages} loading={loading} onPage={setPage}>
        <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Auction</th>
            <th className="px-4 py-3 w-[34%]">
              <div className="flex justify-between font-mono normal-case tracking-normal text-[10px] text-slate-500">
                <span>{from}</span>
                <span className="uppercase tracking-wider text-xs font-semibold text-slate-400">Path</span>
                <span>{to}</span>
              </div>
            </th>
            <th className="px-4 py-3">Cycles</th>
            <th className="px-4 py-3">Moves</th>
            <th className="px-4 py-3 whitespace-nowrap">Proposed / cancelled</th>
            <th className="px-4 py-3 whitespace-nowrap">Last change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
          {rows.map((row) => {
            const path = pathOf(events[row.offerId] ?? [], row.segmentId, from, to)
            return (
              <tr key={row.offerId} onClick={() => onSelect(row)} className="hover:bg-slate-800/50 transition-colors cursor-pointer">
                <AuctionCell productName={row.productName} offerId={row.offerId} />
                <td className="px-4 py-3">
                  <div className="relative h-5 rounded bg-slate-800 overflow-hidden" role="img" aria-label={`Segment path: ${path.spans.map((span) => segmentName(span.segment, segments)).join(' then ')}`}>
                    {path.spans.map((span, index) => (
                      <div
                        key={index}
                        className="absolute inset-y-0 border-r border-slate-950/70"
                        style={{ left: `${span.left}%`, width: `${span.width}%`, backgroundColor: segmentColor(span.segment, segments) }}
                        title={`${segmentName(span.segment, segments)} · ${span.from} to ${span.to}`}
                      />
                    ))}
                    {path.ticks.map((tick, index) => (
                      <div
                        key={`tick-${index}`}
                        className={`absolute -inset-y-0.5 w-0.5 ${tick.type === 'Cancelled' ? 'bg-slate-300' : 'bg-amber-300'} mix-blend-normal`}
                        style={{ left: `${tick.left}%` }}
                        title={`${CHANGE_TYPES[tick.type].label} · ${tick.day}`}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {row.cycles > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-purple-950/70 text-purple-200 border-purple-700 font-semibold">
                      <Repeat className="w-3 h-3" />
                      {row.cycles}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 w-24">
                    <span className="font-mono text-slate-200 w-4">{row.moves}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${(row.moves / maxMoves) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-400">
                  {row.proposals} / {row.cancellations}
                </td>
                <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">{row.lastChangeDay}</td>
              </tr>
            )
          })}
          {rows.length === 0 && loading && <EmptyRow columns={6}>Loading…</EmptyRow>}
          {rows.length === 0 && !loading && <EmptyRow columns={6}>No auction changed in this period.</EmptyRow>}
        </tbody>
      </TableCard>
    </div>
  )
}

// ---------------- Flows ----------------

const FlowsPanel: React.FC<{ from: string; to: string; segments: AuctionSegment[]; onPickPair: (from: number, to: number) => void }> = ({ from, to, segments, onPickPair }) => {
  const [rows, setRows] = useState<SegmentTransition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listSegmentTransitions({ from, to })
      .then((res) => !cancelled && setRows(res))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [from, to])

  const chart = useMemo(() => {
    const ids = [...new Set(rows.flatMap((row) => [row.fromSegmentId, row.toSegmentId]))].sort((a, b) => a - b)
    const names = ids.map((id) => segmentName(id, segments))
    const z = ids.map((fromId) => ids.map((toId) => rows.find((row) => row.fromSegmentId === fromId && row.toSegmentId === toId)?.moves ?? null))
    return {
      ids,
      data: [
        {
          type: 'heatmap',
          x: names,
          y: names,
          z,
          xgap: 3,
          ygap: 3,
          hoverongaps: false,
          colorscale: [
            [0, '#1e1b4b'],
            [0.5, '#7c3aed'],
            [1, '#f0abfc'],
          ],
          colorbar: { thickness: 10, outlinewidth: 0, tickfont: { size: 10 } },
          hovertemplate: '%{y} → %{x}<br>%{z} moves<extra></extra>',
        },
      ],
      layout: {
        margin: { l: 130, r: 16, t: 16, b: 110 },
        xaxis: { title: { text: 'moved into', font: { size: 11 } }, tickangle: -40, showgrid: false },
        yaxis: { title: { text: 'moved out of', font: { size: 11 } }, autorange: 'reversed', showgrid: false },
      },
    }
  }, [rows, segments])

  const maxMoves = Math.max(...rows.map((row) => row.moves), 1)
  const total = rows.reduce((sum, row) => sum + row.moves, 0)

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {!error && rows.length === 0 && !loading && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-sm text-slate-500">No auction moved between segments in this period.</div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-200">Moves between segments</h3>
            <p className="text-[11px] text-slate-500 mb-2">
              {total} moves between {from} and {to}. Bright cells on both sides of the diagonal are pairs auctions cycle between. Click a cell to list its moves.
            </p>
            <PlotlyChart
              data={chart.data}
              layout={chart.layout}
              className="w-full h-[460px]"
              onPointClick={(point) => {
                const [toIndex, fromIndex] = point.pointIndex ?? []
                if (point.z && chart.ids[fromIndex] !== undefined && chart.ids[toIndex] !== undefined) onPickPair(chart.ids[fromIndex], chart.ids[toIndex])
              }}
            />
          </div>

          <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-200">Busiest routes</h3>
            <p className="text-[11px] text-slate-500 mb-3">Mean distance to the old and to the new segment on the day of the move.</p>
            <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
              {rows.slice(0, 25).map((row) => (
                <li key={`${row.fromSegmentId}-${row.toSegmentId}`}>
                  <button
                    onClick={() => onPickPair(row.fromSegmentId, row.toSegmentId)}
                    className="w-full text-left rounded-lg border border-slate-800 bg-slate-950/50 hover:border-purple-500/40 px-3 py-2 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <SegmentChip id={row.fromSegmentId} segments={segments} />
                        <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        <SegmentChip id={row.toSegmentId} segments={segments} />
                      </span>
                      <span className="font-mono font-semibold text-slate-100 shrink-0">{row.moves}</span>
                    </div>
                    <div className="h-1 mt-2 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-purple-500/70" style={{ width: `${(row.moves / maxMoves) * 100}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-1">
                      {row.meanFromDistance.toFixed(3)} → {row.meanToDistance.toFixed(3)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- History ----------------

const HistoryPanel: React.FC<{
  from: string
  to: string
  segments: AuctionSegment[]
  pair: { from: number; to: number } | null
  onClearPair: () => void
  onSelect: (s: Selected) => void
}> = ({ from, to, segments, pair, onClearPair, onSelect }) => {
  const [rows, setRows] = useState<AssignmentChange[]>([])
  const [totalCount, setTotalCount] = useState<number>()
  const [totalPages, setTotalPages] = useState<number>()
  const [type, setType] = useState<AssignmentChangeType | ''>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listAssignmentChanges({
        type: pair && !type ? ['Switched', 'Promoted'] : type || undefined,
        fromSegment: pair?.from,
        toSegment: pair?.to,
        dayFrom: from,
        dayTo: to,
        search: query || undefined,
        page,
        'per-page': PER_PAGE,
      })
      .then((res) => {
        if (cancelled) return
        setRows(res.changes)
        setTotalCount(res.totalCount)
        setTotalPages(res.totalPages)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [from, to, pair, type, query, page, reload])

  return (
    <div className="space-y-6">
      <Toolbar
        search={search}
        placeholder="Product name or offer ID…"
        onSearch={setSearch}
        onSubmit={() => {
          setPage(0)
          setQuery(search.trim())
        }}
        loading={loading}
        onRefresh={() => setReload((n) => n + 1)}
      >
        {pair && (
          <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border border-purple-500/40 bg-purple-600/10 text-xs">
            <SegmentChip id={pair.from} segments={segments} />
            <ArrowRight className="w-3 h-3 text-slate-500" />
            <SegmentChip id={pair.to} segments={segments} />
            <button onClick={onClearPair} aria-label="Clear segment pair" className="p-0.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
        <select value={type} onChange={(e) => (setType(e.target.value as AssignmentChangeType | ''), setPage(0))} aria-label="Event type" className={INPUT}>
          <option value="">{pair ? 'Moves only' : 'All events'}</option>
          {(Object.keys(CHANGE_TYPES) as AssignmentChangeType[]).map((name) => (
            <option key={name} value={name}>
              {CHANGE_TYPES[name].label}
            </option>
          ))}
        </select>
        <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/80 font-mono">{totalCount ?? '…'} events</span>
      </Toolbar>

      {error && <ErrorBox message={error} />}

      <TableCard page={page} totalPages={totalPages} loading={loading} onPage={setPage}>
        <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Day</th>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3">Auction</th>
            <th className="px-4 py-3">From</th>
            <th className="px-4 py-3">To</th>
            <th className="px-4 py-3 whitespace-nowrap">Distance old → new</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onSelect(row)} className="hover:bg-slate-800/50 transition-colors cursor-pointer">
              <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">{row.day}</td>
              <td className="px-4 py-3">
                <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${CHANGE_TYPES[row.type].className}`} title={CHANGE_TYPES[row.type].hint}>
                  {CHANGE_TYPES[row.type].label}
                </span>
              </td>
              <AuctionCell productName={row.productName} offerId={row.offerId} />
              <td className="px-4 py-3">{row.fromSegment ? <SegmentChip id={row.fromSegment.id} segments={segments} /> : <span className="text-slate-600">—</span>}</td>
              <td className="px-4 py-3">
                <SegmentChip id={row.toSegment.id} segments={segments} />
              </td>
              <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                {row.fromDistance !== null ? row.fromDistance.toFixed(3) : '—'} <span className="text-slate-600">→</span> {row.toDistance.toFixed(3)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && loading && <EmptyRow columns={6}>Loading…</EmptyRow>}
          {rows.length === 0 && !loading && <EmptyRow columns={6}>No events match in this period.</EmptyRow>}
        </tbody>
      </TableCard>
    </div>
  )
}

// ---------------- Shared pieces ----------------

const TONES = {
  rose: 'border-rose-900/70 bg-rose-950/20 text-rose-200',
  amber: 'border-amber-900/60 bg-amber-950/20 text-amber-200',
  sky: 'border-sky-900/60 bg-sky-950/20 text-sky-200',
  slate: 'border-slate-800 bg-slate-900 text-slate-100',
}

const Tile: React.FC<{ label: string; value: number; hint: string; tone: keyof typeof TONES; capped?: boolean }> = ({ label, value, hint, tone, capped }) => (
  <div className={`rounded-2xl border p-4 shadow-xl ${TONES[tone]}`}>
    <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
    <div className="text-3xl font-bold font-mono mt-1">
      {value}
      {capped && <span className="text-base text-slate-500">+</span>}
    </div>
    <div className="text-[11px] text-slate-500 mt-1">{capped ? 'among the 100 soonest' : hint}</div>
  </div>
)

const SegmentChip: React.FC<{ id: number; segments: AuctionSegment[] }> = ({ id, segments }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-slate-200 whitespace-nowrap max-w-[11rem]">
    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: segmentColor(id, segments) }} />
    <span className="truncate">{segmentName(id, segments)}</span>
  </span>
)

const AuctionCell: React.FC<{ productName: string | null; offerId: string }> = ({ productName, offerId }) => (
  <td className="px-4 py-3 max-w-xs">
    <div className="text-slate-200 truncate" title={productName ?? undefined}>
      {productName ?? <span className="text-slate-600">Unnamed product</span>}
    </div>
    <div className="text-[11px] font-mono text-slate-500 truncate">{offerId}</div>
  </td>
)

const SegmentSelect: React.FC<{ value: string; segments: AuctionSegment[]; label: string; onChange: (value: string) => void }> = ({ value, segments, label, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={INPUT}>
    <option value="">{label}</option>
    {segments.map((segment) => (
      <option key={segment.id} value={segment.id}>
        {segment.name || `Segment #${segment.id}`}
      </option>
    ))}
  </select>
)

const Toolbar: React.FC<{
  search: string
  placeholder: string
  onSearch: (value: string) => void
  onSubmit: () => void
  loading: boolean
  onRefresh: () => void
  children: React.ReactNode
}> = ({ search, placeholder, onSearch, onSubmit, loading, onRefresh, children }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md"
      >
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2" />
          <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label="Search" className={`${INPUT} w-full pl-9`} />
        </div>
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shrink-0">
          Search
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        {children}
        <button onClick={onRefresh} disabled={loading} title="Refresh" className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  </div>
)

const TableCard: React.FC<{ page: number; totalPages?: number; loading: boolean; onPage: (page: number) => void; children: React.ReactNode }> = ({
  page,
  totalPages,
  loading,
  onPage,
  children,
}) => (
  <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
    <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <table className="min-w-full divide-y divide-slate-800 text-left text-xs">{children}</table>
    </div>
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-slate-800 bg-slate-950/60 text-xs">
      <div className="text-slate-400">
        Page <span className="font-semibold text-slate-200">{page + 1}</span>
        {totalPages !== undefined && <span> of {Math.max(totalPages, 1)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page <= 0 || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Previous</span>
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={(totalPages !== undefined && page + 1 >= totalPages) || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </div>
)

const EmptyRow: React.FC<{ columns: number; children: React.ReactNode }> = ({ columns, children }) => (
  <tr>
    <td colSpan={columns} className="px-4 py-10 text-center text-slate-500">
      {children}
    </td>
  </tr>
)

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start gap-3 text-xs">
    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
    <span>{message}</span>
  </div>
)
