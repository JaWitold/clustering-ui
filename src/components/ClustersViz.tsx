import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Sparkles,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Archive,
  Layers,
  ChevronRight,
  SlidersHorizontal,
  ListOrdered,
} from 'lucide-react'
import type { Cluster, Centroid, ClusterAssignment } from '../types/clustering'
import { FEATURE_GROUPS } from '../types/clustering'
import { api } from '../api/client'
import { computePCA } from '../utils/pca'
import { PlotlyChart } from './PlotlyChart'
import { SegmentAuctionsModal } from './SegmentAuctionsModal'
import { ClusterComparison } from './ClusterComparison'

const SEGMENT_COLORS = [
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#3b82f6', // blue
  '#f43f5e', // rose
  '#84cc16', // lime
]

const OFFER_PAGE_SIZE = 100 // API caps per-page at 100
const OFFER_MAX_PAGES = 5 // 500 offers max on the canvas
const OFFER_RADIUS_SCALE = 0.3 // max offer radius as a fraction of the centroid spread on the canvas
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Places offers around their segment's centroid: radius grows with the 19D centroid
 * distance (normalized to the farthest offer, scaled to the centroid spread on the canvas),
 * angle follows the golden angle so dots spread evenly and deterministically.
 * Positions are approximate – the true 19D feature vector is not exposed by the API.
 */
function placeOffersAroundCentroids(
  offers: ClusterAssignment[],
  centroidXY: Map<number, { x: number; y: number }>,
): Map<number, { xs: number[]; ys: number[]; offers: ClusterAssignment[] }> {
  const bySegment = new Map<number, { xs: number[]; ys: number[]; offers: ClusterAssignment[] }>()
  const xs = [...centroidXY.values()].map((p) => p.x)
  const ys = [...centroidXY.values()].map((p) => p.y)
  const spread = Math.max(
    xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
  )
  const extent = spread > 1e-9 ? spread : 1
  const maxDistance = offers.reduce((m, a) => Math.max(m, a.distance ?? 0), 0) || 1
  const maxRadius = extent * OFFER_RADIUS_SCALE
  offers.forEach((a) => {
    const segId = a.segment?.id
    const center = segId !== undefined ? centroidXY.get(segId) : undefined
    if (!center) return
    let bucket = bySegment.get(segId)
    if (!bucket) {
      bucket = { xs: [], ys: [], offers: [] }
      bySegment.set(segId, bucket)
    }
    const i = bucket.offers.length
    const r = Math.max(maxRadius * 0.08, ((a.distance ?? 0) / maxDistance) * maxRadius)
    const theta = i * GOLDEN_ANGLE
    bucket.xs.push(center.x + r * Math.cos(theta))
    bucket.ys.push(center.y + r * Math.sin(theta))
    bucket.offers.push(a)
  })
  return bySegment
}

interface ClustersVizProps {
  /** Navigate to the Assignments tab with the given offer id pre-searched. */
  onOpenOfferAssignments?: (offerId: string) => void
}

