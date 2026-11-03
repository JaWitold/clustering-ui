import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  Crosshair,
  X,
  HelpCircle,
  FolderKanban,
} from "lucide-react";
import type { Cluster, Centroid, ClusterAssignment } from "../types/clustering";
import { FEATURE_GROUPS } from "../types/clustering";
import { api } from "../api/client";
import { computePCA, getComponentDetails } from "../utils/pca";
import {
  voronoiCells,
  paddedBounds,
  placeInCell,
  scaledCell,
  type Point,
  type Bounds,
} from "../utils/voronoi";
import { PlotlyChart } from "./PlotlyChart";
import { SegmentAuctionsModal } from "./SegmentAuctionsModal";
import { ClusterComparison } from "./ClusterComparison";

const SEGMENT_COLORS = [
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#3b82f6", // blue
  "#f43f5e", // rose
  "#84cc16", // lime
];

const OFFER_PAGE_SIZE = 100; // API caps per-page at 100
const OFFER_MAX_PAGES = 5; // 500 offers max on the canvas
const OFFER_RADIUS_SCALE = 0.3; // fallback max offer radius (fraction of centroid spread) when there is no cell
const OFFER_MAX_FRACTION = 0.9; // farthest offer sits at this fraction of its cell's extent
const OFFER_MIN_FRACTION = 0.06;
const MAX_PINNED_OFFERS = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AXIS_PAD = 0.12; // axis padding as a fraction of the larger data span

/**
 * Places offers inside their segment's Voronoi cell: the 19D centroid distance (normalized to
 * the farthest offer) becomes a fraction of the cell's extent in the dot's direction, and the
 * angle follows the golden angle so dots spread evenly and deterministically. The offer is
 * assigned to that segment, so its dot never leaves the region.
 * Positions are approximate – the true 19D feature vector is not exposed by the API.
 */
/**
 * Voronoi cell of every segment in the current projection, used for placing offers. Outer cells
 * are unbounded, so they are clipped to a box moderately larger than the centroid spread; that
 * box, not the plot, limits how far an outer segment's offers can be drawn from its centroid.
 */
function cellsBySegment(
  centroidXY: Map<number, { x: number; y: number }>,
): Map<number, Point[]> {
  const ids = [...centroidXY.keys()];
  const sites: Point[] = ids.map((id) => [
    centroidXY.get(id)!.x,
    centroidXY.get(id)!.y,
  ]);
  const cells =
    sites.length >= 2
      ? voronoiCells(sites, paddedBounds(sites, OFFER_RADIUS_SCALE, 0.25))
      : sites.map(() => []);
  const out = new Map<number, Point[]>();
  ids.forEach((id, i) => out.set(id, cells[i]));
  return out;
}

/** Canvas spread of the centroids (largest axis range), the unit the offer radius is scaled to. */
function centroidExtent(
  centroidXY: Map<number, { x: number; y: number }>,
): number {
  const xs = [...centroidXY.values()].map((p) => p.x);
  const ys = [...centroidXY.values()].map((p) => p.y);
  const spread = Math.max(
    xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
  );
  return spread > 1e-9 ? spread : 1;
}

/** Extent of every numeric x/y pair in the traces (the points Plotly would autorange on). */
function traceExtent(traces: any[]): Point[] {
  const pts: Point[] = [];
  traces.forEach((t) => {
    if (!Array.isArray(t.x) || !Array.isArray(t.y)) return;
    for (let i = 0; i < t.x.length; i++) {
      const x = t.x[i];
      const y = t.y[i];
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        isFinite(x) &&
        isFinite(y)
      )
        pts.push([x, y]);
    }
  });
  return pts;
}

/** Deterministic angle for an offer id so the highlighted point does not jump between renders. */
function offerAngle(offerId: string): number {
  let h = 0;
  for (let i = 0; i < offerId.length; i++)
    h = (h * 31 + offerId.charCodeAt(i)) >>> 0;
  return ((h % 3600) / 3600) * 2 * Math.PI;
}

function placeOffersAroundCentroids(
  offers: ClusterAssignment[],
  centroidXY: Map<number, { x: number; y: number }>,
): Map<number, { xs: number[]; ys: number[]; offers: ClusterAssignment[] }> {
  const bySegment = new Map<
    number,
    { xs: number[]; ys: number[]; offers: ClusterAssignment[] }
  >();
  const extent = centroidExtent(centroidXY);
  const cells = cellsBySegment(centroidXY);
  const maxDistance =
    offers.reduce((m, a) => Math.max(m, a.distance ?? 0), 0) || 1;
  const maxRadius = extent * OFFER_RADIUS_SCALE;
  offers.forEach((a) => {
    const segId = a.segment?.id;
    const center = segId !== undefined ? centroidXY.get(segId) : undefined;
    if (!center) return;
    let bucket = bySegment.get(segId);
    if (!bucket) {
      bucket = { xs: [], ys: [], offers: [] };
      bySegment.set(segId, bucket);
    }
    const i = bucket.offers.length;
    const f = Math.max(
      OFFER_MIN_FRACTION,
      ((a.distance ?? 0) / maxDistance) * OFFER_MAX_FRACTION,
    );
    const theta = i * GOLDEN_ANGLE;
    const [x, y] = placeInCell(
      [center.x, center.y],
      f,
      theta,
      cells.get(segId),
      maxRadius,
    );
    bucket.xs.push(x);
    bucket.ys.push(y);
    bucket.offers.push(a);
  });
  return bySegment;
}

const RUN_THEMES = [
  {
    badge: "bg-indigo-950/80 text-indigo-300 border-indigo-700/80",
    cardBorder: "border-l-indigo-500",
    cardBg: "hover:bg-indigo-950/20",
    containerBorder: "border-indigo-800/40",
    containerBg: "bg-indigo-950/10",
    accentText: "text-indigo-400",
  },
  {
    badge: "bg-cyan-950/80 text-cyan-300 border-cyan-700/80",
    cardBorder: "border-l-cyan-500",
    cardBg: "hover:bg-cyan-950/20",
    containerBorder: "border-cyan-800/40",
    containerBg: "bg-cyan-950/10",
    accentText: "text-cyan-400",
  },
  {
    badge: "bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-700/80",
    cardBorder: "border-l-fuchsia-500",
    cardBg: "hover:bg-fuchsia-950/20",
    containerBorder: "border-fuchsia-800/40",
    containerBg: "bg-fuchsia-950/10",
    accentText: "text-fuchsia-400",
  },
  {
    badge: "bg-amber-950/80 text-amber-300 border-amber-700/80",
    cardBorder: "border-l-amber-500",
    cardBg: "hover:bg-amber-950/20",
    containerBorder: "border-amber-800/40",
    containerBg: "bg-amber-950/10",
    accentText: "text-amber-400",
  },
  {
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-700/80",
    cardBorder: "border-l-emerald-500",
    cardBg: "hover:bg-emerald-950/20",
    containerBorder: "border-emerald-800/40",
    containerBg: "bg-emerald-950/10",
    accentText: "text-emerald-400",
  },
  {
    badge: "bg-sky-950/80 text-sky-300 border-sky-700/80",
    cardBorder: "border-l-sky-500",
    cardBg: "hover:bg-sky-950/20",
    containerBorder: "border-sky-800/40",
    containerBg: "bg-sky-950/10",
    accentText: "text-sky-400",
  },
];

