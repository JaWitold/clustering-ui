import React, { useState, useEffect, useMemo } from 'react'
import { GitCompareArrows, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react'
import type { Cluster, Centroid } from '../types/clustering'
import { FEATURE_GROUPS } from '../types/clustering'
import { api } from '../api/client'
import { PlotlyChart } from './PlotlyChart'

interface ClusterComparisonProps {
  /** Cluster cards (list endpoint) used to pick the counterpart. */
  clusters: Cluster[]
  /** Cluster selected at the top of the page (with centroids); always the "compare" side. */
  selected: Cluster
}

/**
 * The cluster the promoted one replaced: promoting retires the previously promoted cluster, so the
 * parent is the most recently retired cluster that had itself been promoted. (promotedAt is not
 * used: it may be backdated to the training day.)
 */
function findParent(promoted: Cluster, clusters: Cluster[]): Cluster | null {
  const retired = clusters
    .filter((c) => c.id !== promoted.id && c.marking === 'Retired' && c.retiredAt && c.promotedAt)
    .sort((a, b) => new Date(b.retiredAt!).getTime() - new Date(a.retiredAt!).getTime())
  return retired[0] ?? null
}

/**
 * Default counterpart of the selected cluster: a promoted cluster is compared with the cluster it
 * replaced, anything else (candidate, retired) with the currently promoted cluster.
 */
function findCounterpart(selected: Cluster, clusters: Cluster[]): { cluster: Cluster; reason: string } | null {
  if (selected.marking === 'Promoted') {
    const parent = findParent(selected, clusters)
    return parent ? { cluster: parent, reason: 'its parent (the cluster it replaced)' } : null
  }
  const promoted = clusters.find((c) => c.marking === 'Promoted' && c.id !== selected.id)
  if (promoted) {
    return { cluster: promoted, reason: 'the currently promoted cluster' }
  }
  return null
}

const euclid = (a: number[], b: number[]) => {
  let s = 0
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    s += d * d
  }
  return Math.sqrt(s)
}

const segmentLabel = (c: Centroid) => c.segment?.name || `Segment #${c.segment?.id}`

