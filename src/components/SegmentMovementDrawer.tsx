import React from 'react'
import { ArrowRight, LogIn, LogOut, Repeat, TrendingUp, X } from 'lucide-react'
import type { AuctionDynamics, AuctionSegment, SegmentStrategy } from '../types/clustering'
import type { SegmentFlow, SegmentMovement } from '../utils/segmentMovement'
import { segmentColor, segmentName, urgencyClass } from '../utils/drift'

interface SegmentMovementDrawerProps {
  segment: AuctionSegment
  movement: SegmentMovement
  segments: AuctionSegment[]
  strategies: Map<number, SegmentStrategy>
  /** Days the recent moves cover. */
  periodDays: number
  onClose: () => void
  onSelectOffer: (offerId: string, productName: string | null) => void
  onOpenAdvanced?: () => void
}

const LIST_LIMIT = 12

const strategyLabel = (strategy: SegmentStrategy | undefined): string =>
  strategy && strategy.enabled ? `${strategy.cutStrategy} / ${strategy.hikeStrategy}` : 'Global default'

const when = (days: number): string => (days === 1 ? 'tomorrow' : `in ${days} days`)

/** Business view of one segment's movement: who is about to leave or join, where they go, and which auctions keep bouncing. */
export const SegmentMovementDrawer: React.FC<SegmentMovementDrawerProps> = ({ segment, movement, segments, strategies, periodDays, onClose, onSelectOffer, onOpenAdvanced }) => {
  const ownStrategy = strategyLabel(strategies.get(segment.id))

  const auction = (row: AuctionDynamics, other: number, direction: 'out' | 'in') => {
    const otherStrategy = strategyLabel(strategies.get(other))
    const changes = otherStrategy !== ownStrategy
    return (
      <li key={row.offerId}>
        <button onClick={() => onSelectOffer(row.offerId, row.productName)} className="w-full text-left rounded-lg border border-slate-800 bg-slate-950/50 hover:border-purple-500/40 px-3 py-2 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-100 truncate">{row.productName ?? row.offerId}</span>
            <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold shrink-0 ${urgencyClass(row.daysToSwitch ?? 7)}`}>{when(row.daysToSwitch ?? 7)}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
            {direction === 'out' ? <ArrowRight className="w-3 h-3 text-slate-600" /> : <span className="text-slate-600">from</span>}
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: segmentColor(other, segments) }} />
            <span className="truncate">{segmentName(other, segments)}</span>
          </div>
          {changes && (
            <div className="text-[11px] text-amber-300/90 mt-1">
              Pricing changes: {direction === 'out' ? `${ownStrategy} → ${otherStrategy}` : `${otherStrategy} → ${ownStrategy}`}
            </div>
          )}
        </button>
      </li>
    )
  }

  const flows = (rows: SegmentFlow[], emptyText: string) => {
    const max = Math.max(...rows.map((row) => row.moves), 1)
    return rows.length === 0 ? (
      <p className="text-xs text-slate-500">{emptyText}</p>
    ) : (
      <ul className="space-y-2">
        {rows.slice(0, 6).map((row) => (
          <li key={row.segmentId} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0 text-slate-200">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: segmentColor(row.segmentId, segments) }} />
                <span className="truncate">{segmentName(row.segmentId, segments)}</span>
              </span>
              <span className="font-mono text-slate-300">{row.moves}</span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-purple-500/70" style={{ width: `${(row.moves / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Movement of ${segmentName(segment.id, segments)}`} className="w-full max-w-3xl h-full bg-slate-900 border-l border-slate-800 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: segmentColor(segment.id, segments) }} />
              <span className="truncate">{segmentName(segment.id, segments)}</span>
            </h3>
            <p className="text-xs text-slate-400">Which auctions are about to leave or join this segment, and which keep bouncing. Strategy: {ownStrategy}.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-6 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Tile icon={<LogOut className="w-3.5 h-3.5" />} label="Leaving soon" value={movement.leaving.length} tone="text-rose-200" />
            <Tile icon={<LogIn className="w-3.5 h-3.5" />} label="Joining soon" value={movement.arriving.length} tone="text-emerald-200" />
            <Tile label={`Left, ${periodDays} days`} value={movement.movedOut} tone="text-slate-100" />
            <Tile label={`Joined, ${periodDays} days`} value={movement.movedIn} tone="text-slate-100" />
            <Tile icon={<Repeat className="w-3.5 h-3.5" />} label="Bouncing" value={movement.cycling.length} tone="text-purple-200" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <section>
              <h4 className="text-sm font-semibold text-slate-200">About to leave</h4>
              <p className="text-[11px] text-slate-500 mb-2">At their current pace these auctions will fit another segment better within a week.</p>
              {movement.leaving.length === 0 ? (
                <p className="text-xs text-slate-500">Nobody is expected to leave.</p>
              ) : (
                <ul className="space-y-2">{movement.leaving.slice(0, LIST_LIMIT).map((row) => auction(row, row.predictedSegment!, 'out'))}</ul>
              )}
              {movement.leaving.length > LIST_LIMIT && <p className="text-[11px] text-slate-500 mt-2">+ {movement.leaving.length - LIST_LIMIT} more in the advanced view</p>}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-slate-200">About to join</h4>
              <p className="text-[11px] text-slate-500 mb-2">Auctions of other segments heading here.</p>
              {movement.arriving.length === 0 ? (
                <p className="text-xs text-slate-500">Nobody is expected to join.</p>
              ) : (
                <ul className="space-y-2">{movement.arriving.slice(0, LIST_LIMIT).map((row) => auction(row, row.segment, 'in'))}</ul>
              )}
              {movement.arriving.length > LIST_LIMIT && <p className="text-[11px] text-slate-500 mt-2">+ {movement.arriving.length - LIST_LIMIT} more in the advanced view</p>}
            </section>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <section>
              <h4 className="text-sm font-semibold text-slate-200 mb-2">Where they went ({periodDays} days)</h4>
              {flows(movement.destinations, 'No auction left this segment.')}
            </section>
            <section>
              <h4 className="text-sm font-semibold text-slate-200 mb-2">Where they came from ({periodDays} days)</h4>
              {flows(movement.origins, 'No auction joined this segment.')}
            </section>
          </div>

          <section>
            <h4 className="text-sm font-semibold text-slate-200">Bouncing auctions</h4>
            <p className="text-[11px] text-slate-500 mb-2">They left a segment and came back within {periodDays} days, so their pricing strategy keeps flipping.</p>
            {movement.cycling.length === 0 ? (
              <p className="text-xs text-slate-500">No auction of this segment bounced.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {movement.cycling.slice(0, LIST_LIMIT).map((row) => (
                  <li key={row.offerId}>
                    <button onClick={() => onSelectOffer(row.offerId, row.productName)} className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 hover:border-purple-500/40 px-3 py-2 text-left transition-colors">
                      <span className="text-xs text-slate-100 truncate">{row.productName ?? row.offerId}</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-purple-950/70 text-purple-200 border-purple-700 text-[11px] font-semibold shrink-0" title={`${row.moves} moves, came back ${row.cycles} times`}>
                        <Repeat className="w-3 h-3" />
                        {row.cycles}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {onOpenAdvanced && (
          <div className="px-5 py-3 border-t border-slate-800 flex justify-end">
            <button onClick={onOpenAdvanced} className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200">
              <TrendingUp className="w-3.5 h-3.5" />
              Open the advanced drift & forecast view
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const Tile: React.FC<{ label: string; value: number; tone: string; icon?: React.ReactNode }> = ({ label, value, tone, icon }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
      {icon}
      <span>{label}</span>
    </div>
    <div className={`text-2xl font-bold font-mono ${tone}`}>{value}</div>
  </div>
)
