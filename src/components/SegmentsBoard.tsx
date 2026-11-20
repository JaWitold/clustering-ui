import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Edit2, LogIn, LogOut, RefreshCw, Repeat, Search, TrendingUp, X } from 'lucide-react'
import type {
  AuctionSegment,
  Centroid,
  Cluster,
  ClusterMembership,
  SegmentMembershipTotals,
  SegmentStrategy,
} from '../types/clustering'
import { CUT_STRATEGY_NAMES, FEATURE_GROUPS, HIKE_STRATEGY_NAMES } from '../types/clustering'
import { api } from '../api/client'
import { KEY_TRAITS, TRAITS, level, money, standsOut, suggestName, type Level } from '../utils/featureFormat'
import { loadMovement } from '../api/movement'
import type { MovementSummary } from '../utils/segmentMovement'
import { addDays, segmentName, yesterday } from '../utils/drift'
import { SegmentMovementDrawer } from './SegmentMovementDrawer'
import { OfferDriftModal } from './OfferDriftModal'
import { MembershipTrends } from './MembershipTrends'

const PER_PAGE = 20
const MOVEMENT_DAYS = 14

const LEVEL_STYLE: Record<Level, string> = {
  High: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Typical: 'bg-slate-800 text-slate-400 border-slate-700',
  Low: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

const MEMBER_SORTS: { value: string; label: string }[] = [
  { value: '-profit', label: 'Profit' },
  { value: '-revenue', label: 'Revenue' },
  { value: '-unitsSold', label: 'Units sold' },
  { value: '-priceChanges', label: 'Price changes' },
  { value: 'distance', label: 'Most typical first' },
]

const TOTAL_SORTS: { key: 'offers' | 'unitsSold' | 'profit'; label: string }[] = [
  { key: 'offers', label: 'Auctions' },
  { key: 'unitsSold', label: 'Units' },
  { key: 'profit', label: 'Profit' },
]

// amber = above a typical auction, blue = below; stronger colour = further away
const heat = (scaled: number) => ({
  backgroundColor: `rgba(${scaled > 0 ? '245,158,11' : '14,165,233'},${(Math.min(Math.abs(scaled), 3) / 3) * 0.5})`,
})

const segmentLabel = (segment: AuctionSegment) => segment.name || `Segment #${segment.id}`
const day = (iso: string) => iso.slice(0, 10)

interface SegmentsBoardProps {
  /** Opens the advanced drift & forecast view. */
  onOpenDrift?: () => void
  onOpenOfferAssignments?: (offerId: string) => void
}

export const SegmentsBoard: React.FC<SegmentsBoardProps> = ({ onOpenDrift, onOpenOfferAssignments }) => {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [clusterId, setClusterId] = useState<number | null>(null)
  const [cluster, setCluster] = useState<Cluster | null>(null)
  const [totals, setTotals] = useState<SegmentMembershipTotals[]>([])
  const [strategies, setStrategies] = useState<SegmentStrategy[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const [editing, setEditing] = useState<{ segment: AuctionSegment; strategy: SegmentStrategy | null } | null>(null)
  const [openSegment, setOpenSegment] = useState<AuctionSegment | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [found, setFound] = useState<ClusterMembership[] | null>(null)
  const [view, setView] = useState<'compare' | 'cards' | 'trends'>('compare')
  const [allTraits, setAllTraits] = useState(false)
  const [sortKey, setSortKey] = useState('offers')
  const [topGames, setTopGames] = useState<Map<number, string[]>>(new Map())
  const [movement, setMovement] = useState<MovementSummary | null>(null)
  const [movementSegment, setMovementSegment] = useState<AuctionSegment | null>(null)
  const [offer, setOffer] = useState<{ offerId: string; productName: string | null } | null>(null)

  useEffect(() => {
    Promise.all([
      api.listClusters({ marking: 'Promoted', 'per-page': 100 }),
      api.listClusters({ marking: 'Candidate', sort: '-id', 'per-page': 100 }),
    ])
      .then(([promoted, candidates]) => {
        setClusters([...promoted, ...candidates])
        setClusterId(promoted[0]?.id ?? candidates[0]?.id ?? null)
      })
      .catch((err) => setError(err?.message || 'Failed to load clusters'))
  }, [])

  const load = async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      const [detail, segmentTotals, mappings] = await Promise.all([
        api.getCluster(id),
        api.getMembershipTotals(id),
        api.listSegmentStrategies(),
      ])
      setCluster(detail)
      setTotals(segmentTotals)
      setStrategies(mappings)
      const games = segmentTotals.length
        ? await Promise.all(
            (detail.centroids ?? []).map((c) =>
              api
                .listMemberships({ cluster: id, segment: c.segment.id, sort: '-unitsSold', 'per-page': 10 })
                .then((r): [number, string[]] => [c.segment.id, r.memberships.slice(0, 3).map((m) => m.productName ?? m.productId)])
                .catch((): [number, string[]] => [c.segment.id, []]),
            ),
          )
        : []
      setTopGames(new Map(games))
    } catch (err: any) {
      setError(err?.message || 'Failed to load segments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (clusterId !== null) load(clusterId)
  }, [clusterId])

  const isLive = cluster?.marking === 'Promoted'

  useEffect(() => {
    let cancelled = false
    setMovement(null)
    if (!isLive) return
    loadMovement(yesterday(), addDays(yesterday(), -(MOVEMENT_DAYS - 1)), yesterday())
      .then((summary) => !cancelled && setMovement(summary))
      .catch(() => !cancelled && setMovement(null))

    return () => {
      cancelled = true
    }
  }, [isLive, cluster?.id])

  const run = async (action: () => Promise<unknown>, success: string, onDone: () => void) => {
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err: any) {
      return setError(err?.message || 'Request failed')
    }
    onDone()
    setNotice(success)
    if (clusterId !== null) await load(clusterId)
  }

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (clusterId === null || !searchInput.trim()) return setFound(null)
    try {
      setFound((await api.listMemberships({ cluster: clusterId, search: searchInput.trim(), 'per-page': PER_PAGE })).memberships)
    } catch (err: any) {
      setError(err?.message || 'Search failed')
    }
  }

  const featureNames = cluster?.featureNames ?? Object.keys(FEATURE_GROUPS)
  const totalsBySegment = new Map(totals.map((t) => [t.segmentId, t]))
  const strategyBySegment = new Map(strategies.map((s) => [s.segment.id, s]))
  const sortValue = (c: Centroid) => {
    const i = featureNames.indexOf(sortKey)
    if (i >= 0) return c.scaled[i]
    const t = totalsBySegment.get(c.segment.id)
    return sortKey === 'offers' ? (t?.offers ?? c.size) : (t?.[sortKey as 'unitsSold' | 'profit'] ?? 0)
  }
  const rows = [...(cluster?.centroids ?? [])].sort((a, b) => sortValue(b) - sortValue(a))
  const traitColumns = (allTraits ? featureNames : KEY_TRAITS).filter((n) => featureNames.includes(n) && TRAITS[n])

  const trait = (centroid: Centroid, name: string) => {
    const i = featureNames.indexOf(name)
    if (i < 0 || !TRAITS[name]) return null
    const lvl = level(centroid.scaled[i])
    return (
      <div key={name} title={TRAITS[name].hint} className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">{TRAITS[name].label}</span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-100">{TRAITS[name].format(centroid.source[i])}</span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${LEVEL_STYLE[lvl]}`}>{lvl}</span>
        </span>
      </div>
    )
  }

  const nameCell = (segment: AuctionSegment, scaled: number[]) => {
    const suggestion = suggestName(featureNames, scaled)
    if (renaming?.id === segment.id) {
      return (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => api.updateSegment(segment.id, renaming.name.trim()), 'Segment renamed.', () => setRenaming(null))
          }}
        >
          <input
            autoFocus
            maxLength={100}
            value={renaming.name}
            onChange={(e) => setRenaming({ id: segment.id, name: e.target.value })}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 min-w-40 flex-1"
          />
          <button className="text-xs text-purple-300">Save</button>
          <button type="button" onClick={() => setRenaming(null)} className="text-xs text-slate-500">
            Cancel
          </button>
        </form>
      )
    }
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">{segmentLabel(segment)}</span>
          <button onClick={() => setRenaming({ id: segment.id, name: segment.name ?? '' })} title="Rename">
            <Edit2 className="w-3.5 h-3.5 text-slate-500 hover:text-slate-200" />
          </button>
        </div>
        {suggestion !== segment.name && (
          <button
            onClick={() => setRenaming({ id: segment.id, name: suggestion })}
            className="text-[11px] text-slate-500 hover:text-purple-300 text-left"
            title="Name built from what makes this segment different; click to edit and save"
          >
            Suggest: {suggestion}
          </button>
        )}
      </div>
    )
  }

  const segmentList = (cluster?.centroids ?? []).map((c) => c.segment)

  const movementCell = (segment: AuctionSegment) => {
    const m = movement?.bySegment.get(segment.id)
    if (!m || (m.leaving.length === 0 && m.arriving.length === 0 && m.cycling.length === 0 && m.movedOut === 0 && m.movedIn === 0)) {
      return <span className="text-slate-600">{movement ? 'steady' : '–'}</span>
    }
    return (
      <button onClick={() => setMovementSegment(segment)} className="flex flex-col items-start gap-0.5 text-left hover:opacity-80" title="Open the movement of this segment">
        {m.leaving.length > 0 && (
          <span className="inline-flex items-center gap-1 text-rose-300 whitespace-nowrap">
            <LogOut className="w-3 h-3" />
            {m.leaving.length} leaving soon
          </span>
        )}
        {m.arriving.length > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-300 whitespace-nowrap">
            <LogIn className="w-3 h-3" />
            {m.arriving.length} joining soon
          </span>
        )}
        {m.cycling.length > 0 && (
          <span className="inline-flex items-center gap-1 text-purple-300 whitespace-nowrap">
            <Repeat className="w-3 h-3" />
            {m.cycling.length} bouncing
          </span>
        )}
        {m.leaving.length === 0 && m.arriving.length === 0 && m.cycling.length === 0 && (
          <span className="text-slate-400 whitespace-nowrap">
            {m.movedOut} left · {m.movedIn} joined
          </span>
        )}
      </button>
    )
  }

  const sortHeader = (key: string, label: string, hint?: string) => (
    <th key={key} title={hint} className="p-2 text-right font-medium whitespace-nowrap">
      <button onClick={() => setSortKey(key)} className={sortKey === key ? 'text-purple-300' : 'hover:text-slate-200'}>
        {label}
        {sortKey === key ? ' ▼' : ''}
      </button>
    </th>
  )

  const compareTable = (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-slate-400 border-b border-slate-800">
          <tr>
            <th className="p-2 pl-4 text-left font-medium min-w-56">Segment</th>
            <th className="p-2 text-left font-medium min-w-52">Best-selling games</th>
            {TOTAL_SORTS.map((c) => sortHeader(c.key, c.label))}
            {isLive && (
              <th className="p-2 text-left font-medium" title={`Auctions expected to change segment within a week, and auctions that bounced in the last ${MOVEMENT_DAYS} days`}>
                Movement
              </th>
            )}
            <th className="p-2 text-left font-medium">Strategy</th>
            {traitColumns.map((n) => sortHeader(n, TRAITS[n].label, TRAITS[n].hint))}
          </tr>
        </thead>
        <tbody>
          {rows.map((centroid) => {
            const segment = centroid.segment
            const t = totalsBySegment.get(segment.id)
            const strategy = strategyBySegment.get(segment.id)
            const games = topGames.get(segment.id) ?? []
            return (
              <tr key={centroid.id} className="border-b border-slate-800/60 align-top">
                <td className="p-2 pl-4">
                  {nameCell(segment, centroid.scaled)}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {standsOut(featureNames, centroid.scaled, 3).map((o) => (
                      <span key={o.name} style={heat(o.scaled)} className="px-1.5 py-0.5 rounded text-[10px] text-slate-100">
                        {TRAITS[o.name].words[o.scaled > 0 ? 1 : 0]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-2">
                  {games.map((g) => (
                    <div key={g} className="text-slate-200 truncate max-w-56" title={g}>
                      {g}
                    </div>
                  ))}
                  <button onClick={() => setOpenSegment(segment)} className="text-purple-300 hover:text-purple-200">
                    {games.length ? 'all products →' : 'show products →'}
                  </button>
                </td>
                <td className="p-2 text-right text-slate-200">{t?.offers ?? centroid.size}</td>
                <td className="p-2 text-right text-slate-200">{t?.unitsSold ?? '–'}</td>
                <td className={`p-2 text-right ${(t?.profit ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{t ? money(t.profit) : '–'}</td>
                {isLive && <td className="p-2">{movementCell(segment)}</td>}
                <td className="p-2">
                  <button onClick={() => setEditing({ segment, strategy: strategy ?? null })} className="text-left hover:text-purple-300">
                    {strategy ? (
                      <span className={strategy.enabled ? 'text-slate-200' : 'text-amber-300'}>
                        {strategy.cutStrategy} / {strategy.hikeStrategy}
                        {!strategy.enabled && ' (paused)'}
                      </span>
                    ) : (
                      <span className="text-slate-500">Global default</span>
                    )}
                  </button>
                </td>
                {traitColumns.map((n) => {
                  const i = featureNames.indexOf(n)
                  return (
                    <td key={n} style={heat(centroid.scaled[i])} className="p-2 text-right text-slate-100 whitespace-nowrap">
                      {TRAITS[n].format(centroid.source[i])}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-[11px] text-slate-500">
        <span>Amber = above a typical auction, blue = below; stronger colour = further from typical. Click a column to sort.</span>
        <button onClick={() => setAllTraits(!allTraits)} className="text-slate-400 hover:text-slate-200 shrink-0">
          {allTraits ? 'Key traits only' : 'All 19 traits'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Segments</h1>
          <p className="text-xs text-slate-400 mt-1">
            Auctions with a similar market, their sales and the pricing strategy each group gets. Levels compare a segment with a typical auction.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={clusterId ?? ''}
            onChange={(e) => {
              setFound(null)
              setOpenSegment(null)
              setClusterId(Number(e.target.value))
            }}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.marking === 'Promoted' ? 'Live grouping' : 'Draft'} #{c.id} · {c.segmentCount} segments · {day(c.createdAt)}
              </option>
            ))}
          </select>
          <form onSubmit={search} className="flex gap-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Find product or offer…"
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 w-full sm:w-64"
            />
            <button className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white" title="Search">
              <Search className="w-4 h-4" />
            </button>
          </form>
          <div className="flex rounded-lg bg-slate-800 p-0.5 self-start text-xs">
            {(['compare', 'cards', 'trends'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md ${view === v ? 'bg-slate-950 text-purple-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {v === 'compare' ? 'Compare' : v === 'cards' ? 'Details' : 'Trends'}
              </button>
            ))}
          </div>
          <button
            onClick={() => clusterId !== null && load(clusterId)}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white self-start"
            title="Reload"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-sm">{error}</div>}
      {notice && <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-sm">{notice}</div>}

      {found && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
          <div className="flex justify-between mb-2 text-slate-400 text-xs">
            <span>{found.length ? `${found.length} match(es)` : 'Nothing found in this grouping'}</span>
            <button onClick={() => setFound(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {found.map((m) => (
            <button
              key={m.id}
              onClick={() => setOpenSegment(m.segment)}
              className="w-full flex justify-between gap-3 px-2 py-1.5 rounded hover:bg-slate-800 text-left"
            >
              <span className="text-slate-200 truncate">{m.productName ?? m.productId}</span>
              <span className="text-purple-300 shrink-0">{segmentLabel(m.segment)} →</span>
            </button>
          ))}
        </div>
      )}

      {cluster && totals.length === 0 && !loading && (
        <div className="p-4 rounded-xl border border-amber-800/60 bg-amber-950/30 text-sm text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>Sales figures and product lists are not recorded for this grouping yet.</span>
          <button
            onClick={() => run(() => api.recordMemberships(cluster.id), 'Recording queued — reload in a minute or two.', () => {})}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
          >
            Record now
          </button>
        </div>
      )}

      {isLive && movement && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span className="flex items-center gap-2 text-slate-300 font-semibold">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              Segment stability
            </span>
            <span className="text-slate-400">
              <span className="text-rose-300 font-semibold text-sm font-mono">
                {movement.switchingSoon}
                {movement.capped ? '+' : ''}
              </span>{' '}
              auctions expected to change segment within a week
            </span>
            <span className="text-slate-400">
              <span className="text-purple-300 font-semibold text-sm font-mono">{movement.cycling}</span> bouncing between segments (last {MOVEMENT_DAYS} days)
            </span>
            {movement.busiest && (
              <span className="text-slate-400">
                busiest route: <span className="text-slate-200">{segmentName(movement.busiest.fromSegmentId, segmentList)}</span> →{' '}
                <span className="text-slate-200">{segmentName(movement.busiest.toSegmentId, segmentList)}</span> ({movement.busiest.moves})
              </span>
            )}
          </div>
          {onOpenDrift && (
            <button onClick={onOpenDrift} className="text-xs text-purple-300 hover:text-purple-200 shrink-0 self-start lg:self-auto">
              Advanced view →
            </button>
          )}
        </div>
      )}

      {view === 'trends' && clusterId !== null ? <MembershipTrends clusterId={clusterId} segments={segmentList} /> : view === 'compare' ? compareTable : (
      <div className="space-y-3">
        {rows.map((centroid) => {
          const segment = centroid.segment
          const t = totalsBySegment.get(segment.id)
          const strategy = strategyBySegment.get(segment.id) ?? null
          const isOpen = expanded === segment.id
          return (
            <div key={centroid.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr_1fr]">
                <div className="space-y-2">
                  {nameCell(segment, centroid.scaled)}
                  <button onClick={() => setOpenSegment(segment)} className="text-xs text-purple-300 hover:text-purple-200">
                    {t ? `${t.offers} auctions` : `${centroid.size} auctions`} · show products →
                  </button>
                  {isLive && <div className="text-xs">{movementCell(segment)}</div>}
                  {t ? (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pt-1">
                      <dt className="text-slate-400">Units sold</dt>
                      <dd className="text-slate-100 font-semibold text-right">{t.unitsSold}</dd>
                      <dt className="text-slate-400">Revenue</dt>
                      <dd className="text-slate-100 font-semibold text-right">{money(t.revenue)}</dd>
                      <dt className="text-slate-400">Profit</dt>
                      <dd className={`font-semibold text-right ${t.profit < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{money(t.profit)}</dd>
                      <dt className="text-slate-400">Price changes</dt>
                      <dd className="text-slate-100 text-right">
                        {t.priceChanges} <span className="text-slate-500">({t.paidPriceChanges} paid)</span>
                      </dd>
                    </dl>
                  ) : (
                    <p className="text-xs text-slate-500">No sales figures recorded.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  {KEY_TRAITS.map((name) => trait(centroid, name))}
                  <button
                    onClick={() => setExpanded(isOpen ? null : segment.id)}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 pt-1"
                  >
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} All market traits
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 border-t border-slate-800 pt-2">
                      {featureNames.filter((n) => !KEY_TRAITS.includes(n)).map((name) => trait(centroid, name))}
                    </div>
                  )}
                </div>

                <div className="text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Strategy</span>
                    <button
                      onClick={() => setEditing({ segment, strategy })}
                      className="px-2 py-1 rounded bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30"
                    >
                      {strategy ? 'Change' : 'Assign'}
                    </button>
                  </div>
                  {strategy ? (
                    <>
                      {!strategy.enabled && <div className="text-amber-300">Paused — global default applies</div>}
                      <div className="text-slate-300">Cut: <b>{strategy.cutStrategy}</b></div>
                      <div className="text-slate-300">Raise: <b>{strategy.hikeStrategy}</b></div>
                      <div className="text-slate-500">
                        Last free change: {strategy.lastFreeChangeCutStrategy} / {strategy.lastFreeChangeHikeStrategy}
                      </div>
                      {strategy.note && <div className="text-slate-500 italic">{strategy.note}</div>}
                    </>
                  ) : (
                    <div className="text-slate-500">Global default</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}

      {openSegment && clusterId !== null && (
        <MembersDrawer clusterId={clusterId} segment={openSegment} onClose={() => setOpenSegment(null)} />
      )}

      {movementSegment && movement && (
        <SegmentMovementDrawer
          segment={movementSegment}
          movement={movement.bySegment.get(movementSegment.id) ?? { leaving: [], arriving: [], movedOut: 0, movedIn: 0, destinations: [], origins: [], cycling: [] }}
          segments={segmentList}
          strategies={strategyBySegment}
          periodDays={MOVEMENT_DAYS}
          onClose={() => setMovementSegment(null)}
          onSelectOffer={(offerId, productName) => setOffer({ offerId, productName })}
          onOpenAdvanced={onOpenDrift}
        />
      )}

      {offer && (
        <OfferDriftModal
          offerId={offer.offerId}
          productName={offer.productName}
          day={yesterday()}
          segments={segmentList}
          onClose={() => setOffer(null)}
          onOpenOfferAssignments={onOpenOfferAssignments}
        />
      )}

      {editing && (
        <StrategyModal
          segment={editing.segment}
          strategy={editing.strategy}
          onClose={() => setEditing(null)}
          onSave={(form) =>
            run(
              () =>
                editing.strategy
                  ? api.updateSegmentStrategy(editing.strategy.id, form)
                  : api.createSegmentStrategy({ ...form, segment: editing.segment.id }),
              'Strategy saved.',
              () => setEditing(null),
            )
          }
          onRemove={
            editing.strategy
              ? () => run(() => api.deleteSegmentStrategy(editing.strategy!.id), 'Segment uses the global default now.', () => setEditing(null))
              : undefined
          }
        />
      )}
    </div>
  )
}

const MembersDrawer: React.FC<{ clusterId: number; segment: AuctionSegment; onClose: () => void }> = ({ clusterId, segment, onClose }) => {
  const [sort, setSort] = useState('-profit')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ClusterMembership[]>([])
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listMemberships({ cluster: clusterId, segment: segment.id, sort, page, 'per-page': PER_PAGE })
      .then((res) => {
        setRows(res.memberships)
        setPages(res.totalPages ?? 1)
        setTotal(res.totalCount)
      })
      .catch((err) => setError(err?.message || 'Failed to load products'))
  }, [clusterId, segment.id, sort, page])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-3xl h-full bg-slate-900 border-l border-slate-800 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h3 className="font-semibold text-slate-100">{segmentLabel(segment)}</h3>
            <p className="text-xs text-slate-400">{total ?? '…'} auctions · sales over the window before the grouping was made</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value)
                setPage(0)
              }}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
            >
              {MEMBER_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {error && <div className="m-4 p-3 rounded bg-rose-950/50 text-rose-300 text-sm">{error}</div>}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 sticky top-0 bg-slate-900">
              <tr className="border-b border-slate-800">
                <th className="text-left p-2 pl-5">Product</th>
                <th className="text-right p-2">Units</th>
                <th className="text-right p-2">Revenue</th>
                <th className="text-right p-2">Profit</th>
                <th className="text-right p-2 pr-5">Price changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-slate-800/60">
                  <td className="p-2 pl-5">
                    <div className="text-slate-100">{m.productName ?? m.productId}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{m.offerId}</div>
                  </td>
                  <td className="text-right p-2 text-slate-200">{m.unitsSold}</td>
                  <td className="text-right p-2 text-slate-200">{money(m.revenue)}</td>
                  <td className={`text-right p-2 ${m.profit < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{money(m.profit)}</td>
                  <td className="text-right p-2 pr-5 text-slate-300">{m.priceChanges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 text-xs text-slate-400">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="disabled:opacity-30">
            ← Previous
          </button>
          <span>
            Page {page + 1} / {Math.max(pages, 1)}
          </span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="disabled:opacity-30">
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}

interface StrategyForm {
  cutStrategy: string
  hikeStrategy: string
  lastFreeChangeCutStrategy: string
  lastFreeChangeHikeStrategy: string
  enabled: boolean
  note?: string
}

const StrategyModal: React.FC<{
  segment: AuctionSegment
  strategy: SegmentStrategy | null
  onClose: () => void
  onSave: (form: StrategyForm) => void
  onRemove?: () => void
}> = ({ segment, strategy, onClose, onSave, onRemove }) => {
  const [form, setForm] = useState({
    cutStrategy: strategy?.cutStrategy ?? CUT_STRATEGY_NAMES[0],
    hikeStrategy: strategy?.hikeStrategy ?? HIKE_STRATEGY_NAMES[0],
    lastFreeChangeCutStrategy: strategy?.lastFreeChangeCutStrategy ?? CUT_STRATEGY_NAMES[0],
    lastFreeChangeHikeStrategy: strategy?.lastFreeChangeHikeStrategy ?? HIKE_STRATEGY_NAMES[0],
    enabled: strategy?.enabled ?? true,
    note: strategy?.note ?? '',
  })

  const select = (key: keyof typeof form, label: string, options: string[]) => (
    <label className="block">
      <span className="block text-slate-300 mb-1">{label}</span>
      <select
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, note: form.note || undefined })
        }}
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100">Strategy for {segmentLabel(segment)}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {select('cutStrategy', 'Cut', CUT_STRATEGY_NAMES)}
          {select('hikeStrategy', 'Raise', HIKE_STRATEGY_NAMES)}
          {select('lastFreeChangeCutStrategy', 'Last free change: cut', CUT_STRATEGY_NAMES)}
          {select('lastFreeChangeHikeStrategy', 'Last free change: raise', HIKE_STRATEGY_NAMES)}
        </div>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Active (unticked = segment uses the global default)
        </label>
        <input
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="Note, e.g. why this strategy"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
        />
        <div className="flex justify-between pt-3 border-t border-slate-800">
          {onRemove ? (
            <button
              type="button"
              onClick={() => window.confirm('Remove the strategy? The segment falls back to the global default.') && onRemove()}
              className="text-rose-300 hover:text-rose-200"
            >
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800">
              Cancel
            </button>
            <button className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold">Save</button>
          </div>
        </div>
      </form>
    </div>
  )
}
