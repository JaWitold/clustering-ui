import React, { useState, useEffect } from 'react'
import {
  Layers,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import type { ClusterAssignment, AuctionSegment } from '../types/clustering'
import { api } from '../api/client'

interface AssignmentsViewProps {
  /** Pre-fills the Offer ID search and runs it on mount (used by cross-tab navigation). */
  initialOfferId?: string
}

export const AssignmentsView: React.FC<AssignmentsViewProps> = ({ initialOfferId = '' }) => {
  const [assignments, setAssignments] = useState<ClusterAssignment[]>([])
  const [segments, setSegments] = useState<AuctionSegment[]>([])
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined)
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedSegment, setSelectedSegment] = useState<string>('')
  const [selectedMarking, setSelectedMarking] = useState<string>('')
  const [offerIdSearch, setOfferIdSearch] = useState<string>(initialOfferId)
  const [page, setPage] = useState<number>(0)
  const perPage = 20

  // Load segments list for dropdown
  useEffect(() => {
    api.listAllSegments().then(setSegments).catch(console.error)
  }, [])

  const fetchAssignments = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listAssignments({
        segment: selectedSegment ? parseInt(selectedSegment, 10) : undefined,
        marking: selectedMarking || undefined,
        offerId: offerIdSearch ? offerIdSearch.trim() : undefined,
        page,
        'per-page': perPage,
      })
      setAssignments(res.assignments)
      setTotalCount(res.totalCount)
      setTotalPages(res.totalPages)
    } catch (err: any) {
      setError(err?.message || 'Failed to load cluster assignments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAssignments()
  }, [selectedSegment, selectedMarking, page])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0)
    fetchAssignments()
  }

  return (
    <div className="space-y-6">
      {/* Header & Hysteresis Explanation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <Layers className="w-5 h-5 text-purple-400" />
              <span>Auction Segment Assignments</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Shows how each of our Eneba auctions is assigned to a segment under the active cluster.
              Assignments use a hysteresis state machine: an auction only switches segments after staying closer to the candidate segment for 3 consecutive days.
            </p>
          </div>
          <div className="flex items-center space-x-2 self-start md:self-auto">
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/80 font-mono">
              Total: {totalCount !== undefined ? totalCount : '...'} offers
            </span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 w-full sm:w-auto flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={offerIdSearch}
                onChange={(e) => setOfferIdSearch(e.target.value)}
                placeholder="Search by Offer ID..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shrink-0"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-3">
            {/* Segment Filter */}
            <div className="flex items-center space-x-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={selectedSegment}
                onChange={(e) => {
                  setSelectedSegment(e.target.value)
                  setPage(0)
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="">All Segments</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || `Segment #${s.id}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Marking Filter */}
            <select
              value={selectedMarking}
              onChange={(e) => {
                setSelectedMarking(e.target.value)
                setPage(0)
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">All States</option>
              <option value="Stable">Stable</option>
              <option value="Pending">Pending (Hysteresis)</option>
            </select>

            <button
              onClick={fetchAssignments}
              disabled={loading}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-3 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Offer ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Product ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Current Segment</th>
                <th className="px-4 py-3 whitespace-nowrap">Hysteresis Status</th>
                <th className="px-4 py-3 whitespace-nowrap">Candidate Segment</th>
                <th className="px-4 py-3 whitespace-nowrap">Centroid Distance</th>
                <th className="px-4 py-3 whitespace-nowrap">Target Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono">
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-semibold text-purple-300 whitespace-nowrap">{a.offerId}</td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{a.productId}</td>
                  <td className="px-4 py-3 font-sans whitespace-nowrap">
                    <span className="font-semibold text-slate-200">
                      {a.segment.name || `Segment #${a.segment.id}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-sans whitespace-nowrap">
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
                  <td className="px-4 py-3 font-sans text-slate-400 whitespace-nowrap">
                    {a.candidateSegment ? (
                      <div>
                        <span className="text-amber-300 font-medium">
                          {a.candidateSegment.name || `Segment #${a.candidateSegment.id}`}
                        </span>
                        {a.candidateSince && (
                          <span className="text-[11px] text-slate-500 block font-mono">
                            since {a.candidateSince}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-semibold whitespace-nowrap">
                    {a.distance !== null ? a.distance.toFixed(4) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{a.day}</td>
                </tr>
              ))}
              {assignments.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No assignments found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-t border-slate-800 bg-slate-950/60 text-xs">
          <div className="text-slate-400">
            Page <span className="font-semibold text-slate-200">{page + 1}</span>
            {totalPages !== undefined && <span> of {totalPages}</span>}
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