export const ClustersViz: React.FC<ClustersVizProps> = ({ onOpenOfferAssignments }) => {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null)
  const [selectedClusterDetail, setSelectedClusterDetail] = useState<Cluster | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Viz controls
  const [vizMode, setVizMode] = useState<'scatter' | 'pca'>('scatter')
  const [xAxisFeature, setXAxisFeature] = useState<string>('priceLevel')
  const [yAxisFeature, setYAxisFeature] = useState<string>('gapToBest')
  const [useSourceUnits, setUseSourceUnits] = useState(false)
  const [showDriftVectors, setShowDriftVectors] = useState(true)
  const [scaleBubbleSize, setScaleBubbleSize] = useState(true)
  const [showOffers, setShowOffers] = useState(false)

  // Offers (cluster assignments) overlay
  const [offersResult, setOffersResult] = useState<{
    clusterId: number
    offers: ClusterAssignment[]
    total: number | undefined
  } | null>(null)
  const [offersLoading, setOffersLoading] = useState(false)
  // Only offers fetched for the currently selected cluster are rendered
  const offers = useMemo(
    () => (offersResult && offersResult.clusterId === selectedClusterId ? offersResult.offers : []),
    [offersResult, selectedClusterId],
  )
  const offersTotal = offersResult?.clusterId === selectedClusterId ? offersResult.total : undefined

  // Drawer / Inspection
  const [inspectedCentroid, setInspectedCentroid] = useState<Centroid | null>(null)
  const [auctionsCentroid, setAuctionsCentroid] = useState<{ centroid: Centroid; color: string } | null>(null)

  // Load cluster list
  const loadClusters = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listClusters()
      setClusters(list)
      if (list.length > 0) {
        // default select Promoted cluster if available, else first
        const promoted = list.find((c) => c.marking === 'Promoted')
        const initialId = promoted ? promoted.id : list[0].id
        setSelectedClusterId((prev) => (prev ? prev : initialId))
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load clusters')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClusters()
  }, [])

  // Load cluster detail when selectedClusterId changes
  useEffect(() => {
    if (!selectedClusterId) return
    const fetchDetail = async () => {
      setLoading(true)
      try {
        const detail = await api.getCluster(selectedClusterId)
        setSelectedClusterDetail(detail)
      } catch (err: any) {
        setError(err?.message || 'Failed to fetch cluster detail')
      } finally {
        setLoading(false)
      }
    }
    fetchDetail()
  }, [selectedClusterId])

  // Load offers (assignments) for the overlay when enabled
  useEffect(() => {
    if (!showOffers || !selectedClusterId) return
    const clusterId = selectedClusterId
    let cancelled = false
    const fetchOffers = async () => {
      try {
        const collected: ClusterAssignment[] = []
        let total: number | undefined
        for (let page = 0; page < OFFER_MAX_PAGES; page++) {
          if (page === 0) setOffersLoading(true)
          const res = await api.listAssignments({
            cluster: clusterId,
            page,
            'per-page': OFFER_PAGE_SIZE,
          })
          if (cancelled) return
          collected.push(...res.assignments)
          total = res.totalCount
          const lastPage = res.totalPages !== undefined ? page + 1 >= res.totalPages : res.assignments.length < OFFER_PAGE_SIZE
          if (lastPage) break
        }
        setOffersResult({ clusterId, offers: collected, total: total ?? collected.length })
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load offers for cluster')
      } finally {
        if (!cancelled) setOffersLoading(false)
      }
    }
    fetchOffers()
    return () => {
      cancelled = true
    }
  }, [showOffers, selectedClusterId])

  // Handle Promote
  const handlePromote = async (id: number) => {
    if (!window.confirm(`Are you sure you want to PROMOTE Cluster #${id} into force? This will retire any currently promoted cluster.`)) {
      return
    }
    setActionLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const updated = await api.transitionCluster(id, 'Promote')
      setSuccessMsg(`Cluster #${id} successfully Promoted!`)
      setSelectedClusterDetail(updated)
      await loadClusters()
    } catch (err: any) {
      setError(err?.message || 'Failed to promote cluster')
    } finally {
      setActionLoading(false)
    }
  }

  // Handle Retire
  const handleRetire = async (id: number) => {
    if (!window.confirm(`Are you sure you want to RETIRE Cluster #${id}?`)) {
      return
    }
    setActionLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const updated = await api.transitionCluster(id, 'Retire')
      setSuccessMsg(`Cluster #${id} successfully Retired.`)
      setSelectedClusterDetail(updated)
      await loadClusters()
    } catch (err: any) {
      setError(err?.message || 'Failed to retire cluster')
    } finally {
      setActionLoading(false)
    }
  }

  // Feature names list
  const featureNames = useMemo(() => {
    if (selectedClusterDetail?.featureNames && selectedClusterDetail.featureNames.length > 0) {
      return selectedClusterDetail.featureNames
    }
    return Object.keys(FEATURE_GROUPS)
  }, [selectedClusterDetail])

  const featureIndices = useMemo(() => {
    const map: Record<string, number> = {}
    featureNames.forEach((name, idx) => {
      map[name] = idx
    })
    return map
  }, [featureNames])

  const centroids = selectedClusterDetail?.centroids || []

  // Euclidean drift calculation for each centroid
  const centroidDrifts = useMemo(() => {
    return centroids.map((c) => {
      let sumSq = 0
      for (let i = 0; i < c.scaled.length; i++) {
        const diff = (c.scaled[i] ?? 0) - (c.anchor[i] ?? 0)
        sumSq += diff * diff
      }
      return Math.sqrt(sumSq)
    })
  }, [centroids])

  // PCA calculation for PCA mode
  const pcaResult = useMemo(() => {
    if (vizMode !== 'pca' || centroids.length < 2) return null
    const scaledMatrix = centroids.map((c) => c.scaled)
    return computePCA(scaledMatrix)
  }, [vizMode, centroids])

  // Builds one scatter trace per segment for the offers overlay
  const buildOfferTraces = useCallback((centroidXY: Map<number, { x: number; y: number }>): any[] => {
    if (!showOffers || offers.length === 0) return []
    const placed = placeOffersAroundCentroids(offers, centroidXY)
    const traces: any[] = []
    centroids.forEach((c, idx) => {
      const bucket = placed.get(c.segment?.id)
      if (!bucket) return
      const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length]
      const segmentLabel = c.segment?.name ? `${c.segment.name}` : `Segment #${c.segment?.id}`
      traces.push({
        x: bucket.xs,
        y: bucket.ys,
        mode: 'markers',
        name: `${segmentLabel} offers`,
        showlegend: false,
        customdata: bucket.offers.map((a) => [a.offerId, a.productId, a.marking, (a.distance ?? 0).toFixed(4)]),
        marker: {
          size: 6,
          color: color,
          opacity: 0.55,
          line: { color: '#020617', width: 0.5 },
        },
        hovertemplate:
          `Offer <b>%{customdata[0]}</b><br>` +
          `Product: %{customdata[1]}<br>` +
          `Segment: <b>${segmentLabel}</b><br>` +
          `State: %{customdata[2]}<br>` +
          `Centroid distance: <b>%{customdata[3]}</b><br>` +
          `<i>Click to open in Assignments</i><extra></extra>`,
      })
    })
    return traces
  }, [showOffers, offers, centroids])

  // Prepare Plotly data and layout
  const { plotData, plotLayout } = useMemo(() => {
    if (!centroids || centroids.length === 0) {
      return { plotData: [], plotLayout: {} }
    }

    const traces: any[] = []
    const annotations: any[] = []

    if (vizMode === 'scatter') {
      const xIdx = featureIndices[xAxisFeature] ?? 0
      const yIdx = featureIndices[yAxisFeature] ?? 1
      const centroidXY = new Map<number, { x: number; y: number }>()

      // 0. Offers overlay (drawn first so centroids stay on top)
      centroids.forEach((c) => {
        const vals = useSourceUnits ? c.source : c.scaled
        if (c.segment?.id !== undefined) {
          centroidXY.set(c.segment.id, { x: vals[xIdx] ?? 0, y: vals[yIdx] ?? 0 })
        }
      })
      traces.push(...buildOfferTraces(centroidXY))

      // 1. Scaled / Current centroids trace
      centroids.forEach((c, idx) => {
        const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length]
        const vals = useSourceUnits ? c.source : c.scaled
        const anchors = useSourceUnits
          ? c.source // anchor is in scaled space, but for visualization in source space we project or use scaled
          : c.anchor

        const xVal = vals[xIdx] ?? 0
        const yVal = vals[yIdx] ?? 0
        const anchorX = anchors[xIdx] ?? 0
        const anchorY = anchors[yIdx] ?? 0

        const driftDist = centroidDrifts[idx]?.toFixed(4) || '0.0000'

        // Bubble size calculation
        let markerSize = 22
        if (scaleBubbleSize) {
          const minSize = Math.min(...centroids.map((ce) => ce.size || 1))
          const maxSize = Math.max(...centroids.map((ce) => ce.size || 1))
          const norm = maxSize > minSize ? (c.size - minSize) / (maxSize - minSize) : 0.5
          markerSize = 16 + norm * 34 // 16 to 50 px
        }

        const segmentLabel = c.segment?.name ? `${c.segment.name}` : `Segment #${c.segment?.id}`
        const inheritedText = c.inherited === true ? 'Yes (Inherited)' : c.inherited === false ? 'No (New)' : 'N/A'

        // Centroid marker trace
        traces.push({
          x: [xVal],
          y: [yVal],
          mode: 'markers+text',
          name: `${segmentLabel} (ID: ${c.id})`,
          text: [segmentLabel],
          textposition: 'top center',
          textfont: { color: color, size: 12, family: 'system-ui' },
          marker: {
            size: [markerSize],
            color: color,
            opacity: 0.85,
            line: { color: '#ffffff', width: 2 },
          },
          hovertemplate:
            `<b>${segmentLabel}</b> (Centroid #${c.id})<br>` +
            `Size: <b>${c.size}</b> auctions<br>` +
            `Inherited: ${inheritedText}<br>` +
            `Total Euclidean Drift: <b>${driftDist}</b><br>` +
            `<br>` +
            `${xAxisFeature}: <b>%{x:.4f}</b><br>` +
            `${yAxisFeature}: <b>%{y:.4f}</b><extra></extra>`,
        })

        // Anchor baseline point & Drift arrow
        if (showDriftVectors && !useSourceUnits) {
          traces.push({
            x: [anchorX],
            y: [anchorY],
            mode: 'markers',
            name: `${segmentLabel} [Anchor]`,
            showlegend: false,
            marker: {
              symbol: 'x',
              size: 10,
              color: color,
              opacity: 0.6,
            },
            hoverinfo: 'none',
          })

          // Arrow from anchor to scaled
          const dx = xVal - anchorX
          const dy = yVal - anchorY
          if (Math.hypot(dx, dy) > 0.005) {
            annotations.push({
              ax: anchorX,
              ay: anchorY,
              axref: 'x',
              ayref: 'y',
              x: xVal,
              y: yVal,
              xref: 'x',
              yref: 'y',
              showarrow: true,
              arrowhead: 2,
              arrowsize: 1.2,
              arrowwidth: 2,
              arrowcolor: color,
              opacity: 0.7,
            })
          }
        }
      })

      const xLabel = `${xAxisFeature} (${useSourceUnits ? 'Original Units' : 'Scaled Space [-3, 3]'})`
      const yLabel = `${yAxisFeature} (${useSourceUnits ? 'Original Units' : 'Scaled Space [-3, 3]'})`

      return {
        plotData: traces,
        plotLayout: {
          title: {
            text: `Centroid Scatter: ${xAxisFeature} vs ${yAxisFeature}`,
            font: { color: '#f8fafc', size: 16 },
          },
          xaxis: { title: { text: xLabel, font: { color: '#94a3b8' } } },
          yaxis: { title: { text: yLabel, font: { color: '#94a3b8' } } },
          annotations,
        },
      }
    } else {
      // PCA 2D Mode
      if (!pcaResult) {
        return {
          plotData: [],
          plotLayout: {
            title: { text: 'Need at least 2 centroids for PCA projection', font: { color: '#f8fafc' } },
          },
        }
      }

      const centroidXY = new Map<number, { x: number; y: number }>()
      centroids.forEach((c) => {
        const [px, py] = pcaResult.project(c.scaled)
        if (c.segment?.id !== undefined) centroidXY.set(c.segment.id, { x: px, y: py })
      })
      traces.push(...buildOfferTraces(centroidXY))

      centroids.forEach((c, idx) => {
        const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length]
        const [pc1Scaled, pc2Scaled] = pcaResult.project(c.scaled)
        const [pc1Anchor, pc2Anchor] = pcaResult.project(c.anchor)

        const driftDist = centroidDrifts[idx]?.toFixed(4) || '0.0000'

        let markerSize = 22
        if (scaleBubbleSize) {
          const minSize = Math.min(...centroids.map((ce) => ce.size || 1))
          const maxSize = Math.max(...centroids.map((ce) => ce.size || 1))
          const norm = maxSize > minSize ? (c.size - minSize) / (maxSize - minSize) : 0.5
          markerSize = 16 + norm * 34
        }

        const segmentLabel = c.segment?.name ? `${c.segment.name}` : `Segment #${c.segment?.id}`
        const inheritedText = c.inherited === true ? 'Yes (Inherited)' : c.inherited === false ? 'No (New)' : 'N/A'

        traces.push({
          x: [pc1Scaled],
          y: [pc2Scaled],
          mode: 'markers+text',
          name: `${segmentLabel} (ID: ${c.id})`,
          text: [segmentLabel],
          textposition: 'top center',
          textfont: { color: color, size: 12, family: 'system-ui' },
          marker: {
            size: [markerSize],
            color: color,
            opacity: 0.85,
            line: { color: '#ffffff', width: 2 },
          },
          hovertemplate:
            `<b>${segmentLabel}</b> (Centroid #${c.id})<br>` +
            `Size: <b>${c.size}</b> auctions<br>` +
            `Inherited: ${inheritedText}<br>` +
            `Total Euclidean Drift: <b>${driftDist}</b><br>` +
            `PC1: <b>%{x:.3f}</b>, PC2: <b>%{y:.3f}</b><extra></extra>`,
        })

        if (showDriftVectors) {
          traces.push({
            x: [pc1Anchor],
            y: [pc2Anchor],
            mode: 'markers',
            name: `${segmentLabel} [Anchor]`,
            showlegend: false,
            marker: {
              symbol: 'x',
              size: 10,
              color: color,
              opacity: 0.6,
            },
            hoverinfo: 'none',
          })

          const dx = pc1Scaled - pc1Anchor
          const dy = pc2Scaled - pc2Anchor
          if (Math.hypot(dx, dy) > 0.005) {
            annotations.push({
              ax: pc1Anchor,
              ay: pc2Anchor,
              axref: 'x',
              ayref: 'y',
              x: pc1Scaled,
              y: pc2Scaled,
              xref: 'x',
              yref: 'y',
              showarrow: true,
              arrowhead: 2,
              arrowsize: 1.2,
              arrowwidth: 2,
              arrowcolor: color,
              opacity: 0.7,
            })
          }
        }
      })

      const pc1Var = ((pcaResult.explainedVarianceRatio[0] || 0) * 100).toFixed(1)
      const pc2Var = ((pcaResult.explainedVarianceRatio[1] || 0) * 100).toFixed(1)

      return {
        plotData: traces,
        plotLayout: {
          title: {
            text: `PCA 2D Projection (PC1: ${pc1Var}%, PC2: ${pc2Var}% variance explained)`,
            font: { color: '#f8fafc', size: 16 },
          },
          xaxis: { title: { text: `Principal Component 1 (${pc1Var}% var)`, font: { color: '#94a3b8' } } },
          yaxis: { title: { text: `Principal Component 2 (${pc2Var}% var)`, font: { color: '#94a3b8' } } },
          annotations,
        },
      }
    }
  }, [
    centroids,
    vizMode,
    xAxisFeature,
    yAxisFeature,
    useSourceUnits,
    showDriftVectors,
    scaleBubbleSize,
    featureIndices,
    centroidDrifts,
    pcaResult,
    buildOfferTraces,
  ])

  const handlePointClick = (point: any) => {
    const offerId = Array.isArray(point?.customdata) ? point.customdata[0] : undefined
    if (typeof offerId === 'string' && offerId && onOpenOfferAssignments) {
      onOpenOfferAssignments(offerId)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner: Status & Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">Error:</span> {error}
          </div>
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-start space-x-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm">{successMsg}</div>
        </div>
      )}

      {/* Cluster Cards Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-semibold text-slate-100">Auction Clusters</h2>
            <span className="text-xs text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
              {clusters.length} total
            </span>
          </div>
          <button
            onClick={loadClusters}
            disabled={loading}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Cluster list pills */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {clusters.map((c) => {
            const isSelected = selectedClusterId === c.id
            const markingColor =
              c.marking === 'Promoted'
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700'
                : c.marking === 'Candidate'
                ? 'bg-amber-950/60 text-amber-400 border-amber-700'
                : 'bg-slate-800 text-slate-400 border-slate-700'

            return (
              <div
                key={c.id}
                onClick={() => setSelectedClusterId(c.id)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-purple-950/40 border-purple-500 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/50'
                    : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-slate-100">Cluster #{c.id}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${markingColor}`}>
                    {c.marking}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div>
                    <span className="text-slate-500 block">Groups (k)</span>
                    <span className="font-semibold text-slate-300">{c.segmentCount} segments</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Inertia</span>
                    <span className="font-semibold text-slate-300">{c.inertia?.toFixed(1) ?? 'N/A'}</span>
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>v: {c.vectorVersion?.slice(0, 12)}...</span>
                  <span>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected Cluster Overview & Lifecycle Transitions */}
      {selectedClusterDetail && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="flex items-center space-x-3">
                <h3 className="text-xl font-bold text-slate-100">
                  Cluster #{selectedClusterDetail.id} Overview
                </h3>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                    selectedClusterDetail.marking === 'Promoted'
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
                      : selectedClusterDetail.marking === 'Candidate'
                      ? 'bg-amber-950 text-amber-400 border-amber-700'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {selectedClusterDetail.marking}
                </span>
                {selectedClusterDetail.promotedAt && (
                  <span className="text-xs text-emerald-400/80 font-mono">
                    Promoted at {new Date(selectedClusterDetail.promotedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Vector Version: <code className="text-purple-300 font-mono">{selectedClusterDetail.vectorVersion}</code> •
                Feature Set: <code className="text-purple-300 font-mono">{selectedClusterDetail.featureSetVersion}</code> •
                Inertia: <b className="text-slate-200">{selectedClusterDetail.inertia?.toFixed(2) ?? 'N/A'}</b>
              </p>
            </div>

            {/* Lifecycle Action Buttons */}
            <div className="flex items-center space-x-3">
              {selectedClusterDetail.marking === 'Candidate' && (
                <button
                  onClick={() => handlePromote(selectedClusterDetail.id)}
                  disabled={actionLoading}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Promote to Active</span>
                </button>
              )}
              {(selectedClusterDetail.marking === 'Candidate' || selectedClusterDetail.marking === 'Promoted') && (
                <button
                  onClick={() => handleRetire(selectedClusterDetail.id)}
                  disabled={actionLoading}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 text-sm font-semibold border border-slate-700 hover:border-rose-700 transition-all disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                  <span>Retire Cluster</span>
                </button>
              )}
            </div>
          </div>

          {/* 2D Visualization Canvas Controls */}
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
              {/* Mode Toggle */}
              <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setVizMode('scatter')}
                  className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    vizMode === 'scatter'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>2D Feature Scatter</span>
                </button>
                <button
                  onClick={() => setVizMode('pca')}
                  className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    vizMode === 'pca'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>PCA 2D Projection</span>
                </button>
              </div>

              {/* Feature Selectors (if Scatter Mode) */}
              {vizMode === 'scatter' && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-medium">X Axis:</span>
                    <select
                      value={xAxisFeature}
                      onChange={(e) => setXAxisFeature(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                    >
                      {featureNames.map((fn) => (
                        <option key={fn} value={fn}>
                          {FEATURE_GROUPS[fn]?.label || fn} ({FEATURE_GROUPS[fn]?.group || 'Other'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-medium">Y Axis:</span>
                    <select
                      value={yAxisFeature}
                      onChange={(e) => setYAxisFeature(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                    >
                      {featureNames.map((fn) => (
                        <option key={fn} value={fn}>
                          {FEATURE_GROUPS[fn]?.label || fn} ({FEATURE_GROUPS[fn]?.group || 'Other'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2 border-l border-slate-800 pl-3">
                    <button
                      onClick={() => setUseSourceUnits(!useSourceUnits)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                        useSourceUnits
                          ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {useSourceUnits ? 'Source Units' : 'Scaled [-3, 3]'}
                    </button>
                  </div>
                </div>
              )}

              {/* Toggles */}
              <div className="flex items-center space-x-4 text-xs text-slate-300">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDriftVectors}
                    onChange={(e) => setShowDriftVectors(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span>Drift Vectors (Anchor → Scaled)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scaleBubbleSize}
                    onChange={(e) => setScaleBubbleSize(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span>Bubble Size by Auctions</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOffers}
                    onChange={(e) => setShowOffers(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span>Offers (approx. placement)</span>
                  {showOffers && (
                    <span className="text-[11px] text-slate-500 font-mono">
                      {offersLoading
                        ? 'loading…'
                        : offersTotal !== undefined && offersTotal > offers.length
                        ? `${offers.length} of ${offersTotal}`
                        : `${offers.length}`}
                    </span>
                  )}
                </label>
              </div>
            </div>

            {/* Plotly Canvas Container */}
            <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950 p-2">
              <PlotlyChart data={plotData} layout={plotLayout} onPointClick={handlePointClick} />
              {showOffers && (
                <p className="px-2 pb-1 text-[11px] text-slate-500">
                  Offer dots are placed around their segment centroid at a radius proportional to centroid distance
                  (angle is arbitrary). Hover for details, click to open the offer in Assignments.
                </p>
              )}
            </div>
          </div>

          {/* Centroids Table */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-200">
                Centroids & Segments Details ({centroids.length} groups)
              </h4>
              <span className="text-xs text-slate-500">
                Weekly Anchor Drift Limit: max 1.0 (Euclidean)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                <thead className="bg-slate-950/70 text-slate-400 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Centroid ID</th>
                    <th className="px-4 py-3">Segment Name</th>
                    <th className="px-4 py-3">Auctions Count</th>
                    <th className="px-4 py-3">Inherited</th>
                    <th className="px-4 py-3">Anchor Drift</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                  {centroids.map((c, idx) => {
                    const drift = centroidDrifts[idx] ?? 0
                    const driftColor =
                      drift > 0.5
                        ? 'text-rose-400'
                        : drift > 0.1
                        ? 'text-amber-400'
                        : 'text-emerald-400'

                    return (
                      <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-slate-300">#{c.id}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: SEGMENT_COLORS[idx % SEGMENT_COLORS.length] }}
                            />
                            <span className="font-semibold text-slate-200">
                              {c.segment?.name ? c.segment.name : <i className="text-slate-500 font-normal">Unnamed</i>}
                            </span>
                            <span className="text-slate-500 text-[11px] font-mono">
                              (Segment #{c.segment?.id})
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-200">
                          {c.size} auctions
                        </td>
                        <td className="px-4 py-3">
                          {c.inherited === true ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-purple-950/60 text-purple-300 border border-purple-800">
                              Inherited
                            </span>
                          ) : c.inherited === false ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800">
                              New Group
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <span className={`font-semibold ${driftColor}`}>
                            {drift.toFixed(4)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center space-x-2">
                            <button
                              onClick={() =>
                                setAuctionsCentroid({ centroid: c, color: SEGMENT_COLORS[idx % SEGMENT_COLORS.length] })
                              }
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                            >
                              <ListOrdered className="w-3 h-3" />
                              <span>Auctions</span>
                            </button>
                            <button
                              onClick={() => setInspectedCentroid(c)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                            >
                              <span>Inspect 19 Features</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Cluster vs cluster comparison */}
      {selectedClusterDetail && clusters.length > 1 && (
        <ClusterComparison clusters={clusters} selected={selectedClusterDetail} />
      )}

      {/* Segment Auctions Modal */}
      {auctionsCentroid && selectedClusterDetail && (
        <SegmentAuctionsModal
          clusterId={selectedClusterDetail.id}
          segment={auctionsCentroid.centroid.segment}
          color={auctionsCentroid.color}
          onClose={() => setAuctionsCentroid(null)}
          onOpenOfferAssignments={onOpenOfferAssignments}
        />
      )}

      {/* Feature Inspector Modal */}
      {inspectedCentroid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-bold text-slate-100">
                  Centroid #{inspectedCentroid.id} Feature Vector Breakdown
                </h3>
                <span className="text-xs text-slate-400 px-2 py-0.5 bg-slate-800 rounded font-medium">
                  {inspectedCentroid.segment?.name || `Segment #${inspectedCentroid.segment?.id}`}
                </span>
              </div>
              <button
                onClick={() => setInspectedCentroid(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <p className="text-xs text-slate-400">
                19 aggregated features over the feature window. Scaled features are normalized via robust IQR scaling:{' '}
                <code>(value - median) / IQR</code>, clipped to ±3. Anchor represents the trained baseline.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-left text-xs font-mono">
                  <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase">
                    <tr>
                      <th className="px-3.5 py-2.5">Feature</th>
                      <th className="px-3.5 py-2.5">Group</th>
                      <th className="px-3.5 py-2.5">Scaled (Current)</th>
                      <th className="px-3.5 py-2.5">Anchor (Baseline)</th>
                      <th className="px-3.5 py-2.5">Weekly Shift</th>
                      <th className="px-3.5 py-2.5">Source Units</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                    {featureNames.map((fn, idx) => {
                      const scaledVal = inspectedCentroid.scaled[idx] ?? 0
                      const anchorVal = inspectedCentroid.anchor[idx] ?? 0
                      const sourceVal = inspectedCentroid.source[idx] ?? 0
                      const shift = scaledVal - anchorVal
                      const meta = FEATURE_GROUPS[fn]

                      return (
                        <tr key={fn} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-3.5 py-2 font-semibold text-slate-200">
                            {meta?.label || fn}
                          </td>
                          <td className="px-3.5 py-2 text-slate-400">{meta?.group || '—'}</td>
                          <td className="px-3.5 py-2 text-purple-300">{scaledVal.toFixed(4)}</td>
                          <td className="px-3.5 py-2 text-slate-300">{anchorVal.toFixed(4)}</td>
                          <td className="px-3.5 py-2">
                            <span
                              className={
                                Math.abs(shift) > 0.05
                                  ? shift > 0
                                    ? 'text-amber-400'
                                    : 'text-indigo-400'
                                  : 'text-slate-400'
                              }
                            >
                              {shift > 0 ? `+${shift.toFixed(4)}` : shift.toFixed(4)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-slate-400">{sourceVal.toFixed(4)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end px-6 py-3 border-t border-slate-800 bg-slate-950/60">
              <button
                onClick={() => setInspectedCentroid(null)}
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
