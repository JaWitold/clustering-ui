import React, { useState, useEffect } from 'react'
import {
  Layers,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import type { ClusterAssignment, AuctionSegment } from '../types/clustering'
import { api } from '../api/client'

interface SegmentAuctionsModalProps {
  clusterId: number
  segment: AuctionSegment
  /** Color swatch of the segment on the chart. */
  color: string
  onClose: () => void
  /** Open the offer in the Assignments tab (pre-searched). */
  onOpenOfferAssignments?: (offerId: string) => void
}

const PER_PAGE = 20

/** Paginated list of the auctions currently assigned to one segment of a cluster. */
export const SegmentAuctionsModal: React.FC<SegmentAuctionsModalProps> = ({
  clusterId,
  segment,
  color,
  onClose,
  onOpenOfferAssignments,
}) => {
  const [assignments, setAssignments] = useState<ClusterAssignment[]>([])
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined)
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [marking, setMarking] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchPage = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.listAssignments({
          cluster: clusterId,
          segment: segment.id,
          marking: marking || undefined,
          page,
          'per-page': PER_PAGE,
        })
        if (cancelled) return
        setAssignments(res.assignments)
        setTotalCount(res.totalCount)
        setTotalPages(res.totalPages)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load auctions for segment')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPage()
    return () => {
      cancelled = true
    }
  }, [clusterId, segment.id, marking, page])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const segmentLabel = segment.name || `Segment #${segment.id}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="w-5 h-5 text-purple-400 shrink-0" />
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <h3 className="text-base sm:text-lg font-bold text-slate-100">Auctions in {segmentLabel}</h3>
            <span className="text-xs text-slate-400 px-2 py-0.5 bg-slate-800 rounded font-mono">
              Cluster #{clusterId} • Segment #{segment.id}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/80 font-mono">
              {totalCount !== undefined ? totalCount : '…'} offers
            </span>
          </div>
          <div className="flex items-center space-x-3 shrink-0 self-end sm:self-auto">
            <select
              value={marking}
              onChange={(e) => {
                setMarking(e.target.value)
                setPage(0)
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">All States</option>
              <option value="Stable">Stable</option>
              <option value="Pending">Pending (Hysteresis)</option>
            </select>
            <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-2 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider sticky top-0">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Offer ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Product ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 whitespace-nowrap">Candidate Segment</th>
                <th className="px-4 py-3 whitespace-nowrap">Centroid Distance</th>
                <th className="px-4 py-3 whitespace-nowrap">Day</th>
                <th className="px-4 py-3 whitespace-nowrap text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono">
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-purple-300 whitespace-nowrap">{a.offerId}</td>
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{a.productId}</td>
                  <td className="px-4 py-2.5 font-sans whitespace-nowrap">
                    {a.marking === 'Stable' ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>Stable</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800">
                        <Clock className="w-3 h-3 text-amber-400" />
                        <span>Pending</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-slate-400 whitespace-nowrap">
                    {a.candidateSegment ? (
                      <div>
                        <span className="text-amber-300 font-medium">
                          {a.candidateSegment.name || `Segment #${a.candidateSegment.id}`}
                        </span>
                        {a.candidateSince && (
                          <span className="text-[11px] text-slate-500 block font-mono">since {a.candidateSince}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300 font-semibold whitespace-nowrap">
                    {a.distance !== null ? a.distance.toFixed(4) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{a.day}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {onOpenOfferAssignments && (
                      <button
                        onClick={() => onOpenOfferAssignments(a.offerId)}
                        title="Open in Assignments"
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-sans font-medium"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No auctions assigned to this segment{marking ? ` with state ${marking}` : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/60 text-xs">
          <div className="text-slate-400 flex items-center space-x-2">
            {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-500" />}
            <span>
              Page <span className="font-semibold text-slate-200">{page + 1}</span>
              {totalPages !== undefined && <span> of {totalPages}</span>}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0 || loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(totalPages !== undefined && page + 1 >= totalPages) || loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