function getRunTheme(
  runId: number | null | undefined,
  allRunIds: (number | null)[],
) {
  if (runId === null || runId === undefined) {
    return {
      badge: "bg-slate-800 text-slate-400 border-slate-700",
      cardBorder: "border-l-slate-600",
      cardBg: "hover:bg-slate-800/30",
      containerBorder: "border-slate-800",
      containerBg: "bg-slate-950/40",
      accentText: "text-slate-400",
    };
  }
  const idx = allRunIds.indexOf(runId);
  return RUN_THEMES[Math.max(0, idx) % RUN_THEMES.length];
}

const InertiaTooltip: React.FC<{
  value: number | null | undefined;
  isMin?: boolean;
}> = ({ value, isMin }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div
        className="flex items-center space-x-1 cursor-pointer select-none"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="text-slate-500 block">Inertia</span>
        <HelpCircle className="w-3 h-3 text-slate-500 hover:text-purple-400 transition-colors" />
      </div>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 w-64 p-3 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl backdrop-blur-md text-[11px] leading-relaxed text-slate-300 pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center space-x-1.5 font-semibold text-purple-300 mb-1">
            <HelpCircle className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>Inertia (WCSS)</span>
          </div>
          <p className="text-slate-300">
            Within-Cluster Sum of Squares measures how compact the clusters are. Lower values indicate tighter, more cohesive clusters. In k-means, higher k naturally lowers inertia.
          </p>
          <div className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-slate-700" />
        </div>
      )}

      <div className="flex items-baseline space-x-1 mt-0.5">
        <span
          className={`font-semibold ${
            isMin ? "text-emerald-400 font-bold" : "text-slate-300"
          }`}
        >
          {value !== null && value !== undefined ? value.toFixed(1) : "N/A"}
        </span>
      </div>
    </div>
  );
};

const OverviewInertiaTooltip: React.FC<{
  value: number | null | undefined;
}> = ({ value }) => {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center space-x-1 cursor-pointer border-b border-dotted border-slate-600">
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center space-x-1"
      >
        <span>Inertia:</span>
        <b className="text-slate-200">
          {value !== null && value !== undefined ? value.toFixed(2) : "N/A"}
        </b>
        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-purple-400 transition-colors inline" />
      </span>

      {open && (
        <span className="absolute bottom-full left-0 mb-2 z-50 w-64 p-3 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl backdrop-blur-md text-[11px] leading-relaxed text-slate-300 pointer-events-none block">
          <span className="flex items-center space-x-1.5 font-semibold text-purple-300 mb-1">
            <HelpCircle className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>Inertia (WCSS)</span>
          </span>
          <span className="text-slate-300 block">
            Within-Cluster Sum of Squares measures how compact the clusters are. Lower values indicate tighter, more cohesive clusters. In k-means, higher k naturally lowers inertia.
          </span>
          <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-slate-700 block" />
        </span>
      )}
    </span>
  );
};

interface ClustersVizProps {
  /** Navigate to the Assignments tab with the given offer id pre-searched. */
  onOpenOfferAssignments?: (offerId: string) => void;
}

