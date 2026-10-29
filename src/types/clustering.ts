export interface ScalerStat {
  center: number
  scale: number
}

export interface AuctionSegment {
  id: number
  name: string | null
}

export interface Centroid {
  id: number
  segment: AuctionSegment
  scaled: number[]
  source: number[]
  anchor: number[]
  size: number
  inherited?: boolean | null
  createdAt?: string
  updatedAt?: string
}

export type ClusterMarking = 'Candidate' | 'Promoted' | 'Retired'

export interface Cluster {
  id: number
  segmentCount: number
  featureNames?: string[]
  featureSetVersion: string
  vectorVersion: string
  scalerStats?: Record<string, ScalerStat>
  marking: ClusterMarking
  openSearchModelId?: string | null
  inertia: number | null
  silhouette: number | null
  trainingRun?: { id: number } | null
  promotedAt: string | null
  retiredAt: string | null
  centroids?: Centroid[]
  createdAt: string
  updatedAt: string
}

export type RunType = 'Training' | 'DailyAssignment' | 'WeeklyUpdate'
export type RunMarking = 'Pending' | 'Running' | 'Completed' | 'Failed'

export interface ClusteringRun {
  id: number
  type: RunType
  day: string
  cluster?: { id: number } | null
  marking: RunMarking
  summary?: Record<string, any> | null
  error?: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AssignmentMarking = 'Stable' | 'Pending'

export interface ClusterAssignment {
  id: number
  offerId: string
  productId: string
  segment: AuctionSegment
  candidateSegment: AuctionSegment | null
  cluster: { id: number }
  lastRun?: { id: number } | null
  distance: number | null
  marking: AssignmentMarking
  day: string
  candidateSince: string | null
}

export interface SegmentStrategy {
  id: number
  segment: AuctionSegment
  cutStrategy: string
  hikeStrategy: string
  lastFreeChangeCutStrategy: string
  lastFreeChangeHikeStrategy: string
  enabled: boolean
  note: string | null
  createdAt?: string
  updatedAt?: string
}

export const FEATURE_GROUPS: Record<string, { group: string; label: string; description: string }> = {
  priceLevel: { group: 'Price Position', label: 'Price Level', description: 'Log of the best price level of the product' },
  gapToBest: { group: 'Price Position', label: 'Gap to Best', description: 'Our distance to the best price (negative = cheaper)' },
  firstPositionShare: { group: 'Price Position', label: 'First Pos Share', description: 'Share of sweeps in which we held 1st position' },
  competitors: { group: 'Competition', label: 'Competitors', description: 'Average competitors per sweep' },
  spreadTop3: { group: 'Competition', label: 'Spread Top 3', description: 'Relative spread among 3 best prices' },
  density5Pct: { group: 'Competition', label: 'Density 5%', description: 'Competitors within 5% of best price' },
  changeRateMedian: { group: 'Dynamics', label: 'Change Rate (Median)', description: 'Price changes/day for median competitor' },
  changeRateTop3: { group: 'Dynamics', label: 'Change Rate (Top 3)', description: 'Price changes/day for top 3 competitors' },
  activeChangers: { group: 'Dynamics', label: 'Active Changers', description: 'Competitors that changed price at all' },
  leaderChurn: { group: 'Dynamics', label: 'Leader Churn', description: 'How often leader changed' },
  reactionTime: { group: 'Dynamics', label: 'Reaction Time', description: 'Hours until leader undercut' },
  reactionTimeMissing: { group: 'Dynamics', label: 'Reaction Missing Share', description: 'Days without measurable reaction' },
  undercutRate: { group: 'Dynamics', label: 'Undercut Rate', description: 'Share of changes undercutting leader' },
  cutHikeBalance: { group: 'Cuts vs Hikes', label: 'Cut / Hike Balance', description: 'Balance between cuts and hikes (-1 to 1)' },
  cutSize: { group: 'Cuts vs Hikes', label: 'Cut Size', description: 'Typical cut size' },
  hikeSize: { group: 'Cuts vs Hikes', label: 'Hike Size', description: 'Typical hike size' },
  bestTrend: { group: 'Trends', label: 'Best Price Trend', description: 'Best price slope over window' },
  bestAccel: { group: 'Trends', label: 'Best Price Accel', description: 'Best price acceleration' },
  bestVolatility: { group: 'Trends', label: 'Best Volatility', description: 'Best price volatility over window' },
}

export const CUT_STRATEGY_NAMES = [
  'MinimalUndercut',
  'Proportional',
  'Bisection',
  'Hybrid',
  'RelativeHybrid',
  'FollowerProbe',
  'FloorProbe',
  'ProportionalFloorProbe',
  'ProportionalBisection',
]

export const HIKE_STRATEGY_NAMES = [
  'MaxSafe',
  'Proportional',
  'Bisection',
  'Hybrid',
  'RelativeHybrid',
  'ClosingBisection',
  'ProportionalMaxSafe',
  'ProportionalClosingBisection',
]
