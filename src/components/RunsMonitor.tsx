import React, { useState, useEffect } from 'react'
import {
  Activity,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ChevronRight,
  X,
} from 'lucide-react'
import type { ClusteringRun, RunType, RunMarking } from '../types/clustering'
import { api } from '../api/client'

export const RunsMonitor: React.FC = () => {
  const [runs, setRuns] = useState<ClusteringRun[]>([])
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [typeFilter, setTypeFilter] = useState<RunType | ''>('')
  const [markingFilter, setMarkingFilter] = useState<RunMarking | ''>('')
  const [clusterFilter, setClusterFilter] = useState<string>('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Selected Run Modal
  const [selectedRun, setSelectedRun] = useState<ClusteringRun | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchRuns = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listRuns({
        type: typeFilter || undefined,
        marking: markingFilter || undefined,
        cluster: clusterFilter ? parseInt(clusterFilter, 10) : undefined,
        sort: '-id',
        'per-page': 20,
      })
      setRuns(res.runs)
      setTotalCount(res.totalCount)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch clustering runs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRuns()
  }, [typeFilter, markingFilter, clusterFilter])

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      fetchRuns()
    }, 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, typeFilter, markingFilter, clusterFilter])

  const handleInspectRun = async (run: ClusteringRun) => {
    setSelectedRun(run)
    setDetailLoading(true)
    try {
      const full = await api.getRun(run.id)
      setSelectedRun(full)
    } catch (err: any) {
      console.error(err)
    } finally {
      setDetailLoading(false)
    }
  }

  const formatDuration = (start: string | null, finish: string | null) => {
    if (!start || !finish) return '—'
    const s = new Date(start).getTime()
    const f = new Date(finish).getTime()
    const diffSec = Math.round((f - s) / 1000)
    if (diffSec < 60) return `${diffSec}s`
    const m = Math.floor(diffSec / 60)
    const sec = diffSec % 60
    return `${m}m ${sec}s`
  }

  return (
    <div className="space-y-6">
      {/* Filters & Header Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-semibold text-slate-100">Pipeline Runs Monitor</h2>
            {totalCount !== undefined && (
              <span className="text-xs text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                {totalCount} total runs
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Auto refresh switch */}
            <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-purple-600 focus:ring-purple-500"
              />
              <span className="flex items-center space-x-1">
                <RefreshCw className={`w-3 h-3 ${autoRefresh && loading ? 'animate-spin' : ''}`} />
                <span>Auto-refresh (5s)</span>
              </span>
            </label>

            {/* Type Filter */}
            <div className="flex items-center space-x-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="">All Types</option>
                <option value="Training">Training</option>
                <option value="DailyAssignment">DailyAssignment</option>
                <option value="WeeklyUpdate">WeeklyUpdate</option>
              </select>
            </div>

            {/* Marking Filter */}
            <select
              value={markingFilter}
              onChange={(e) => setMarkingFilter(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="Running">Running</option>
              <option value="Pending">Pending</option>
              <option value="Failed">Failed</option>
            </select>

            {/* Cluster ID Filter */}
            <input
              type="number"
              min={1}
              placeholder="Cluster ID"
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />

            {/* Manual Refresh */}
            <button
              onClick={fetchRuns}
              disabled={loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
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

      {/* Runs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Run ID</th>
                <th className="px-4 py-3">Stage / Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Target Day</th>
                <th className="px-4 py-3">Cluster ID</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3 text-right">Summary & Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
              {runs.map((r) => {
                const typeBadge =
                  r.type === 'Training'
                    ? 'bg-purple-950/60 text-purple-300 border-purple-800'
                    : r.type === 'DailyAssignment'
                    ? 'bg-blue-950/60 text-blue-300 border-blue-800'
                    : 'bg-indigo-950/60 text-indigo-300 border-indigo-800'

                const statusBadge =
                  r.marking === 'Completed'
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                    : r.marking === 'Running'
                    ? 'bg-amber-950/60 text-amber-300 border-amber-800 animate-pulse'
                    : r.marking === 'Failed'
                    ? 'bg-rose-950/60 text-rose-300 border-rose-800'
                    : 'bg-slate-800 text-slate-400 border-slate-700'

                return (
                  <tr
                    key={r.id}
                    onClick={() => handleInspectRun(r)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-slate-300">#{r.id}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${typeBadge}`}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium border ${statusBadge}`}>
                        {r.marking === 'Completed' ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : r.marking === 'Failed' ? (
                          <XCircle className="w-3 h-3 text-rose-400" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        <span>{r.marking}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{r.day}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">
                      {r.cluster?.id ? `Cluster #${r.cluster.id}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {formatDuration(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleInspectRun(r)
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                      >
                        <FileText className="w-3 h-3 text-purple-400" />
                        <span>Inspect</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No runs found matching current filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Run Detail Modal */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-slate-100">
                  Run #{selectedRun.id} • {selectedRun.type}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                  Day: {selectedRun.day}
                </span>
              </div>
              <button
                onClick={() => setSelectedRun(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Status & Times */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-semibold text-slate-200">{selectedRun.marking}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Cluster</span>
                  <span className="font-semibold text-slate-200">
                    {selectedRun.cluster?.id ? `#${selectedRun.cluster.id}` : 'None'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Started</span>
                  <span className="font-semibold text-slate-200">
                    {selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleTimeString() : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Duration</span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {formatDuration(selectedRun.startedAt, selectedRun.finishedAt)}
                  </span>
                </div>
              </div>

              {/* Error Alert if Failed */}
              {selectedRun.error && (
                <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 space-y-1">
                  <span className="font-semibold block text-sm">Execution Error:</span>
                  <pre className="font-mono text-xs whitespace-pre-wrap">{selectedRun.error}</pre>
                </div>
              )}

              {/* Summary JSON Output */}
              <div>
                <span className="text-slate-400 font-semibold block mb-1.5 uppercase tracking-wider text-[11px]">
                  Run Summary Metrics
                </span>
                {detailLoading ? (
                  <div className="p-8 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    <span>Loading details...</span>
                  </div>
                ) : selectedRun.summary ? (
                  <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-purple-300 font-mono text-xs overflow-x-auto max-h-80">
                    {JSON.stringify(selectedRun.summary, null, 2)}
                  </pre>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-slate-500">
                    No summary data recorded for this run.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end px-6 py-3 border-t border-slate-800 bg-slate-950/60">
              <button
                onClick={() => setSelectedRun(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
