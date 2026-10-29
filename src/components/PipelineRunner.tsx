import React, { useState } from 'react'
import {
  Play,
  Layers,
  Cpu,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  GitBranch,
  Move,
} from 'lucide-react'
import { api } from '../api/client'

interface PipelineRunnerProps {
  onNavigateToRuns: () => void
}

type TriggerResult = { success: boolean; msg: string } | null

interface DayTriggerCardProps {
  stageLabel: string
  endpointLabel: string
  title: string
  description: string
  notes: string[]
  buttonLabel: string
  icon: React.ReactNode
  /** Tailwind color family used for the badge and button, e.g. "emerald". */
  color: 'emerald' | 'amber'
  day: string
  onDayChange: (day: string) => void
  onPresetYesterday: () => void
  loading: boolean
  result: TriggerResult
  onSubmit: (e: React.FormEvent) => void
}

const CARD_COLORS = {
  emerald: {
    badge: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    button: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20',
  },
  amber: {
    badge: 'bg-amber-950 text-amber-400 border-amber-800',
    button: 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20',
  },
} as const

/** A single-day trigger card (stages that only take a `day`). */
const DayTriggerCard: React.FC<DayTriggerCardProps> = ({
  stageLabel,
  endpointLabel,
  title,
  description,
  notes,
  buttonLabel,
  icon,
  color,
  day,
  onDayChange,
  onPresetYesterday,
  loading,
  result,
  onSubmit,
}) => {
  const colors = CARD_COLORS[color]
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors.badge}`}>
            {stageLabel}
          </span>
          <code className="text-[11px] text-slate-500 font-mono">{endpointLabel}</code>
        </div>

        <h3 className="text-base font-bold text-slate-100 mb-1">{title}</h3>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">{description}</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Target Day</label>
            <input
              type="date"
              required
              value={day}
              onChange={(e) => onDayChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          <div className="flex items-center space-x-1.5 pt-1">
            <span className="text-[11px] text-slate-500">Preset:</span>
            <button type="button" onClick={onPresetYesterday} className="text-[11px] text-purple-400 hover:underline">
              Yesterday
            </button>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            {notes.map((n) => (
              <div key={n}>• {n}</div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl text-white text-xs font-semibold transition-all shadow-lg disabled:opacity-50 ${colors.button}`}
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : icon}
            <span>{buttonLabel}</span>
          </button>
        </form>
      </div>

      {result && (
        <div
          className={`mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
            result.success
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <span>{result.msg}</span>
        </div>
      )}
    </div>
  )
}

export const PipelineRunner: React.FC<PipelineRunnerProps> = ({ onNavigateToRuns }) => {
  // Helper to format date YYYY-MM-DD
  const formatDate = (d: Date) => d.toISOString().split('T')[0]
  const yesterday = () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return formatDate(d)
  }
  const daysAgo = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return formatDate(d)
  }

  // Stage 1: Measure
  const [measureFrom, setMeasureFrom] = useState(daysAgo(7))
  const [measureTo, setMeasureTo] = useState(yesterday())
  const [measureLoading, setMeasureLoading] = useState(false)
  const [measureResult, setMeasureResult] = useState<{ success: boolean; msg: string } | null>(null)

  // Stage 2: Vectorize
  const [vectorizeDay, setVectorizeDay] = useState(yesterday())
  const [vectorizeLoading, setVectorizeLoading] = useState(false)
  const [vectorizeResult, setVectorizeResult] = useState<{ success: boolean; msg: string } | null>(null)

  // Stage 3: Train
  const [trainDay, setTrainDay] = useState(yesterday())
  const [minSegments, setMinSegments] = useState(3)
  const [maxSegments, setMaxSegments] = useState(6)
  const [iterations, setIterations] = useState(50)
  const [restarts, setRestarts] = useState(5)
  const [trainLoading, setTrainLoading] = useState(false)
  const [trainResult, setTrainResult] = useState<{ success: boolean; msg: string } | null>(null)

  // Stage 4: Assign segments (daily)
  const [assignDay, setAssignDay] = useState(yesterday())
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignResult, setAssignResult] = useState<TriggerResult>(null)

  // Stage 5: Update centroids (weekly)
  const [updateDay, setUpdateDay] = useState(yesterday())
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateResult, setUpdateResult] = useState<TriggerResult>(null)

  const handleMeasure = async (e: React.FormEvent) => {
    e.preventDefault()
    setMeasureLoading(true)
    setMeasureResult(null)
    try {
      await api.measureMarketDays({ from: measureFrom, to: measureTo })
      setMeasureResult({
        success: true,
        msg: `Measure job queued for range ${measureFrom} to ${measureTo} (202 Accepted). Check Runs Monitor for progress!`,
      })
    } catch (err: any) {
      setMeasureResult({
        success: false,
        msg: err?.message || 'Failed to trigger measure endpoint',
      })
    } finally {
      setMeasureLoading(false)
    }
  }

  const handleVectorize = async (e: React.FormEvent) => {
    e.preventDefault()
    setVectorizeLoading(true)
    setVectorizeResult(null)
    try {
      await api.vectorizeAuctionFeatures({ day: vectorizeDay })
      setVectorizeResult({
        success: true,
        msg: `Vectorize job queued for day ${vectorizeDay} (202 Accepted). Check Runs Monitor for progress!`,
      })
    } catch (err: any) {
      setVectorizeResult({
        success: false,
        msg: err?.message || 'Failed to trigger vectorize endpoint',
      })
    } finally {
      setVectorizeLoading(false)
    }
  }

  const handleTrain = async (e: React.FormEvent) => {
    e.preventDefault()
    setTrainLoading(true)
    setTrainResult(null)
    try {
      await api.trainClusters({
        day: trainDay,
        minSegments,
        maxSegments,
        iterations,
        restarts,
      })
      setTrainResult({
        success: true,
        msg: `Training job queued for day ${trainDay} with k in [${minSegments}..${maxSegments}] (202 Accepted). Newly trained clusters will appear under Candidates!`,
      })
    } catch (err: any) {
      setTrainResult({
        success: false,
        msg: err?.message || 'Failed to trigger training endpoint',
      })
    } finally {
      setTrainLoading(false)
    }
  }

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    setAssignLoading(true)
    setAssignResult(null)
    try {
      await api.assignAuctionSegments({ day: assignDay })
      setAssignResult({
        success: true,
        msg: `Segment assignment queued for day ${assignDay} (202 Accepted). Look for a DailyAssignment run in Runs Monitor!`,
      })
    } catch (err: any) {
      setAssignResult({
        success: false,
        msg: err?.message || 'Failed to trigger segment assignment endpoint',
      })
    } finally {
      setAssignLoading(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setUpdateLoading(true)
    setUpdateResult(null)
    try {
      await api.updateClusterCentroids({ day: updateDay })
      setUpdateResult({
        success: true,
        msg: `Centroid update queued for the window ending ${updateDay} (202 Accepted). Look for a WeeklyUpdate run in Runs Monitor!`,
      })
    } catch (err: any) {
      setUpdateResult({
        success: false,
        msg: err?.message || 'Failed to trigger centroid update endpoint',
      })
    } finally {
      setUpdateLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <Play className="w-5 h-5 text-purple-400" />
              <span>Pipeline Workflows & Triggers</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Trigger asynchronous background tasks through the price engine clustering API endpoints.
              Each trigger dispatches a deduplicated message on the worker queue.
            </p>
          </div>
          <button
            onClick={onNavigateToRuns}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 text-xs font-semibold transition-all self-start md:self-auto"
          >
            <span>Open Runs Monitor</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid of 3 Stage Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage 1: Measure Market Days */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950 text-blue-400 border border-blue-800">
                Stage 1 • Measure
              </span>
              <code className="text-[11px] text-slate-500 font-mono">POST /market-days</code>
            </div>

            <h3 className="text-base font-bold text-slate-100 mb-1">Measure Market Days</h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              Replays parser offer history hour by hour to compute daily market metrics (best prices, top competitor activity, standings).
            </p>

            <form onSubmit={handleMeasure} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">From Date</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={measureFrom}
                    onChange={(e) => setMeasureFrom(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">To Date</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={measureTo}
                    onChange={(e) => setMeasureTo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center space-x-1.5 pt-1">
                <span className="text-[11px] text-slate-500">Presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    setMeasureFrom(yesterday())
                    setMeasureTo(yesterday())
                  }}
                  className="text-[11px] text-purple-400 hover:underline"
                >
                  Yesterday
                </button>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={() => {
                    setMeasureFrom(daysAgo(7))
                    setMeasureTo(yesterday())
                  }}
                  className="text-[11px] text-purple-400 hover:underline"
                >
                  Last 7d
                </button>
              </div>

              <button
                type="submit"
                disabled={measureLoading}
                className="w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
              >
                {measureLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>Dispatch Measure Job</span>
              </button>
            </form>
          </div>

          {measureResult && (
            <div
              className={`mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                measureResult.success
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800 text-rose-300'
              }`}
            >
              {measureResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{measureResult.msg}</span>
            </div>
          )}
        </div>

        {/* Stage 2: Vectorize Features */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800">
                Stage 2 • Vectorize
              </span>
              <code className="text-[11px] text-slate-500 font-mono">POST /feature-vectors</code>
            </div>

            <h3 className="text-base font-bold text-slate-100 mb-1">Vectorize Features</h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              Aggregates the past 14 market days of each product into 19 numerical features per our offer and writes documents to OpenSearch.
            </p>

            <form onSubmit={handleVectorize} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Target Day</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={vectorizeDay}
                    onChange={(e) => setVectorizeDay(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-1.5 pt-1">
                <span className="text-[11px] text-slate-500">Preset:</span>
                <button
                  type="button"
                  onClick={() => setVectorizeDay(yesterday())}
                  className="text-[11px] text-purple-400 hover:underline"
                >
                  Yesterday
                </button>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div>• Requires usable days ≥ 7 in feature window</div>
                <div>• Writes 19D vectors + vector version hash</div>
              </div>

              <button
                type="submit"
                disabled={vectorizeLoading}
                className="w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {vectorizeLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cpu className="w-3.5 h-3.5" />
                )}
                <span>Dispatch Vectorize Job</span>
              </button>
            </form>
          </div>

          {vectorizeResult && (
            <div
              className={`mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                vectorizeResult.success
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800 text-rose-300'
              }`}
            >
              {vectorizeResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{vectorizeResult.msg}</span>
            </div>
          )}
        </div>

        {/* Stage 3: Train Clusters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-400 border border-purple-800">
                Stage 3 • Training
              </span>
              <code className="text-[11px] text-slate-500 font-mono">POST /clusters</code>
            </div>

            <h3 className="text-base font-bold text-slate-100 mb-1">Train Auction Clusters</h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              Fits robust IQR scaler, trains k-means models via ML Commons across k range with restarts, matches inherited segments.
            </p>

            <form onSubmit={handleTrain} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Training Day</label>
                <input
                  type="date"
                  required
                  value={trainDay}
                  onChange={(e) => setTrainDay(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Min Segments</label>
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={minSegments}
                    onChange={(e) => setMinSegments(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Max Segments</label>
                  <input
                    type="number"
                    min={minSegments}
                    max={16}
                    value={maxSegments}
                    onChange={(e) => setMaxSegments(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Iterations</label>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={iterations}
                    onChange={(e) => setIterations(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Restarts</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={restarts}
                    onChange={(e) => setRestarts(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={trainLoading}
                className="w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50"
              >
                {trainLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Layers className="w-3.5 h-3.5" />
                )}
                <span>Dispatch Training Job</span>
              </button>
            </form>
          </div>

          {trainResult && (
            <div
              className={`mt-4 p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                trainResult.success
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800 text-rose-300'
              }`}
            >
              {trainResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{trainResult.msg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Operate the promoted cluster: on-demand reruns of the scheduled jobs */}
      <div className="flex items-center space-x-3 pt-2">
        <h3 className="text-sm font-semibold text-slate-200">Promoted Cluster Operations</h3>
        <span className="text-xs text-slate-500">
          Reruns or backfills of the scheduled jobs. Each day is queued at most once while still queued or running.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DayTriggerCard
          stageLabel="Stage 4 • Assign"
          endpointLabel="POST /segment-assignments"
          title="Assign Segments (Daily)"
          description="Moves every vectorized auction of the day to the nearest segment of the promoted cluster, through the hysteresis that keeps an auction in its segment until another has been nearest long enough."
          notes={[
            'Requires a Promoted cluster and feature vectors for the day',
            'Day must be finished (before today), Y-m-d',
            'Creates a DailyAssignment run',
          ]}
          buttonLabel="Dispatch Assignment Job"
          icon={<GitBranch className="w-3.5 h-3.5" />}
          color="emerald"
          day={assignDay}
          onDayChange={setAssignDay}
          onPresetYesterday={() => setAssignDay(yesterday())}
          loading={assignLoading}
          result={assignResult}
          onSubmit={handleAssign}
        />

        <DayTriggerCard
          stageLabel="Stage 5 • Update"
          endpointLabel="POST /centroid-updates"
          title="Update Centroids (Weekly)"
          description="Moves each centroid of the promoted cluster toward the mean of its auctions over the window ending on the day, bounded by the step and drift limits from its anchor."
          notes={[
            'Window overlapping a previous update is skipped',
            'Day must be finished (before today), Y-m-d',
            'Creates a WeeklyUpdate run; drift visible in Clusters & 2D Viz',
          ]}
          buttonLabel="Dispatch Centroid Update Job"
          icon={<Move className="w-3.5 h-3.5" />}
          color="amber"
          day={updateDay}
          onDayChange={setUpdateDay}
          onPresetYesterday={() => setUpdateDay(yesterday())}
          loading={updateLoading}
          result={updateResult}
          onSubmit={handleUpdate}
        />
      </div>
    </div>
  )
}