export const ClusterComparison: React.FC<ClusterComparisonProps> = ({ clusters, selected }) => {
  const auto = useMemo(() => findCounterpart(selected, clusters), [selected, clusters])
  // Manual override of the counterpart, keyed by the selected cluster so it resets on re-selection
  const [override, setOverride] = useState<{ forId: number; baseId: number } | null>(null)
  const baseId = override && override.forId === selected.id ? override.baseId : auto?.cluster.id ?? null
  const isAuto = baseId !== null && baseId === auto?.cluster.id

  const [baseResult, setBaseResult] = useState<{ id: number; cluster: Cluster } | null>(null)
  const base = baseResult && baseResult.id === baseId ? baseResult.cluster : null
  const compare = selected
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [space, setSpace] = useState<'scaled' | 'source'>('scaled')

  useEffect(() => {
    if (baseId === null) return
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const cluster = await api.getCluster(baseId)
        if (cancelled) return
        setBaseResult({ id: baseId, cluster })
        setError(null)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load cluster for comparison')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [baseId])

  const diff = useMemo(() => {
    if (!base || !compare) return null
    const featureNames = compare.featureNames?.length ? compare.featureNames : base.featureNames || Object.keys(FEATURE_GROUPS)
    const baseBySeg = new Map<number, Centroid>()
    ;(base.centroids || []).forEach((c) => c.segment?.id !== undefined && baseBySeg.set(c.segment.id, c))
    const compBySeg = new Map<number, Centroid>()
    ;(compare.centroids || []).forEach((c) => c.segment?.id !== undefined && compBySeg.set(c.segment.id, c))

    type Pair = { segmentId: number; a: Centroid; b: Centroid; shift: number; sizeDelta: number; how: 'inherited' | 'nearest' }
    const shared: Pair[] = []
    const unmatchedBase: Centroid[] = []
    const unmatchedComp: Centroid[] = []
    // Tier 1: same segment id (inherited)
    baseBySeg.forEach((a, segId) => {
      const b = compBySeg.get(segId)
      if (b) shared.push({ segmentId: segId, a, b, shift: euclid(a.scaled, b.scaled), sizeDelta: b.size - a.size, how: 'inherited' })
      else unmatchedBase.push(a)
    })
    compBySeg.forEach((b, segId) => {
      if (!baseBySeg.has(segId)) unmatchedComp.push(b)
    })
    // Tier 2: greedy nearest-centroid pairing of the leftovers (closest pair first)
    const candidates: { a: Centroid; b: Centroid; d: number }[] = []
    unmatchedBase.forEach((a) => unmatchedComp.forEach((b) => candidates.push({ a, b, d: euclid(a.scaled, b.scaled) })))
    candidates.sort((x, y) => x.d - y.d)
    const usedA = new Set<number>()
    const usedB = new Set<number>()
    candidates.forEach(({ a, b, d }) => {
      if (usedA.has(a.id) || usedB.has(b.id)) return
      usedA.add(a.id)
      usedB.add(b.id)
      shared.push({ segmentId: b.segment.id, a, b, shift: d, sizeDelta: b.size - a.size, how: 'nearest' })
    })
    const dropped = unmatchedBase.filter((a) => !usedA.has(a.id))
    const added = unmatchedComp.filter((b) => !usedB.has(b.id))
    shared.sort((x, y) => (x.how === y.how ? y.shift - x.shift : x.how === 'inherited' ? -1 : 1))

    const pick = (c: Centroid) => (space === 'scaled' ? c.scaled : c.source)
    const z = shared.map(({ a, b }) => featureNames.map((_, i) => (pick(b)[i] ?? 0) - (pick(a)[i] ?? 0)))
    const custom = shared.map(({ a, b }) => featureNames.map((_, i) => [pick(a)[i] ?? 0, pick(b)[i] ?? 0]))
    const maxAbs = z.reduce((m, row) => Math.max(m, ...row.map(Math.abs)), 0) || 1

    return { featureNames, shared, dropped, added, z, custom, maxAbs }
  }, [base, compare, space])

  const { plotData, plotLayout } = useMemo(() => {
    if (!diff || !base || !compare || diff.shared.length === 0) return { plotData: [], plotLayout: {} }
    const xLabels = diff.featureNames.map((fn) => FEATURE_GROUPS[fn]?.label || fn)
    const yLabels = diff.shared.map(({ a, b, how }) =>
      how === 'inherited' ? segmentLabel(b) : `${segmentLabel(b)} ≈ ${segmentLabel(a)}`,
    )
    const unit = space === 'scaled' ? 'scaled' : 'source units'
    return {
      plotData: [
        {
          type: 'heatmap',
          x: xLabels,
          y: yLabels,
          z: diff.z,
          customdata: diff.custom,
          zmin: -diff.maxAbs,
          zmax: diff.maxAbs,
          zmid: 0,
          colorscale: [
            [0, '#3b82f6'],
            [0.5, '#0f172a'],
            [1, '#f59e0b'],
          ],
          colorbar: {
            title: { text: `Δ (${unit})`, font: { color: '#94a3b8', size: 11 } },
            tickfont: { color: '#94a3b8', size: 10 },
            thickness: 12,
            len: 0.8,
          },
          xgap: 2,
          ygap: 2,
          hovertemplate:
            `<b>%{y}</b> · %{x}<br>` +
            `#${base.id}: %{customdata[0]:.4f}<br>` +
            `#${compare.id}: %{customdata[1]:.4f}<br>` +
            `Δ: <b>%{z:+.4f}</b><extra></extra>`,
        },
      ],
      plotLayout: {
        title: {
          text: `Centroid shift per feature: #${compare.id} − #${base.id} (${unit})`,
          font: { color: '#f8fafc', size: 15 },
        },
        xaxis: { tickangle: -40, tickfont: { size: 10 }, automargin: true },
        yaxis: { automargin: true, tickfont: { size: 11 } },
        margin: { l: 60, r: 20, t: 50, b: 110 },
      },
    }
  }, [diff, base, compare, space])

  const clusterOption = (c: Cluster) =>
    `#${c.id} · ${c.marking} · k=${c.segmentCount} · ${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}`

  const inertiaDelta = base && compare && base.inertia !== null && compare.inertia !== null ? compare.inertia - base.inertia : null

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
          <GitCompareArrows className="w-5 h-5 text-purple-400" />
          <span>Cluster #{selected.id} Comparison</span>
          <span className="text-xs font-normal text-slate-400">
            {auto
              ? `${selected.marking} cluster vs ${auto.reason}`
              : selected.marking === 'Promoted'
              ? 'no retired cluster to compare with'
              : 'no promoted cluster to compare with'}
          </span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Centroids of the selected cluster against its counterpart, segment by segment (Δ = selected − counterpart).
          Segments are matched by id first (inherited); the rest are paired greedily with the nearest counterpart
          centroid (shown as "A ≈ B"). Leftovers are listed as new or dropped.
        </p>
      </div>

      {/* Counterpart selector */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-300 font-semibold font-mono">#{selected.id}</span>
          <span className="text-xs text-slate-500">({selected.marking})</span>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-500" />
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-400 font-medium">vs</span>
          <select
            value={baseId ?? ''}
            onChange={(e) => setOverride(e.target.value ? { forId: selected.id, baseId: parseInt(e.target.value, 10) } : null)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
          >
            <option value="">— pick a cluster —</option>
            {clusters
              .filter((c) => c.id !== selected.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {clusterOption(c)}
                  {auto?.cluster.id === c.id ? ' (auto)' : ''}
                </option>
              ))}
          </select>
          {!isAuto && auto && (
            <button
              onClick={() => setOverride(null)}
              className="text-[11px] text-purple-400 hover:underline"
              title={`Back to ${auto.reason}: #${auto.cluster.id}`}
            >
              reset
            </button>
          )}
        </div>
        <div className="flex items-center space-x-2 border-l border-slate-800 pl-3">
          <button
            onClick={() => setSpace(space === 'scaled' ? 'source' : 'scaled')}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              space === 'source'
                ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-300'
            }`}
          >
            {space === 'source' ? 'Source Units' : 'Scaled [-3, 3]'}
          </button>
        </div>
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-2 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {base && compare && diff && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div className="text-slate-500">Segments (k)</div>
              <div className="font-mono text-slate-200 font-semibold">
                {base.segmentCount} → {compare.segmentCount}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div className="text-slate-500">Inertia</div>
              <div className="font-mono text-slate-200 font-semibold">
                {base.inertia?.toFixed(2) ?? '—'} → {compare.inertia?.toFixed(2) ?? '—'}
                {inertiaDelta !== null && (
                  <span className={`ml-2 ${inertiaDelta < 0 ? 'text-emerald-400' : inertiaDelta > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {inertiaDelta > 0 ? '+' : ''}
                    {inertiaDelta.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div className="text-slate-500">Inherited / Nearest / New / Dropped</div>
              <div className="font-mono font-semibold">
                <span className="text-purple-300">{diff.shared.filter((p) => p.how === 'inherited').length}</span>
                <span className="text-slate-600"> / </span>
                <span className="text-cyan-300">{diff.shared.filter((p) => p.how === 'nearest').length}</span>
                <span className="text-slate-600"> / </span>
                <span className="text-amber-300">{diff.added.length}</span>
                <span className="text-slate-600"> / </span>
                <span className="text-rose-300">{diff.dropped.length}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div className="text-slate-500">Vector version</div>
              <div className="font-mono text-slate-200 font-semibold truncate">
                {base.vectorVersion === compare.vectorVersion ? (
                  <span className="text-emerald-400">same</span>
                ) : (
                  <span className="text-amber-400">differs</span>
                )}
              </div>
            </div>
          </div>

          {/* Heatmap */}
          {diff.shared.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950 p-2">
              <PlotlyChart data={plotData} layout={plotLayout} className="w-full min-h-[320px]" />
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400">
              No segments could be paired between #{base.id} and #{compare.id}: nothing to put on the heatmap.
            </div>
          )}

          {/* Segment table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
              <thead className="bg-slate-950/70 text-slate-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">Segment</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Auctions</th>
                  <th className="px-4 py-2.5">Centroid shift (scaled)</th>
                  <th className="px-4 py-2.5">Largest feature moves</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                {diff.shared.map(({ segmentId, a, b, shift, sizeDelta, how }, row) => {
                  const top = diff.featureNames
                    .map((fn, i) => ({ fn, d: diff.z[row][i] }))
                    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
                    .slice(0, 3)
                  return (
                    <tr key={segmentId} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-semibold text-slate-200">
                        {segmentLabel(b)} <span className="text-slate-500 font-mono text-[11px]">(#{segmentId})</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {how === 'inherited' ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-purple-950/60 text-purple-300 border border-purple-800">
                            Inherited
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-950/60 text-cyan-300 border border-cyan-800"
                            title={`Paired with the nearest centroid of #${base.id}: ${segmentLabel(a)} (#${a.segment?.id})`}
                          >
                            Nearest ≈ {segmentLabel(a)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">
                        {a.size} → {b.size}
                        <span className={`ml-1.5 ${sizeDelta > 0 ? 'text-emerald-400' : sizeDelta < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                          ({sizeDelta > 0 ? '+' : ''}
                          {sizeDelta})
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        <span className={shift > 0.5 ? 'text-rose-400' : shift > 0.1 ? 'text-amber-400' : 'text-emerald-400'}>
                          {shift.toFixed(4)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                        {top.map(({ fn, d }) => (
                          <span key={fn} className="inline-block mr-3">
                            {FEATURE_GROUPS[fn]?.label || fn}{' '}
                            <span className={d > 0 ? 'text-amber-300' : 'text-blue-300'}>
                              {d > 0 ? '+' : ''}
                              {d.toFixed(3)}
                            </span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  )
                })}
                {diff.added.map((b) => (
                  <tr key={`added-${b.segment?.id}`} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      {segmentLabel(b)} <span className="text-slate-500 font-mono text-[11px]">(#{b.segment?.id})</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800">
                        New in #{compare.id}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">— → {b.size}</td>
                    <td className="px-4 py-2.5 text-slate-600">—</td>
                    <td className="px-4 py-2.5 text-slate-600">—</td>
                  </tr>
                ))}
                {diff.dropped.map((a) => (
                  <tr key={`dropped-${a.segment?.id}`} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      {segmentLabel(a)} <span className="text-slate-500 font-mono text-[11px]">(#{a.segment?.id})</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/60 text-rose-300 border border-rose-800">
                        Dropped from #{base.id}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{a.size} → —</td>
                    <td className="px-4 py-2.5 text-slate-600">—</td>
                    <td className="px-4 py-2.5 text-slate-600">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
