import React, { useState, useEffect } from 'react'
import {
  Tag,
  Edit2,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  Sliders,
  Check,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { AuctionSegment, SegmentStrategy } from '../types/clustering'
import { CUT_STRATEGY_NAMES, HIKE_STRATEGY_NAMES } from '../types/clustering'
import { api } from '../api/client'

const SEGMENTS_PER_PAGE = 20

export const SegmentsView: React.FC = () => {
  // Paginated page of the segments list
  const [segments, setSegments] = useState<AuctionSegment[]>([])
  const [segmentsTotal, setSegmentsTotal] = useState<number | undefined>(undefined)
  const [segmentsPages, setSegmentsPages] = useState<number | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'id' | '-id' | 'name' | '-createdAt'>('-id')
  // Every segment, for the strategy form dropdown
  const [allSegments, setAllSegments] = useState<AuctionSegment[]>([])
  const [strategies, setStrategies] = useState<SegmentStrategy[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Rename Segment Modal
  const [renamingSegment, setRenamingSegment] = useState<AuctionSegment | null>(null)
  const [newName, setNewName] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  // Strategy Modal (Create / Edit)
  const [strategyModalOpen, setStrategyModalOpen] = useState(false)
  const [editingStrategy, setEditingStrategy] = useState<SegmentStrategy | null>(null)
  const [strategyForm, setStrategyForm] = useState({
    segmentId: 0,
    cutStrategy: CUT_STRATEGY_NAMES[0],
    hikeStrategy: HIKE_STRATEGY_NAMES[0],
    lastFreeChangeCutStrategy: CUT_STRATEGY_NAMES[0],
    lastFreeChangeHikeStrategy: HIKE_STRATEGY_NAMES[0],
    enabled: true,
    note: '',
  })
  const [strategyLoading, setStrategyLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [segPage, all, stratList] = await Promise.all([
        api.listSegments({ search: search || undefined, sort, page, 'per-page': SEGMENTS_PER_PAGE }),
        api.listAllSegments(),
        api.listSegmentStrategies(),
      ])
      setSegments(segPage.segments)
      setSegmentsTotal(segPage.totalCount)
      setSegmentsPages(segPage.totalPages)
      setAllSegments(all)
      setStrategies(stratList)
    } catch (err: any) {
      setError(err?.message || 'Failed to load segments or strategies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [page, search, sort])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0)
    setSearch(searchInput.trim())
  }

  // Handle Rename
  const handleStartRename = (seg: AuctionSegment) => {
    setRenamingSegment(seg)
    setNewName(seg.name || '')
  }

  const handleSubmitRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renamingSegment) return
    setRenameLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const updated = await api.updateSegment(renamingSegment.id, newName.trim())
      setSuccessMsg(`Segment #${updated.id} renamed to "${updated.name}".`)
      setRenamingSegment(null)
      await fetchData()
    } catch (err: any) {
      setError(err?.message || 'Failed to rename segment')
    } finally {
      setRenameLoading(false)
    }
  }

  // Handle Strategy Create / Edit
  const handleOpenCreateStrategy = () => {
    setEditingStrategy(null)
    // Pick first segment not yet mapped if possible
    const unmapped = allSegments.find((s) => !strategies.some((st) => st.segment.id === s.id))
    setStrategyForm({
      segmentId: unmapped ? unmapped.id : allSegments[0]?.id || 1,
      cutStrategy: CUT_STRATEGY_NAMES[0],
      hikeStrategy: HIKE_STRATEGY_NAMES[0],
      lastFreeChangeCutStrategy: CUT_STRATEGY_NAMES[0],
      lastFreeChangeHikeStrategy: HIKE_STRATEGY_NAMES[0],
      enabled: true,
      note: '',
    })
    setStrategyModalOpen(true)
  }

  const handleOpenEditStrategy = (strat: SegmentStrategy) => {
    setEditingStrategy(strat)
    setStrategyForm({
      segmentId: strat.segment.id,
      cutStrategy: strat.cutStrategy,
      hikeStrategy: strat.hikeStrategy,
      lastFreeChangeCutStrategy: strat.lastFreeChangeCutStrategy,
      lastFreeChangeHikeStrategy: strat.lastFreeChangeHikeStrategy,
      enabled: strat.enabled,
      note: strat.note || '',
    })
    setStrategyModalOpen(true)
  }

  const handleSubmitStrategy = async (e: React.FormEvent) => {
    e.preventDefault()
    setStrategyLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      if (editingStrategy) {
        await api.updateSegmentStrategy(editingStrategy.id, {
          cutStrategy: strategyForm.cutStrategy,
          hikeStrategy: strategyForm.hikeStrategy,
          lastFreeChangeCutStrategy: strategyForm.lastFreeChangeCutStrategy,
          lastFreeChangeHikeStrategy: strategyForm.lastFreeChangeHikeStrategy,
          enabled: strategyForm.enabled,
          note: strategyForm.note || undefined,
        })
        setSuccessMsg(`Strategy mapping #${editingStrategy.id} updated!`)
      } else {
        await api.createSegmentStrategy({
          segment: strategyForm.segmentId,
          cutStrategy: strategyForm.cutStrategy,
          hikeStrategy: strategyForm.hikeStrategy,
          lastFreeChangeCutStrategy: strategyForm.lastFreeChangeCutStrategy,
          lastFreeChangeHikeStrategy: strategyForm.lastFreeChangeHikeStrategy,
          enabled: strategyForm.enabled,
          note: strategyForm.note || undefined,
        })
        setSuccessMsg('New strategy mapping created successfully!')
      }
      setStrategyModalOpen(false)
      await fetchData()
    } catch (err: any) {
      setError(err?.message || 'Failed to save strategy mapping')
    } finally {
      setStrategyLoading(false)
    }
  }

  const handleDeleteStrategy = async (id: number) => {
    if (!window.confirm(`Delete strategy mapping #${id}? The segment itself will remain.`)) return
    setLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await api.deleteSegmentStrategy(id)
      setSuccessMsg(`Strategy mapping #${id} deleted.`)
      await fetchData()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete strategy')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-3 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-start space-x-3 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Top Section: Segments List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
              <Tag className="w-5 h-5 text-purple-400" />
              <span>Auction Segments</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Segments outlive retraining through inheritance. Renaming a segment updates its display name everywhere.
              Every training run creates new segments for groups it could not inherit, so most segments belong to
              candidate or retired clusters.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/80 font-mono">
              Total: {segmentsTotal !== undefined ? segmentsTotal : '…'}
            </span>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Search & sort */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 flex-1 min-w-[240px]">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name…"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium">
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setSearch('')
                  setPage(0)
                }}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                clear
              </button>
            )}
          </form>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Sort:</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort)
                setPage(0)
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="-id">Newest first</option>
              <option value="id">Oldest first</option>
              <option value="name">Name A→Z</option>
              <option value="-createdAt">Created (newest)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {segments.map((s) => (
            <div
              key={s.id}
              className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
            >
              <div>
                <div className="text-[11px] font-mono text-slate-500">Segment ID: #{s.id}</div>
                <div className="text-sm font-bold text-slate-200 mt-0.5">
                  {s.name ? s.name : <i className="text-slate-500 font-normal">Unnamed Segment</i>}
                </div>
              </div>
              <button
                onClick={() => handleStartRename(s)}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5 text-purple-400" />
                <span>Rename</span>
              </button>
            </div>
          ))}
          {segments.length === 0 && !loading && (
            <div className="md:col-span-3 px-4 py-8 text-center text-slate-500 text-xs">
              No segments{search ? ` matching "${search}"` : ''}.
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs">
          <div className="text-slate-400">
            Page <span className="font-semibold text-slate-200">{page + 1}</span>
            {segmentsPages !== undefined && <span> of {segmentsPages}</span>}
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
              disabled={(segmentsPages !== undefined && page + 1 >= segmentsPages) || loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Segment Strategies Mapping */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              <span>Segment Strategy Mappings (Task 15)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Configures cut and hike pricing strategies for each auction segment, plus the pair used on the last free price change of the day.
            </p>
          </div>
          <button
            onClick={handleOpenCreateStrategy}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Map New Segment</span>
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Mapping ID</th>
                <th className="px-4 py-3">Segment</th>
                <th className="px-4 py-3">Cut Strategy</th>
                <th className="px-4 py-3">Hike Strategy</th>
                <th className="px-4 py-3">Last Free Cut</th>
                <th className="px-4 py-3">Last Free Hike</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
              {strategies.map((st) => (
                <tr key={st.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium text-slate-400">#{st.id}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-slate-200">
                      {st.segment?.name || `Segment #${st.segment?.id}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-purple-300 font-medium">{st.cutStrategy}</td>
                  <td className="px-4 py-3 font-mono text-indigo-300 font-medium">{st.hikeStrategy}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{st.lastFreeChangeCutStrategy}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{st.lastFreeChangeHikeStrategy}</td>
                  <td className="px-4 py-3">
                    {st.enabled ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Enabled</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                        <span>Disabled</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 italic max-w-xs truncate">
                    {st.note || '—'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => handleOpenEditStrategy(st)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-purple-400" />
                    </button>
                    <button
                      onClick={() => handleDeleteStrategy(st.id)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-900/60 text-slate-200 hover:text-rose-200 text-xs font-medium"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    </button>
                  </td>
                </tr>
              ))}
              {strategies.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No strategy mappings configured yet. Click "Map New Segment" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rename Modal */}
      {renamingSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <h3 className="text-base font-bold text-slate-100">
                Rename Segment #{renamingSegment.id}
              </h3>
              <button
                onClick={() => setRenamingSegment(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitRename} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Segment Name (1–100 chars)
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. calm market, price war, daily sawtooth"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingSegment(null)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameLoading || !newName.trim()}
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 disabled:opacity-50"
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Strategy Create / Edit Modal */}
      {strategyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <h3 className="text-base font-bold text-slate-100">
                {editingStrategy ? `Edit Strategy Mapping #${editingStrategy.id}` : 'Map New Segment Strategy'}
              </h3>
              <button
                onClick={() => setStrategyModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitStrategy} className="p-6 space-y-4 text-xs">
              {/* Segment (immutable if editing) */}
              <div>
                <label className="block font-medium text-slate-300 mb-1">Target Segment</label>
                {editingStrategy ? (
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-semibold font-mono">
                    {editingStrategy.segment?.name || `Segment #${editingStrategy.segment?.id}`} (Immutable)
                  </div>
                ) : (
                  <select
                    value={strategyForm.segmentId}
                    onChange={(e) =>
                      setStrategyForm({ ...strategyForm, segmentId: parseInt(e.target.value, 10) })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    {allSegments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || `Segment #${s.id}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Standard Cut & Hike Strategies */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Cut Strategy</label>
                  <select
                    value={strategyForm.cutStrategy}
                    onChange={(e) => setStrategyForm({ ...strategyForm, cutStrategy: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                  >
                    {CUT_STRATEGY_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Hike Strategy</label>
                  <select
                    value={strategyForm.hikeStrategy}
                    onChange={(e) => setStrategyForm({ ...strategyForm, hikeStrategy: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                  >
                    {HIKE_STRATEGY_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Last Free Change Strategies */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Last Free Cut Strategy</label>
                  <select
                    value={strategyForm.lastFreeChangeCutStrategy}
                    onChange={(e) =>
                      setStrategyForm({ ...strategyForm, lastFreeChangeCutStrategy: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                  >
                    {CUT_STRATEGY_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Last Free Hike Strategy</label>
                  <select
                    value={strategyForm.lastFreeChangeHikeStrategy}
                    onChange={(e) =>
                      setStrategyForm({ ...strategyForm, lastFreeChangeHikeStrategy: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                  >
                    {HIKE_STRATEGY_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Enabled & Note */}
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="enabledCheck"
                  checked={strategyForm.enabled}
                  onChange={(e) => setStrategyForm({ ...strategyForm, enabled: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="enabledCheck" className="text-slate-300 font-medium cursor-pointer">
                  Strategy Mapping Enabled
                </label>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Note (Optional)</label>
                <input
                  type="text"
                  value={strategyForm.note}
                  onChange={(e) => setStrategyForm({ ...strategyForm, note: e.target.value })}
                  placeholder="e.g. Aggressive cuts for sawtooth competitor"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setStrategyModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={strategyLoading}
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-lg shadow-purple-600/30 disabled:opacity-50"
                >
                  Save Strategy Mapping
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