export const ClustersViz: React.FC<ClustersVizProps> = ({
  onOpenOfferAssignments,
}) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(
    null,
  );
  const [selectedClusterDetail, setSelectedClusterDetail] =
    useState<Cluster | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Viz controls
  const [vizMode, setVizMode] = useState<"scatter" | "pca">("scatter");
  const [xAxisFeature, setXAxisFeature] = useState<string>("priceLevel");
  const [yAxisFeature, setYAxisFeature] = useState<string>("gapToBest");
  const [useSourceUnits, setUseSourceUnits] = useState(false);
  const [showDriftVectors, setShowDriftVectors] = useState(true);
  const [scaleBubbleSize, setScaleBubbleSize] = useState(true);
  const [showOffers, setShowOffers] = useState(false);
  const [showVoronoi, setShowVoronoi] = useState(true);
  const [groupByRun, setGroupByRun] = useState(true);

  // Grouping clusters by trainingRun.id
  const uniqueRunIds = useMemo(() => {
    const ids: (number | null)[] = [];
    clusters.forEach((c) => {
      const id = c.trainingRun?.id ?? null;
      if (!ids.includes(id)) ids.push(id);
    });
    return ids;
  }, [clusters]);

  const runGroups = useMemo(() => {
    const groupsMap = new Map<
      number | string,
      {
        runId: number | null;
        clusters: Cluster[];
        createdAt?: string;
        hasPromoted: boolean;
      }
    >();

    clusters.forEach((c) => {
      const runId = c.trainingRun?.id ?? null;
      const key = runId !== null ? runId : "none";
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          runId,
          clusters: [],
          createdAt: c.createdAt,
          hasPromoted: false,
        });
      }
      const grp = groupsMap.get(key)!;
      grp.clusters.push(c);
      if (c.marking === "Promoted") grp.hasPromoted = true;
    });

    return Array.from(groupsMap.values());
  }, [clusters]);

  // Minimum inertia per trainingRun.id to visually highlight/backlight the best cluster in each batch
  const minInertiaByRun = useMemo(() => {
    const map = new Map<number | null, number>();
    clusters.forEach((c) => {
      const runId = c.trainingRun?.id ?? null;
      if (c.inertia !== null && c.inertia !== undefined) {
        const cur = map.get(runId);
        if (cur === undefined || c.inertia < cur) {
          map.set(runId, c.inertia);
        }
      }
    });
    return map;
  }, [clusters]);

  // Offers (cluster assignments) overlay
  const [offersResult, setOffersResult] = useState<{
    clusterId: number;
    offers: ClusterAssignment[];
    total: number | undefined;
  } | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);

  // Pinned offers ("find offer on the chart"), up to MAX_PINNED_OFFERS per cluster
  const [findOfferInput, setFindOfferInput] = useState("");
  const [findOfferLoading, setFindOfferLoading] = useState(false);
  const [findOfferError, setFindOfferError] = useState<string | null>(null);
  const [pins, setPins] = useState<
    { clusterId: number; assignment: ClusterAssignment }[]
  >([]);
  const pinnedOffers = useMemo(
    () =>
      pins
        .filter((p) => p.clusterId === selectedClusterId)
        .map((p) => p.assignment),
    [pins, selectedClusterId],
  );
  // Only offers fetched for the currently selected cluster are rendered
  const offers = useMemo(
    () =>
      offersResult && offersResult.clusterId === selectedClusterId
        ? offersResult.offers
        : [],
    [offersResult, selectedClusterId],
  );
  const offersTotal =
    offersResult?.clusterId === selectedClusterId
      ? offersResult.total
      : undefined;

  // Drawer / Inspection
  const [inspectedCentroid, setInspectedCentroid] = useState<Centroid | null>(
    null,
  );
  const [auctionsCentroid, setAuctionsCentroid] = useState<{
    centroid: Centroid;
    color: string;
  } | null>(null);

  // Load cluster list
  const loadClusters = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listClusters();
      setClusters(list);
      if (list.length > 0) {
        // default select Promoted cluster if available, else first
        const promoted = list.find((c) => c.marking === "Promoted");
        const initialId = promoted ? promoted.id : list[0].id;
        setSelectedClusterId((prev) => (prev ? prev : initialId));
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load clusters");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClusters();
  }, []);

  // Load cluster detail when selectedClusterId changes
  useEffect(() => {
    if (!selectedClusterId) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const detail = await api.getCluster(selectedClusterId);
        setSelectedClusterDetail(detail);
      } catch (err: any) {
        setError(err?.message || "Failed to fetch cluster detail");
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [selectedClusterId]);

  // Load offers (assignments) for the overlay when enabled
  useEffect(() => {
    if (!showOffers || !selectedClusterId) return;
    const clusterId = selectedClusterId;
    let cancelled = false;
    const fetchOffers = async () => {
      try {
        const collected: ClusterAssignment[] = [];
        let total: number | undefined;
        for (let page = 0; page < OFFER_MAX_PAGES; page++) {
          if (page === 0) setOffersLoading(true);
          const res = await api.listAssignments({
            cluster: clusterId,
            page,
            "per-page": OFFER_PAGE_SIZE,
          });
          if (cancelled) return;
          collected.push(...res.assignments);
          total = res.totalCount;
          const lastPage =
            res.totalPages !== undefined
              ? page + 1 >= res.totalPages
              : res.assignments.length < OFFER_PAGE_SIZE;
          if (lastPage) break;
        }
        setOffersResult({
          clusterId,
          offers: collected,
          total: total ?? collected.length,
        });
      } catch (err: any) {
        if (!cancelled)
          setError(err?.message || "Failed to load offers for cluster");
      } finally {
        if (!cancelled) setOffersLoading(false);
      }
    };
    fetchOffers();
    return () => {
      cancelled = true;
    };
  }, [showOffers, selectedClusterId]);

  // Handle Promote
  const handlePromote = async (id: number) => {
    if (
      !window.confirm(
        `Are you sure you want to PROMOTE Cluster #${id} into force? This will retire any currently promoted cluster.`,
      )
    ) {
      return;
    }
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await api.transitionCluster(id, "Promote");
      setSuccessMsg(`Cluster #${id} successfully Promoted!`);
      setSelectedClusterDetail(updated);
      await loadClusters();
    } catch (err: any) {
      setError(err?.message || "Failed to promote cluster");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Retire
  const handleRetire = async (id: number) => {
    if (!window.confirm(`Are you sure you want to RETIRE Cluster #${id}?`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await api.transitionCluster(id, "Retire");
      setSuccessMsg(`Cluster #${id} successfully Retired.`);
      setSelectedClusterDetail(updated);
      await loadClusters();
    } catch (err: any) {
      setError(err?.message || "Failed to retire cluster");
    } finally {
      setActionLoading(false);
    }
  };

  // Feature names list
  const featureNames = useMemo(() => {
    if (
      selectedClusterDetail?.featureNames &&
      selectedClusterDetail.featureNames.length > 0
    ) {
      return selectedClusterDetail.featureNames;
    }
    return Object.keys(FEATURE_GROUPS);
  }, [selectedClusterDetail]);

  const featureIndices = useMemo(() => {
    const map: Record<string, number> = {};
    featureNames.forEach((name, idx) => {
      map[name] = idx;
    });
    return map;
  }, [featureNames]);

  const centroids = selectedClusterDetail?.centroids || [];

  // Euclidean drift calculation for each centroid
  const centroidDrifts = useMemo(() => {
    return centroids.map((c) => {
      let sumSq = 0;
      for (let i = 0; i < c.scaled.length; i++) {
        const diff = (c.scaled[i] ?? 0) - (c.anchor[i] ?? 0);
        sumSq += diff * diff;
      }
      return Math.sqrt(sumSq);
    });
  }, [centroids]);

  // PCA calculation for PCA mode
  const pcaResult = useMemo(() => {
    if (vizMode !== "pca" || centroids.length < 2) return null;
    const scaledMatrix = centroids.map((c) => c.scaled);
    return computePCA(scaledMatrix);
  }, [vizMode, centroids]);

  const pc1Details = useMemo(() => {
    if (!pcaResult) return null;
    return getComponentDetails(
      pcaResult.pc1Coefficients,
      pcaResult.explainedVarianceRatio[0] || 0,
      1,
      featureNames,
      FEATURE_GROUPS,
    );
  }, [pcaResult, featureNames]);

  const pc2Details = useMemo(() => {
    if (!pcaResult) return null;
    return getComponentDetails(
      pcaResult.pc2Coefficients,
      pcaResult.explainedVarianceRatio[1] || 0,
      2,
      featureNames,
      FEATURE_GROUPS,
    );
  }, [pcaResult, featureNames]);

  const handleFindOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    const offerId = findOfferInput.trim();
    if (!offerId || !selectedClusterId) return;
    const clusterId = selectedClusterId;
    if (pinnedOffers.some((a) => a.offerId === offerId)) {
      setFindOfferError(`Offer ${offerId} is already on the chart`);
      return;
    }
    if (pinnedOffers.length >= MAX_PINNED_OFFERS) {
      setFindOfferError(
        `Up to ${MAX_PINNED_OFFERS} offers can be shown at once; remove one first`,
      );
      return;
    }
    setFindOfferLoading(true);
    setFindOfferError(null);
    try {
      const res = await api.listAssignments({
        cluster: clusterId,
        offerId,
        "per-page": 10,
      });
      const match =
        res.assignments.find((a) => a.offerId === offerId) ??
        res.assignments[0];
      if (!match) {
        setFindOfferError(
          `Offer ${offerId} is not assigned in cluster #${clusterId}`,
        );
      } else {
        setPins((prev) => [
          ...prev.filter(
            (p) =>
              !(
                p.clusterId === clusterId &&
                p.assignment.offerId === match.offerId
              ),
          ),
          { clusterId, assignment: match },
        ]);
        setFindOfferInput("");
      }
    } catch (err: any) {
      setFindOfferError(err?.message || "Failed to look up the offer");
    } finally {
      setFindOfferLoading(false);
    }
  };

  // Voronoi cells of the centroids in the current 2D projection (nearest-centroid regions of the plane).
  // Returned as layout shapes: shapes do not take part in autorange and are clipped to the plot area,
  // so the chart keeps the scale it has without them.
  const buildVoronoiShapes = useCallback(
    (
      centroidXY: Map<number, { x: number; y: number }>,
      bounds: Bounds,
    ): any[] => {
      if (!showVoronoi || centroids.length < 2) return [];
      const sites: Point[] = [];
      const siteIdx: number[] = [];
      centroids.forEach((c, idx) => {
        const xy =
          c.segment?.id !== undefined
            ? centroidXY.get(c.segment.id)
            : undefined;
        if (!xy) return;
        sites.push([xy.x, xy.y]);
        siteIdx.push(idx);
      });
      if (sites.length < 2) return [];
      const cells = voronoiCells(sites, bounds);
      const shapes: any[] = [];
      cells.forEach((cell, k) => {
        if (cell.length < 3) return;
        const color = SEGMENT_COLORS[siteIdx[k] % SEGMENT_COLORS.length];
        const path =
          cell
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
            .join(" ") + " Z";
        shapes.push({
          type: "path",
          path,
          xref: "x",
          yref: "y",
          layer: "below",
          fillcolor: color + "1f", // ~12% alpha
          line: { color: color + "80", width: 1 },
        });
      });
      return shapes;
    },
    [showVoronoi, centroids],
  );

  // Halo + outlined dot + iso-outline for every pinned offer (position approximate, see placeOffersAroundCentroids)
  const buildHighlightTraces = useCallback(
    (centroidXY: Map<number, { x: number; y: number }>): any[] => {
      if (pinnedOffers.length === 0) return [];
      const extent = centroidExtent(centroidXY);
      const maxRadius = extent * OFFER_RADIUS_SCALE;
      const cells = cellsBySegment(centroidXY);
      // Same scale as the offers overlay when it is loaded, otherwise the farthest pinned offer sets the outer edge
      const refDistance =
        (offers.length > 0 ? offers : pinnedOffers).reduce(
          (m, a) => Math.max(m, a.distance ?? 0),
          0,
        ) || 1;
      const traces: any[] = [];
      pinnedOffers.forEach((pinned) => {
        const segId = pinned.segment?.id;
        const center = segId !== undefined ? centroidXY.get(segId) : undefined;
        if (!center) return;
        const idx = centroids.findIndex((c) => c.segment?.id === segId);
        const color =
          SEGMENT_COLORS[(idx < 0 ? 0 : idx) % SEGMENT_COLORS.length];
        const f = Math.max(
          OFFER_MIN_FRACTION,
          Math.min(1, (pinned.distance ?? 0) / refDistance) *
            OFFER_MAX_FRACTION,
        );
        const theta = offerAngle(pinned.offerId);
        const cell = cells.get(segId);
        const c: Point = [center.x, center.y];
        const [px, py] = placeInCell(c, f, theta, cell, maxRadius);
        // Iso-line of "this far from the centroid": the cell shrunk by the same fraction
        const ring =
          cell && cell.length >= 3
            ? scaledCell(c, f, cell)
            : scaledCell(
                c,
                1,
                Array.from({ length: 72 }, (_, i): Point => [
                  center.x + f * maxRadius * Math.cos((i / 72) * 2 * Math.PI),
                  center.y + f * maxRadius * Math.sin((i / 72) * 2 * Math.PI),
                ]),
              );
        const ringX = ring.xs;
        const ringY = ring.ys;
        const segmentLabel = pinned.segment?.name || `Segment #${segId}`;
        traces.push(
          {
            x: ringX,
            y: ringY,
            mode: "lines",
            showlegend: false,
            hoverinfo: "skip",
            line: { color: color, width: 1, dash: "dot" },
            opacity: 0.6,
          },
          // Soft halo behind the point
          {
            x: [px],
            y: [py],
            mode: "markers",
            showlegend: false,
            hoverinfo: "skip",
            marker: {
              symbol: "circle",
              size: 30,
              color: color,
              opacity: 0.22,
              line: { width: 0 },
            },
          },
          // Core point with white outline, labelled with the offer id tail
          {
            x: [px],
            y: [py],
            mode: "markers+text",
            name: `Offer ${pinned.offerId.slice(-8)}`,
            showlegend: false,
            text: [pinned.offerId.slice(-8)],
            textposition: "bottom center",
            textfont: {
              color: "#cbd5e1",
              size: 10,
              family: "ui-monospace, monospace",
            },
            customdata: [
              [
                pinned.offerId,
                pinned.productId,
                pinned.marking,
                (pinned.distance ?? 0).toFixed(4),
              ],
            ],
            marker: {
              symbol: "circle",
              size: 11,
              color: color,
              opacity: 1,
              line: { color: "#f8fafc", width: 2 },
            },
            hovertemplate:
              `Offer <b>%{customdata[0]}</b><br>` +
              `Product: %{customdata[1]}<br>` +
              `Segment: <b>${segmentLabel}</b><br>` +
              `State: %{customdata[2]}<br>` +
              `Centroid distance: <b>%{customdata[3]}</b><br>` +
              `<i>Position approximate: somewhere on the dotted outline</i><br>` +
              `<i>Click to open in Assignments</i><extra></extra>`,
          },
        );
      });
      return traces;
    },
    [pinnedOffers, centroids, offers],
  );

  // Builds one scatter trace per segment for the offers overlay
  const buildOfferTraces = useCallback(
    (centroidXY: Map<number, { x: number; y: number }>): any[] => {
      if (!showOffers || offers.length === 0) return [];
      const placed = placeOffersAroundCentroids(offers, centroidXY);
      const traces: any[] = [];
      centroids.forEach((c, idx) => {
        const bucket = placed.get(c.segment?.id);
        if (!bucket) return;
        const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
        const segmentLabel = c.segment?.name
          ? `${c.segment.name}`
          : `Segment #${c.segment?.id}`;
        traces.push({
          x: bucket.xs,
          y: bucket.ys,
          mode: "markers",
          name: `${segmentLabel} offers`,
          showlegend: false,
          customdata: bucket.offers.map((a) => [
            a.offerId,
            a.productId,
            a.marking,
            (a.distance ?? 0).toFixed(4),
          ]),
          marker: {
            size: 6,
            color: color,
            opacity: 0.55,
            line: { color: "#020617", width: 0.5 },
          },
          hovertemplate:
            `Offer <b>%{customdata[0]}</b><br>` +
            `Product: %{customdata[1]}<br>` +
            `Segment: <b>${segmentLabel}</b><br>` +
            `State: %{customdata[2]}<br>` +
            `Centroid distance: <b>%{customdata[3]}</b><br>` +
            `<i>Click to open in Assignments</i><extra></extra>`,
        });
      });
      return traces;
    },
    [showOffers, offers, centroids],
  );

  // Prepare Plotly data and layout
  const { plotData, plotLayout } = useMemo(() => {
    if (!centroids || centroids.length === 0) {
      return { plotData: [], plotLayout: {} };
    }

    const traces: any[] = [];
    const annotations: any[] = [];

    if (vizMode === "scatter") {
      const xIdx = featureIndices[xAxisFeature] ?? 0;
      const yIdx = featureIndices[yAxisFeature] ?? 1;
      const centroidXY = new Map<number, { x: number; y: number }>();

      // 0. Offers overlay (drawn first so centroids stay on top)
      centroids.forEach((c) => {
        const vals = useSourceUnits ? c.source : c.scaled;
        if (c.segment?.id !== undefined) {
          centroidXY.set(c.segment.id, {
            x: vals[xIdx] ?? 0,
            y: vals[yIdx] ?? 0,
          });
        }
      });
      traces.push(...buildOfferTraces(centroidXY));
      traces.push(...buildHighlightTraces(centroidXY));

      // 1. Scaled / Current centroids trace
      centroids.forEach((c, idx) => {
        const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
        const vals = useSourceUnits ? c.source : c.scaled;
        const anchors = useSourceUnits
          ? c.source // anchor is in scaled space, but for visualization in source space we project or use scaled
          : c.anchor;

        const xVal = vals[xIdx] ?? 0;
        const yVal = vals[yIdx] ?? 0;
        const anchorX = anchors[xIdx] ?? 0;
        const anchorY = anchors[yIdx] ?? 0;

        const driftDist = centroidDrifts[idx]?.toFixed(4) || "0.0000";

        // Bubble size calculation
        let markerSize = 22;
        if (scaleBubbleSize) {
          const minSize = Math.min(...centroids.map((ce) => ce.size || 1));
          const maxSize = Math.max(...centroids.map((ce) => ce.size || 1));
          const norm =
            maxSize > minSize ? (c.size - minSize) / (maxSize - minSize) : 0.5;
          markerSize = 16 + norm * 34; // 16 to 50 px
        }

        const segmentLabel = c.segment?.name
          ? `${c.segment.name}`
          : `Segment #${c.segment?.id}`;
        const inheritedText =
          c.inherited === true
            ? "Yes (Inherited)"
            : c.inherited === false
              ? "No (New)"
              : "N/A";

        // Centroid marker trace
        traces.push({
          x: [xVal],
          y: [yVal],
          mode: "markers+text",
          name: `${segmentLabel} (ID: ${c.id})`,
          text: [segmentLabel],
          textposition: "top center",
          textfont: { color: color, size: 12, family: "system-ui" },
          marker: {
            size: [markerSize],
            color: color,
            opacity: 0.85,
            line: { color: "#ffffff", width: 2 },
          },
          hovertemplate:
            `<b>${segmentLabel}</b> (Centroid #${c.id})<br>` +
            `Size: <b>${c.size}</b> auctions<br>` +
            `Inherited: ${inheritedText}<br>` +
            `Total Euclidean Drift: <b>${driftDist}</b><br>` +
            `<br>` +
            `${xAxisFeature}: <b>%{x:.4f}</b><br>` +
            `${yAxisFeature}: <b>%{y:.4f}</b><extra></extra>`,
        });

        // Anchor baseline point & Drift arrow
        if (showDriftVectors && !useSourceUnits) {
          traces.push({
            x: [anchorX],
            y: [anchorY],
            mode: "markers",
            name: `${segmentLabel} [Anchor]`,
            showlegend: false,
            marker: {
              symbol: "x",
              size: 10,
              color: color,
              opacity: 0.6,
            },
            hoverinfo: "none",
          });

          // Arrow from anchor to scaled
          const dx = xVal - anchorX;
          const dy = yVal - anchorY;
          if (Math.hypot(dx, dy) > 0.005) {
            annotations.push({
              ax: anchorX,
              ay: anchorY,
              axref: "x",
              ayref: "y",
              x: xVal,
              y: yVal,
              xref: "x",
              yref: "y",
              showarrow: true,
              arrowhead: 2,
              arrowsize: 1.2,
              arrowwidth: 2,
              arrowcolor: color,
              opacity: 0.7,
            });
          }
        }
      });

      // Fixed axis ranges from the plotted points so the Voronoi cells (clipped to them) never change the scale
      const bounds = paddedBounds(traceExtent(traces), AXIS_PAD, 0.05);
      const shapes = buildVoronoiShapes(centroidXY, bounds);

      const xLabel = `${xAxisFeature} (${useSourceUnits ? "Original Units" : "Scaled Space [-3, 3]"})`;
      const yLabel = `${yAxisFeature} (${useSourceUnits ? "Original Units" : "Scaled Space [-3, 3]"})`;

      return {
        plotData: traces,
        plotLayout: {
          title: {
            text: `Centroid Scatter: ${xAxisFeature} vs ${yAxisFeature}`,
            font: { color: "#f8fafc", size: 16 },
          },
          xaxis: {
            title: { text: xLabel, font: { color: "#94a3b8" } },
            range: [bounds.xMin, bounds.xMax],
          },
          yaxis: {
            title: { text: yLabel, font: { color: "#94a3b8" } },
            range: [bounds.yMin, bounds.yMax],
          },
          annotations,
          shapes,
        },
      };
    } else {
      // PCA 2D Mode
      if (!pcaResult) {
        return {
          plotData: [],
          plotLayout: {
            title: {
              text: "Need at least 2 centroids for PCA projection",
              font: { color: "#f8fafc" },
            },
          },
        };
      }

      const centroidXY = new Map<number, { x: number; y: number }>();
      centroids.forEach((c) => {
        const [px, py] = pcaResult.project(c.scaled);
        if (c.segment?.id !== undefined)
          centroidXY.set(c.segment.id, { x: px, y: py });
      });
      traces.push(...buildOfferTraces(centroidXY));
      traces.push(...buildHighlightTraces(centroidXY));

      centroids.forEach((c, idx) => {
        const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
        const [pc1Scaled, pc2Scaled] = pcaResult.project(c.scaled);
        const [pc1Anchor, pc2Anchor] = pcaResult.project(c.anchor);

        const driftDist = centroidDrifts[idx]?.toFixed(4) || "0.0000";

        let markerSize = 22;
        if (scaleBubbleSize) {
          const minSize = Math.min(...centroids.map((ce) => ce.size || 1));
          const maxSize = Math.max(...centroids.map((ce) => ce.size || 1));
          const norm =
            maxSize > minSize ? (c.size - minSize) / (maxSize - minSize) : 0.5;
          markerSize = 16 + norm * 34;
        }

        const segmentLabel = c.segment?.name
          ? `${c.segment.name}`
          : `Segment #${c.segment?.id}`;
        const inheritedText =
          c.inherited === true
            ? "Yes (Inherited)"
            : c.inherited === false
              ? "No (New)"
              : "N/A";

        traces.push({
          x: [pc1Scaled],
          y: [pc2Scaled],
          mode: "markers+text",
          name: `${segmentLabel} (ID: ${c.id})`,
          text: [segmentLabel],
          textposition: "top center",
          textfont: { color: color, size: 12, family: "system-ui" },
          marker: {
            size: [markerSize],
            color: color,
            opacity: 0.85,
            line: { color: "#ffffff", width: 2 },
          },
          hovertemplate:
            `<b>${segmentLabel}</b> (Centroid #${c.id})<br>` +
            `Size: <b>${c.size}</b> auctions<br>` +
            `Inherited: ${inheritedText}<br>` +
            `Total Euclidean Drift: <b>${driftDist}</b><br>` +
            `PC1${pc1Details?.shortName ? ` [${pc1Details.shortName}]` : ""}: <b>%{x:.3f}</b><br>` +
            `PC2${pc2Details?.shortName ? ` [${pc2Details.shortName}]` : ""}: <b>%{y:.3f}</b><extra></extra>`,
        });

        if (showDriftVectors) {
          traces.push({
            x: [pc1Anchor],
            y: [pc2Anchor],
            mode: "markers",
            name: `${segmentLabel} [Anchor]`,
            showlegend: false,
            marker: {
              symbol: "x",
              size: 10,
              color: color,
              opacity: 0.6,
            },
            hoverinfo: "none",
          });

          const dx = pc1Scaled - pc1Anchor;
          const dy = pc2Scaled - pc2Anchor;
          if (Math.hypot(dx, dy) > 0.005) {
            annotations.push({
              ax: pc1Anchor,
              ay: pc2Anchor,
              axref: "x",
              ayref: "y",
              x: pc1Scaled,
              y: pc2Scaled,
              xref: "x",
              yref: "y",
              showarrow: true,
              arrowhead: 2,
              arrowsize: 1.2,
              arrowwidth: 2,
              arrowcolor: color,
              opacity: 0.7,
            });
          }
        }
      });

      const bounds = paddedBounds(traceExtent(traces), AXIS_PAD, 0.05);
      const shapes = buildVoronoiShapes(centroidXY, bounds);

      const pc1Var = ((pcaResult.explainedVarianceRatio[0] || 0) * 100).toFixed(
        1,
      );
      const pc2Var = ((pcaResult.explainedVarianceRatio[1] || 0) * 100).toFixed(
        1,
      );

      return {
        plotData: traces,
        plotLayout: {
          title: {
            text: pc1Details && pc2Details
              ? `PCA 2D Projection • PC1 (${pc1Details.shortName}) vs PC2 (${pc2Details.shortName})`
              : `PCA 2D Projection (PC1: ${pc1Var}%, PC2: ${pc2Var}% variance explained)`,
            font: { color: "#f8fafc", size: 15 },
          },
          xaxis: {
            title: {
              text: `Principal Component 1 (${pc1Var}% var)`,
              font: { color: "#94a3b8" },
            },
            range: [bounds.xMin, bounds.xMax],
          },
          yaxis: {
            title: {
              text: `Principal Component 2 (${pc2Var}% var)`,
              font: { color: "#94a3b8" },
            },
            range: [bounds.yMin, bounds.yMax],
          },
          annotations,
          shapes,
        },
      };
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
    pc1Details,
    pc2Details,
    buildOfferTraces,
    buildHighlightTraces,
    buildVoronoiShapes,
  ]);

  const handlePointClick = (point: any) => {
    const offerId = Array.isArray(point?.customdata)
      ? point.customdata[0]
      : undefined;
    if (typeof offerId === "string" && offerId && onOpenOfferAssignments) {
      onOpenOfferAssignments(offerId);
    }
  };

  const renderClusterCard = (c: Cluster, theme: ReturnType<typeof getRunTheme>) => {
    const isSelected = selectedClusterId === c.id;
    const runId = c.trainingRun?.id;
    const minInertia = minInertiaByRun.get(runId ?? null);
    const isMinInertia =
      c.inertia !== null &&
      c.inertia !== undefined &&
      minInertia !== undefined &&
      Math.abs(c.inertia - minInertia) < 1e-4;

    const markingColor =
      c.marking === "Promoted"
        ? "bg-emerald-950/60 text-emerald-400 border-emerald-700"
        : c.marking === "Candidate"
          ? "bg-amber-950/60 text-amber-400 border-amber-700"
          : "bg-slate-800 text-slate-400 border-slate-700";

    // Subtle backlight glow + green tint for minimal inertia
    const baseBorderAndBg = isSelected
      ? "bg-purple-950/40 border-purple-500 shadow-xl shadow-purple-500/15 ring-2 ring-purple-500/60"
      : isMinInertia
        ? "bg-emerald-950/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.14)] hover:border-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.22)]"
        : `bg-slate-950/60 border-slate-800/80 hover:border-slate-700 ${theme.cardBg}`;

    return (
      <div
        key={c.id}
        onClick={() => setSelectedClusterId(c.id)}
        className={`relative p-3.5 rounded-xl border border-l-4 cursor-pointer transition-all ${theme.cardBorder} ${baseBorderAndBg}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-1.5 flex-wrap">
            <span className="font-bold text-sm text-slate-100">
              Cluster #{c.id}
            </span>
            {runId ? (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border ${theme.badge}`}
                title={`Trained in Pipeline Run #${runId}`}
              >
                Run #{runId}
              </span>
            ) : (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono text-slate-500 border border-slate-800 bg-slate-900"
                title="Training Run not recorded"
              >
                Run —
              </span>
            )}
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium border shrink-0 ${markingColor}`}
          >
            {c.marking}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
          <div>
            <span className="text-slate-500 block">Groups (k)</span>
            <span className="font-semibold text-slate-300">
              {c.segmentCount} segments
            </span>
          </div>
          <InertiaTooltip value={c.inertia} isMin={isMinInertia} />
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>v: {c.vectorVersion?.slice(0, 12)}...</span>
          <span>
            {c.createdAt
              ? new Date(c.createdAt).toLocaleDateString()
              : ""}
          </span>
        </div>
      </div>
    );
  };

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Auction Clusters
            </h2>
            <span className="text-xs text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">
              {clusters.length} total
            </span>
            {uniqueRunIds.filter(Boolean).length > 0 && (
              <span className="text-xs text-indigo-400 px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/80 font-mono">
                {uniqueRunIds.filter(Boolean).length} training batches
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setGroupByRun((g) => !g)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                groupByRun
                  ? "bg-purple-950/70 text-purple-300 border-purple-700 shadow-sm"
                  : "bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title={groupByRun ? "Showing clusters grouped by Training Run" : "Group clusters by Training Run"}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>{groupByRun ? "Grouped by Run" : "Group by Run"}</span>
            </button>
            <button
              onClick={loadClusters}
              disabled={loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Cluster list pills */}
        {groupByRun ? (
          <div className="space-y-4">
            {runGroups.map((group) => {
              const theme = getRunTheme(group.runId, uniqueRunIds);
              return (
                <div
                  key={group.runId ?? "standalone"}
                  className={`p-3.5 sm:p-4 rounded-xl border ${theme.containerBorder} ${theme.containerBg}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span
                        className={`px-2.5 py-0.5 rounded font-mono font-bold text-xs border ${theme.badge}`}
                      >
                        {group.runId
                          ? `Training Run #${group.runId}`
                          : "Untracked Training Batch"}
                      </span>
                      <span className="text-xs text-slate-300 font-medium">
                        {group.clusters.length}{" "}
                        {group.clusters.length === 1 ? "cluster" : "clusters"}
                      </span>
                      {group.createdAt && (
                        <span className="text-xs text-slate-500 font-mono">
                          • {new Date(group.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {group.hasPromoted && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-medium flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Contains Active Promoted Cluster</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {group.clusters.map((c) => renderClusterCard(c, theme))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {clusters.map((c) => {
              const theme = getRunTheme(c.trainingRun?.id, uniqueRunIds);
              return renderClusterCard(c, theme);
            })}
          </div>
        )}
      </div>

      {/* Selected Cluster Overview & Lifecycle Transitions */}
      {selectedClusterDetail && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h3 className="text-lg sm:text-xl font-bold text-slate-100">
                  Cluster #{selectedClusterDetail.id} Overview
                </h3>
                {selectedClusterDetail.trainingRun?.id && (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-medium border ${getRunTheme(selectedClusterDetail.trainingRun.id, uniqueRunIds).badge}`}
                    title={`Trained in Pipeline Run #${selectedClusterDetail.trainingRun.id}`}
                  >
                    Training Run #{selectedClusterDetail.trainingRun.id}
                  </span>
                )}
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium border whitespace-nowrap ${
                    selectedClusterDetail.marking === "Promoted"
                      ? "bg-emerald-950 text-emerald-400 border-emerald-700"
                      : selectedClusterDetail.marking === "Candidate"
                        ? "bg-amber-950 text-amber-400 border-amber-700"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {selectedClusterDetail.marking}
                </span>
                {selectedClusterDetail.promotedAt && (
                  <span className="text-xs text-emerald-400/80 font-mono whitespace-nowrap">
                    Promoted at{" "}
                    {new Date(
                      selectedClusterDetail.promotedAt,
                    ).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 break-words">
                Vector Version:{" "}
                <code className="text-purple-300 font-mono break-all">
                  {selectedClusterDetail.vectorVersion}
                </code>{" "}
                • Feature Set:{" "}
                <code className="text-purple-300 font-mono break-all">
                  {selectedClusterDetail.featureSetVersion}
                </code>{" "}
                •{" "}
                <OverviewInertiaTooltip
                  value={selectedClusterDetail.inertia}
                />
              </p>
            </div>

            {/* Lifecycle Action Buttons */}
            <div className="flex items-center space-x-3">
              {selectedClusterDetail.marking === "Candidate" && (
                <button
                  onClick={() => handlePromote(selectedClusterDetail.id)}
                  disabled={actionLoading}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Promote to Active</span>
                </button>
              )}
              {(selectedClusterDetail.marking === "Candidate" ||
                selectedClusterDetail.marking === "Promoted") && (
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
                  onClick={() => setVizMode("scatter")}
                  className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    vizMode === "scatter"
                      ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>2D Feature Scatter</span>
                </button>
                <button
                  onClick={() => setVizMode("pca")}
                  className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    vizMode === "pca"
                      ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>PCA 2D Projection</span>
                </button>
              </div>

              {/* Feature Selectors (if Scatter Mode) */}
              {vizMode === "scatter" && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-medium">
                      X Axis:
                    </span>
                    <select
                      value={xAxisFeature}
                      onChange={(e) => setXAxisFeature(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                    >
                      {featureNames.map((fn) => (
                        <option key={fn} value={fn}>
                          {FEATURE_GROUPS[fn]?.label || fn} (
                          {FEATURE_GROUPS[fn]?.group || "Other"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-medium">
                      Y Axis:
                    </span>
                    <select
                      value={yAxisFeature}
                      onChange={(e) => setYAxisFeature(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                    >
                      {featureNames.map((fn) => (
                        <option key={fn} value={fn}>
                          {FEATURE_GROUPS[fn]?.label || fn} (
                          {FEATURE_GROUPS[fn]?.group || "Other"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2 border-l border-slate-800 pl-3">
                    <button
                      onClick={() => setUseSourceUnits(!useSourceUnits)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                        useSourceUnits
                          ? "bg-indigo-950/60 text-indigo-300 border-indigo-700"
                          : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-300"
                      }`}
                    >
                      {useSourceUnits ? "Source Units" : "Scaled [-3, 3]"}
                    </button>
                  </div>
                </div>
              )}

              {/* PCA Component Badges (if PCA Mode) */}
              {vizMode === "pca" && pc1Details && pc2Details && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <div
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-purple-800/60 text-xs shadow-sm cursor-help"
                    title={`Principal Component 1 (${pc1Details.variancePercent}% variance explained)\nTop Contributing Features:\n${pc1Details.topDrivers
                      .map(
                        (d) =>
                          `• ${d.label} (${d.group}): ${d.coefficient >= 0 ? "+" : ""}${d.coefficient.toFixed(3)}`,
                      )
                      .join("\n")}`}
                  >
                    <span className="font-semibold text-purple-300">
                      PC1 ({pc1Details.variancePercent}%):
                    </span>
                    <span className="text-slate-200 font-medium">
                      {pc1Details.shortName}
                    </span>
                  </div>

                  <div
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-cyan-800/60 text-xs shadow-sm cursor-help"
                    title={`Principal Component 2 (${pc2Details.variancePercent}% variance explained)\nTop Contributing Features:\n${pc2Details.topDrivers
                      .map(
                        (d) =>
                          `• ${d.label} (${d.group}): ${d.coefficient >= 0 ? "+" : ""}${d.coefficient.toFixed(3)}`,
                      )
                      .join("\n")}`}
                  >
                    <span className="font-semibold text-cyan-300">
                      PC2 ({pc2Details.variancePercent}%):
                    </span>
                    <span className="text-slate-200 font-medium">
                      {pc2Details.shortName}
                    </span>
                  </div>
                </div>
              )}

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
                <label
                  className="flex items-center space-x-2 cursor-pointer"
                  title="Nearest-centroid regions of the 2D projection"
                >
                  <input
                    type="checkbox"
                    checked={showVoronoi}
                    onChange={(e) => setShowVoronoi(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span>Voronoi Regions</span>
                </label>

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
                        ? "loading…"
                        : offersTotal !== undefined &&
                            offersTotal > offers.length
                          ? `${offers.length} of ${offersTotal}`
                          : `${offers.length}`}
                    </span>
                  )}
                </label>
              </div>
            </div>

            {/* Find offer on the chart */}
            <form
              onSubmit={handleFindOffer}
              className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800"
            >
              <div className="flex items-center space-x-2">
                <Crosshair className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-slate-300 font-medium">
                  Find offer:
                </span>
              </div>
              <input
                type="text"
                value={findOfferInput}
                onChange={(e) => setFindOfferInput(e.target.value)}
                placeholder="Offer ID…"
                className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              />
              <button
                type="submit"
                disabled={findOfferLoading || !findOfferInput.trim()}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium"
              >
                {findOfferLoading ? "Looking up…" : "Add to chart"}
              </button>
              <span className="text-[11px] text-slate-500 font-mono">
                {pinnedOffers.length}/{MAX_PINNED_OFFERS}
              </span>
              {pinnedOffers.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPins((prev) =>
                      prev.filter((p) => p.clusterId !== selectedClusterId),
                    );
                    setFindOfferError(null);
                  }}
                  className="inline-flex items-center space-x-1 text-[11px] text-slate-400 hover:text-slate-200"
                  title="Remove all pinned offers"
                >
                  <X className="w-3 h-3" />
                  <span>clear all</span>
                </button>
              )}
              {findOfferError && (
                <span className="text-xs text-rose-300 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{findOfferError}</span>
                </span>
              )}
              {pinnedOffers.length > 0 && (
                <div className="w-full flex flex-wrap gap-2 pt-1">
                  {pinnedOffers.map((a) => {
                    const idx = centroids.findIndex(
                      (c) => c.segment?.id === a.segment?.id,
                    );
                    const color =
                      SEGMENT_COLORS[
                        (idx < 0 ? 0 : idx) % SEGMENT_COLORS.length
                      ];
                    return (
                      <span
                        key={a.offerId}
                        className="inline-flex items-center space-x-2 pl-2 pr-1 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px]"
                        title={`${a.offerId} · ${a.segment?.name || `Segment #${a.segment?.id}`} · distance ${a.distance?.toFixed(4) ?? "—"} · ${a.marking}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-mono text-slate-200">
                          …{a.offerId.slice(-8)}
                        </span>
                        <span className="text-slate-400">
                          {a.segment?.name || `#${a.segment?.id}`}
                        </span>
                        <span className="font-mono text-slate-500">
                          {a.distance?.toFixed(3) ?? "—"}
                        </span>
                        {a.marking === "Pending" && (
                          <span className="text-amber-300">pending</span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setPins((prev) =>
                              prev.filter(
                                (p) =>
                                  !(
                                    p.clusterId === selectedClusterId &&
                                    p.assignment.offerId === a.offerId
                                  ),
                              ),
                            )
                          }
                          className="p-0.5 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800"
                          title="Remove from chart"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </form>

            {/* Plotly Canvas Container */}
            <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950 p-2">
              <PlotlyChart
                data={plotData}
                layout={plotLayout}
                onPointClick={handlePointClick}
              />
              {showVoronoi && (
                <p className="px-2 pb-1 text-[11px] text-slate-500">
                  Voronoi regions are nearest-centroid areas of this 2D
                  projection only; the real assignment uses all 19 features, so
                  an offer can sit in another segment's region here.
                </p>
              )}
              {(showOffers || pinnedOffers.length > 0) && (
                <p className="px-2 pb-1 text-[11px] text-slate-500">
                  Offer points are placed inside their segment's region:
                  centroid distance sets how far from the centroid towards the
                  region edge, the angle is arbitrary (the API exposes no
                  per-offer feature vector). Hover for details, click to open
                  the offer in Assignments.
                </p>
              )}
              {vizMode === "pca" && pc1Details && pc2Details && (
                <div className="mx-1 mt-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 flex flex-col md:flex-row gap-2 md:gap-6 justify-between">
                  <div className="flex items-center space-x-1.5 flex-wrap">
                    <span className="font-semibold text-purple-300">
                      PC1 ({pc1Details.variancePercent}% var):
                    </span>{" "}
                    <span className="text-slate-200 font-medium">
                      {pc1Details.shortName}
                    </span>{" "}
                    <span className="text-slate-500">
                      (
                      {pc1Details.topDrivers
                        .map(
                          (d) =>
                            `${d.label} ${d.coefficient >= 0 ? "+" : ""}${d.coefficient.toFixed(2)}`,
                        )
                        .join(", ")}
                      )
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 flex-wrap">
                    <span className="font-semibold text-cyan-300">
                      PC2 ({pc2Details.variancePercent}% var):
                    </span>{" "}
                    <span className="text-slate-200 font-medium">
                      {pc2Details.shortName}
                    </span>{" "}
                    <span className="text-slate-500">
                      (
                      {pc2Details.topDrivers
                        .map(
                          (d) =>
                            `${d.label} ${d.coefficient >= 0 ? "+" : ""}${d.coefficient.toFixed(2)}`,
                        )
                        .join(", ")}
                      )
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Centroids Table */}
          <div className="mt-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3">
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
                    const drift = centroidDrifts[idx] ?? 0;
                    const driftColor =
                      drift > 0.5
                        ? "text-rose-400"
                        : drift > 0.1
                          ? "text-amber-400"
                          : "text-emerald-400";

                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-medium text-slate-300">
                          #{c.id}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  SEGMENT_COLORS[idx % SEGMENT_COLORS.length],
                              }}
                            />
                            <span className="font-semibold text-slate-200">
                              {c.segment?.name ? (
                                c.segment.name
                              ) : (
                                <i className="text-slate-500 font-normal">
                                  Unnamed
                                </i>
                              )}
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
                                setAuctionsCentroid({
                                  centroid: c,
                                  color:
                                    SEGMENT_COLORS[idx % SEGMENT_COLORS.length],
                                })
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Cluster vs cluster comparison */}
      {selectedClusterDetail && clusters.length > 1 && (
        <ClusterComparison
          clusters={clusters}
          selected={selectedClusterDetail}
        />
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
                  {inspectedCentroid.segment?.name ||
                    `Segment #${inspectedCentroid.segment?.id}`}
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
                19 aggregated features over the feature window. Scaled features
                are normalized via robust IQR scaling:{" "}
                <code>(value - median) / IQR</code>, clipped to ±3. Anchor
                represents the trained baseline.
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
                      const scaledVal = inspectedCentroid.scaled[idx] ?? 0;
                      const anchorVal = inspectedCentroid.anchor[idx] ?? 0;
                      const sourceVal = inspectedCentroid.source[idx] ?? 0;
                      const shift = scaledVal - anchorVal;
                      const meta = FEATURE_GROUPS[fn];

                      return (
                        <tr
                          key={fn}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="px-3.5 py-2 font-semibold text-slate-200">
                            {meta?.label || fn}
                          </td>
                          <td className="px-3.5 py-2 text-slate-400">
                            {meta?.group || "—"}
                          </td>
                          <td className="px-3.5 py-2 text-purple-300">
                            {scaledVal.toFixed(4)}
                          </td>
                          <td className="px-3.5 py-2 text-slate-300">
                            {anchorVal.toFixed(4)}
                          </td>
                          <td className="px-3.5 py-2">
                            <span
                              className={
                                Math.abs(shift) > 0.05
                                  ? shift > 0
                                    ? "text-amber-400"
                                    : "text-indigo-400"
                                  : "text-slate-400"
                              }
                            >
                              {shift > 0
                                ? `+${shift.toFixed(4)}`
                                : shift.toFixed(4)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-slate-400">
                            {sourceVal.toFixed(4)}
                          </td>
                        </tr>
                      );
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
  );
};
