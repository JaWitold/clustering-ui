// Port of graph-v2 symfony/src/Common/DataFixtures/Clustering/ClusteringFixtures.php (feature/auction-clustering).
// Writes API-shaped (detail serialization groups) JSON to fixtures/data/. Usage: node fixtures/generate.ts [YYYY-MM-DD]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TODAY = process.argv[2] ?? '2026-11-13'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data')

const SEED = 42
const OFFERS_PER_PROFILE = 40
const PENDING_PER_PROFILE = 8
const WEEK_DAYS = 7
const NOISE = 0.3
const RETRAIN_SHIFT = 0.08
const SIZE_SPREAD = 0.35
const TRAINING_SECONDS_PER_RUN = 18
const DAILY_SECONDS = 18
const WEEKLY_SECONDS = 3
const TIMEOUT_SECONDS = 30
const SCALED_LIMIT = 3.0
const DRIFT_FEATURE = 'priceLevel'
const FEATURE_SET_VERSION = '3f9a1c27b4e8'
const VECTOR_VERSION = `${FEATURE_SET_VERSION}-a7c41d09`

const SCALER_STATS: Record<string, [number, number]> = {
  priceLevel: [3.0, 1.2],
  competitors: [4.0, 3.0],
  spreadTop3: [0.08, 0.06],
  density5Pct: [1.5, 1.0],
  changeRateMedian: [0.4, 0.5],
  changeRateTop3: [0.8, 0.9],
  activeChangers: [1.0, 1.0],
  leaderChurn: [0.3, 0.3],
  reactionTime: [6.0, 5.0],
  reactionTimeMissing: [0.2, 0.4],
  cutHikeBalance: [0.0, 0.5],
  cutSize: [0.03, 0.03],
  hikeSize: [0.03, 0.03],
  bestTrend: [0.0, 0.01],
  bestAccel: [0.0, 0.002],
  bestVolatility: [0.02, 0.02],
  gapToBest: [0.0, 0.1],
  firstPositionShare: [0.5, 0.4],
  undercutRate: [0.3, 0.3],
}
const FEATURE_NAMES = Object.keys(SCALER_STATS)

const PROFILES: Record<string, Record<string, number>> = {
  'calm market': { competitors: -1.2, changeRateMedian: -1.3, activeChangers: -1.2, leaderChurn: -1.0, bestVolatility: -1.0 },
  'price war': { competitors: 1.3, changeRateMedian: 1.5, changeRateTop3: 1.5, undercutRate: 1.4, cutHikeBalance: -1.2, bestTrend: -1.0 },
  'daily sawtooth': { changeRateMedian: 1.0, cutHikeBalance: 1.3, hikeSize: 1.4, cutSize: 1.2, bestVolatility: 1.5 },
  duopoly: { competitors: -1.5, spreadTop3: 1.4, firstPositionShare: 1.2, leaderChurn: 1.3 },
  'lone seller': { competitors: -2.0, density5Pct: -1.5, firstPositionShare: 2.0, reactionTimeMissing: 2.0 },
  'leader rotation': { leaderChurn: 2.0, firstPositionShare: -1.3, changeRateTop3: 1.0, gapToBest: -1.0 },
  'bot undercutters': { reactionTime: -1.6, undercutRate: 2.0, changeRateTop3: 2.0, cutSize: -1.0 },
  'premium holdouts': { priceLevel: 2.0, gapToBest: 1.8, firstPositionShare: -1.5, changeRateMedian: -0.8 },
  'slow decline': { bestTrend: -2.0, bestAccel: -1.2, cutHikeBalance: -1.0, bestVolatility: -0.8 },
  'flash sales': { cutSize: 2.2, hikeSize: 2.0, bestVolatility: 2.0, bestAccel: 1.2 },
  'crowded stable': { competitors: 2.0, density5Pct: 2.0, changeRateMedian: -1.0, spreadTop3: -1.2 },
  'evening cuts': { reactionTime: 1.8, cutHikeBalance: -1.5, activeChangers: 1.2, priceLevel: -1.0 },
  'follower pack': { activeChangers: 2.0, reactionTime: -1.2, gapToBest: -1.5, spreadTop3: -1.0 },
  'weekend spikes': { hikeSize: 1.6, bestTrend: 1.5, bestAccel: 1.6, cutHikeBalance: 1.0 },
  'thin market': { density5Pct: -2.0, competitors: -0.8, reactionTimeMissing: 1.6, spreadTop3: 1.8 },
  'volatile niche': { bestVolatility: 2.2, priceLevel: 1.4, leaderChurn: 1.2, gapToBest: 1.0 },
}
const LEGACY_PROFILES: Record<string, Record<string, number>> = {
  'bundle resellers': { priceLevel: -1.8, competitors: 0.8, spreadTop3: -1.5, undercutRate: 1.0 },
  'old weekend spikes': { hikeSize: 1.4, bestTrend: 1.2, bestAccel: 1.2 },
}
const PROFILE_NAMES = Object.keys(PROFILES)
const FIRST_MARKET = ['calm market', 'price war', 'daily sawtooth', 'duopoly', 'lone seller', 'leader rotation', 'bundle resellers', 'old weekend spikes']

interface Training {
  daysAgo: number
  restarts: number
  vectors: number
  inherits: number
  firstMarket: boolean
  chosen: number | null
  promotedDaysAgo: number | null
  retiredDaysAgo: number | null
  counts: [number, number, number][] // [segmentCount, inertia, segments]
}

const TRAININGS: Training[] = [
  { daysAgo: 91, restarts: 3, vectors: 320, inherits: 0, firstMarket: true, chosen: 8, promotedDaysAgo: 89, retiredDaysAgo: 59, counts: [[3, 9846.205, 3], [4, 7118.934, 4], [5, 4210.612, 5], [6, 2980.347, 6], [7, 1760.218, 7], [8, 186.441, 8], [9, 185.107, 8], [10, 184.736, 8]] },
  { daysAgo: 61, restarts: 5, vectors: 640, inherits: 6, firstMarket: false, chosen: 10, promotedDaysAgo: 59, retiredDaysAgo: null, counts: [[3, 19862.517, 3], [4, 16431.209, 4], [5, 12900.418, 5], [6, 10650.236, 6], [7, 8930.817, 7], [8, 7410.342, 8], [9, 6020.651, 9], [10, 4780.129, 10]] },
  { daysAgo: 31, restarts: 5, vectors: 640, inherits: 9, firstMarket: false, chosen: null, promotedDaysAgo: null, retiredDaysAgo: null, counts: [[3, 19944.802, 3], [4, 16502.376, 4], [5, 13020.733, 5], [6, 10780.512, 6], [7, 9010.248, 7], [8, 7520.961, 8], [9, 6100.405, 9], [10, 4850.627, 10]] },
  { daysAgo: 2, restarts: 5, vectors: 640, inherits: 10, firstMarket: false, chosen: null, promotedDaysAgo: null, retiredDaysAgo: null, counts: [[3, 19710.384, 3], [4, 16286.551, 4], [5, 12768.093, 5], [6, 10512.718, 6], [7, 8791.462, 7], [8, 7263.905, 8], [9, 5871.236, 9], [10, 4612.358, 10]] },
]

const FAILED_TRAINING_DAYS_AGO = 46
const FAILED_DAILY: Record<number, string> = {
  73: 'OpenSearch request to auction-vectors timed out after 30 seconds.',
  40: 'No feature vectors of version "%s" for %s.',
  12: 'cURL error 7: Failed to connect to opensearch port 9200: Connection refused.',
  1: 'An exception occurred in the driver: SQLSTATE[HY000] [2002] Connection refused',
}
const FAILED_WEEKLY: Record<number, string> = { 5: 'OpenSearch search_phase_execution_exception: all shards failed.' }
const LATEST_WEEKLY_ERROR = 'OpenSearch request to auction-vectors timed out after 30 seconds.'
const DAILY_SWITCHES = [3, 1, 0, 2, 4, 1, 2]
const ABSORBED: Record<string, string> = {
  'crowded stable': 'calm market',
  'evening cuts': 'price war',
  'follower pack': 'bot undercutters',
  'weekend spikes': 'daily sawtooth',
  'thin market': 'duopoly',
  'volatile niche': 'flash sales',
}
const PENDING_CANDIDATES: Record<string, string> = {
  'follower pack': 'leader rotation',
  'weekend spikes': 'flash sales',
  'thin market': 'lone seller',
  'volatile niche': 'premium holdouts',
}
const STRATEGIES: Record<string, [string, string, string, string, boolean, string]> = {
  'calm market': ['MinimalUndercut', 'MaxSafe', 'MinimalUndercut', 'ClosingBisection', true, 'Few changes and few rivals: undercut by the minimum and hike to the safe maximum.'],
  'price war': ['FloorProbe', 'Bisection', 'ProportionalFloorProbe', 'Bisection', true, 'Rivals cut every hour: probe the floor, never chase below it, hike cautiously.'],
  'daily sawtooth': ['Bisection', 'ClosingBisection', 'ProportionalBisection', 'ProportionalClosingBisection', true, 'Prices fall by day and recover at night: bisect cuts, close the gap on hikes.'],
  duopoly: ['FollowerProbe', 'Hybrid', 'FollowerProbe', 'Hybrid', true, 'Two sellers trade first place: follow the leader instead of starting a war.'],
  'lone seller': ['MinimalUndercut', 'ProportionalMaxSafe', 'MinimalUndercut', 'ProportionalMaxSafe', true, 'No real competition: keep the price high and spend free changes on hikes.'],
  'leader rotation': ['Hybrid', 'RelativeHybrid', 'RelativeHybrid', 'RelativeHybrid', true, 'Leader changes daily: hybrid cut, relative hike to stay near the top.'],
  'bot undercutters': ['ProportionalFloorProbe', 'Proportional', 'FloorProbe', 'Proportional', true, 'Repricing bots answer within minutes: do not race, hold the floor.'],
  'premium holdouts': ['Proportional', 'MaxSafe', 'Proportional', 'MaxSafe', true, 'Sellers above the best price that still sell: small proportional cuts only.'],
  'slow decline': ['ProportionalBisection', 'ClosingBisection', 'ProportionalBisection', 'ClosingBisection', true, 'Best price drifts down for weeks: follow the trend, avoid early hikes.'],
  'flash sales': ['RelativeHybrid', 'ProportionalClosingBisection', 'RelativeHybrid', 'ProportionalClosingBisection', false, 'Paused: deep cuts revert within hours and fight the price lanes; offers use the global strategy until reviewed.'],
  'bundle resellers': ['Proportional', 'Proportional', 'Proportional', 'Proportional', false, 'Disabled: segment dropped by the retraining two months ago; its offers moved to price war.'],
  'old weekend spikes': ['Hybrid', 'MaxSafe', 'Hybrid', 'MaxSafe', false, 'Disabled: merged into daily sawtooth by the retraining two months ago.'],
}

// shortcut: mulberry32 instead of PHP Mt19937, so values differ from the PHP fixtures while the structure matches.
function randomizer(seed: number) {
  let a = seed >>> 0
  return {
    getFloat(min: number, max: number): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return min + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min)
    },
  }
}
type Rng = ReturnType<typeof randomizer>

const round = (v: number, p: number) => Math.round(v * 10 ** p) / 10 ** p
const todayMs = Date.parse(`${TODAY}T00:00:00Z`)
const at = (daysAgo: number, h = 0, m = 0, s = 0) => new Date(todayMs + ((-daysAgo * 24 + h) * 3600 + m * 60 + s) * 1000)
const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000)
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00')
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const isoWeekday = (d: Date) => d.getUTCDay() || 7
const offerId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const productId = (n: number) => `00000000-0000-4000-9001-${String(n).padStart(12, '0')}`

const offsets = (profile: string) => {
  const o = PROFILES[profile] ?? LEGACY_PROFILES[profile]
  return FEATURE_NAMES.map((f) => o[f] ?? 0.0)
}
const source = (scaled: number[]) => scaled.map((v, i) => round(v * SCALER_STATS[FEATURE_NAMES[i]][1] + SCALER_STATS[FEATURE_NAMES[i]][0], 6))
const jitter = (rng: Rng, c: number[], spread: number) => c.map((v) => round(Math.max(-SCALED_LIMIT, Math.min(SCALED_LIMIT, v + rng.getFloat(-spread, spread))), 6))
const distance = (a: number[], b: number[]) => round(Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0)), 6)
const weeklyDrift = (index: number) => round(0.05 + 0.02 * (index % 6), 4)
const split = (rng: Rng, total: number, parts: number) => {
  const weights = Array.from({ length: parts }, () => 1.0 + rng.getFloat(-SIZE_SPREAD, SIZE_SPREAD))
  const sum = weights.reduce((a, b) => a + b, 0)
  const sizes = weights.map((w) => Math.floor((total * w) / sum))
  sizes[0] += total - sizes.reduce((a, b) => a + b, 0)
  return sizes
}
const sprintf = (format: string, ...args: string[]) => args.reduce((s, a) => s.replace('%s', a), format)

type Segment = { id: number; name: string | null; createdAt: string; updatedAt: string }
type Run = Record<string, any> & { id: number }
type Cluster = Record<string, any> & { id: number }

const segments: Segment[] = []
const clusters: Cluster[] = []
const runs: Run[] = []
const strategies: Record<string, any>[] = []
const assignments: Record<string, any>[] = []
let centroidId = 0

const card = (s: Segment) => ({ id: s.id, name: s.name })
const newSegment = (name: string | null, finishedAt: Date) => {
  const s = { id: segments.length + 1, name, createdAt: iso(finishedAt), updatedAt: iso(finishedAt) }
  segments.push(s)
  return s
}
const newRun = (type: string, fields: { day: Date; marking: string; startedAt: Date; finishedAt: Date; cluster?: Cluster; error?: string | null; summary?: unknown }): Run => {
  const run = {
    id: runs.length + 1,
    type,
    day: ymd(fields.day),
    cluster: fields.cluster ? { id: fields.cluster.id } : null,
    marking: fields.marking,
    error: fields.error ?? null,
    summary: fields.summary ?? null,
    startedAt: iso(fields.startedAt),
    finishedAt: iso(fields.finishedAt),
    createdAt: iso(fields.startedAt),
    updatedAt: iso(fields.finishedAt),
  }
  runs.push(run)
  return run
}

function dailySummary(index: number, vectors: number, sizes: Map<number, number>, firstMarket: boolean) {
  const ids = [...sizes.keys()]
  const switched = index === 0 ? 0 : DAILY_SWITCHES[index % DAILY_SWITCHES.length]
  const pending = index === 0 ? 0 : 4 + (index % 4)
  const switchedSegment = ids[index % ids.length]
  const bySegment: Record<number, { assigned: number; switched: number }> = {}
  for (const [id, size] of sizes) bySegment[id] = { assigned: size, switched: id === switchedSegment ? switched : 0 }
  const fresh = index === 0 && firstMarket ? vectors : 0
  const promoted = index === 0 && !firstMarket ? vectors : 0
  return { vectors, new: fresh, promoted, unchanged: vectors - fresh - promoted - pending - switched, pending, switched, bySegment }
}

function weeklySummary(week: number, sizes: Map<number, number>) {
  const bySegment: Record<number, { count: number; switchShare: number; step: number; drift: number }> = {}
  let position = 0
  for (const [id, size] of sizes) {
    const step = round(0.02 + 0.005 * (position % 4), 4)
    bySegment[id] = { count: size * WEEK_DAYS, switchShare: round(((week + position) % 5) * 0.012, 4), step, drift: round(Math.min(0.5, step * (week + 1)), 4) }
    position++
  }
  return { segments: sizes.size, moved: sizes.size, skipped: 0, bySegment }
}

type Event = { at: Date; kind: 'training' | 'daily' | 'weekly' | 'failedTraining'; training: number; daysAgo: number }
const events: Event[] = []
const latestWeekly = new Map<number, number>()

TRAININGS.forEach((t, position) => {
  events.push({ at: at(t.daysAgo - 1, 2), kind: 'training', training: position, daysAgo: t.daysAgo })
  if (t.promotedDaysAgo === null) return
  for (let d = t.promotedDaysAgo; d > (t.retiredDaysAgo ?? 0); d--) events.push({ at: at(d - 1, 1), kind: 'daily', training: position, daysAgo: d })
  let firstWindowEnd = t.promotedDaysAgo - WEEK_DAYS
  firstWindowEnd -= (7 - isoWeekday(at(firstWindowEnd)) + WEEK_DAYS) % WEEK_DAYS
  for (let d = firstWindowEnd; d > (t.retiredDaysAgo ?? 0); d -= WEEK_DAYS) {
    events.push({ at: at(d - 1, 3), kind: 'weekly', training: position, daysAgo: d })
    latestWeekly.set(position, d)
  }
})
events.push({ at: at(FAILED_TRAINING_DAYS_AGO - 1, 2), kind: 'failedTraining', training: -1, daysAgo: FAILED_TRAINING_DAYS_AGO })
events.sort((a, b) => a.at.getTime() - b.at.getTime())

const named = new Map<string, Segment>()
const liveClusters = new Map<number, Cluster>()
const liveSizes = new Map<number, Map<number, number>>()
const dailyIndex = new Map<number, number>()
const weeklyIndex = new Map<number, number>()
let lastRun: Run | null = null

for (const event of events) {
  const { daysAgo } = event
  const day = at(daysAgo)

  if (event.kind === 'failedTraining') {
    newRun('Training', { day, marking: 'Failed', error: sprintf(FAILED_DAILY[40], VECTOR_VERSION, ymd(day)), startedAt: event.at, finishedAt: plus(event.at, 3) })
    continue
  }

  const pos = event.training
  const training = TRAININGS[pos]

  if (event.kind === 'daily') {
    const failure = FAILED_DAILY[daysAgo] ?? null
    const sizes = liveSizes.get(pos)!
    const vectors = [...sizes.values()].reduce((a, b) => a + b, 0)
    const run = newRun('DailyAssignment', {
      day,
      marking: failure === null ? 'Completed' : 'Failed',
      cluster: liveClusters.get(pos),
      error: failure === null ? null : sprintf(failure, VECTOR_VERSION, ymd(day)),
      summary: failure === null ? dailySummary(dailyIndex.get(pos)!, vectors, sizes, training.firstMarket) : null,
      startedAt: event.at,
      finishedAt: plus(event.at, failure === null ? DAILY_SECONDS + ((daysAgo * 7) % 9) : TIMEOUT_SECONDS),
    })
    if (failure === null) {
      dailyIndex.set(pos, dailyIndex.get(pos)! + 1)
      lastRun = run
    }
    continue
  }

  if (event.kind === 'weekly') {
    const week = weeklyIndex.get(pos)!
    const failure = FAILED_WEEKLY[week] ?? (training.retiredDaysAgo === null && daysAgo === latestWeekly.get(pos) ? LATEST_WEEKLY_ERROR : null)
    newRun('WeeklyUpdate', {
      day,
      marking: failure === null ? 'Completed' : 'Failed',
      cluster: liveClusters.get(pos),
      error: failure,
      summary: failure === null ? weeklySummary(week, liveSizes.get(pos)!) : null,
      startedAt: event.at,
      finishedAt: plus(event.at, WEEKLY_SECONDS + (daysAgo % 4)),
    })
    weeklyIndex.set(pos, week + 1)
    continue
  }

  const finishedAt = plus(event.at, training.counts.length * training.restarts * TRAINING_SECONDS_PER_RUN + (daysAgo % 37))
  const profiles = training.firstMarket ? FIRST_MARKET : PROFILE_NAMES
  const bySegmentCount: Record<number, { inertia: number; segments: number; inherited: number }> = {}
  for (const [count, inertia, segs] of training.counts) bySegmentCount[count] = { inertia, segments: segs, inherited: Math.min(segs, training.inherits) }
  const run = newRun('Training', {
    day,
    marking: 'Completed',
    summary: { vectors: training.vectors, clusters: training.counts.length, restarts: training.restarts, bySegmentCount },
    startedAt: event.at,
    finishedAt,
  })

  const retrain = randomizer(SEED + training.daysAgo)

  for (const [segmentCount, inertia, segs] of training.counts) {
    const isChosen = segmentCount === training.chosen
    const isLive = isChosen && training.retiredDaysAgo === null
    const sizes = split(retrain, training.vectors, segs)
    const clusterId = clusters.length + 1

    const centroids = profiles.slice(0, segs).map((name, position) => {
      let segment: Segment
      if (position < training.inherits) segment = named.get(name)!
      else if (isChosen) named.set(name, (segment = newSegment(name, finishedAt)))
      else segment = newSegment(null, finishedAt)

      const anchor = isChosen ? offsets(name) : jitter(retrain, offsets(name), RETRAIN_SHIFT)
      const drift = isChosen ? weeklyDrift(position) : 0.0
      const driftAt = FEATURE_NAMES.indexOf(DRIFT_FEATURE)
      const scaled = anchor.map((v, i) => (i === driftAt ? round(v + drift, 4) : v))
      const absorbed = Object.values(ABSORBED).filter((target) => target === name).length

      return {
        id: ++centroidId,
        segment: card(segment),
        scaled,
        source: source(scaled),
        anchor,
        size: isLive ? OFFERS_PER_PROFILE * (1 + absorbed) : isChosen ? OFFERS_PER_PROFILE : sizes[position],
        createdAt: iso(finishedAt),
        updatedAt: iso(finishedAt),
        inherited: null as boolean | null,
      }
    })

    const promotedAt = isChosen ? at(training.promotedDaysAgo!, 9) : null
    const retiredAt = isChosen && training.retiredDaysAgo !== null ? at(training.retiredDaysAgo, 9) : null
    const cluster: Cluster = {
      id: clusterId,
      segmentCount: segs,
      featureNames: FEATURE_NAMES,
      featureSetVersion: FEATURE_SET_VERSION,
      vectorVersion: VECTOR_VERSION,
      scalerStats: { scales: Object.fromEntries(FEATURE_NAMES.map((f) => [f, { center: SCALER_STATS[f][0], scale: SCALER_STATS[f][1] }])) },
      marking: isLive ? 'Promoted' : isChosen ? 'Retired' : 'Candidate',
      openSearchModelId: null,
      inertia,
      silhouette: null,
      trainingRun: { id: run.id },
      promotedAt: promotedAt && iso(promotedAt),
      retiredAt: retiredAt && iso(retiredAt),
      centroids,
      createdAt: iso(finishedAt),
      updatedAt: iso(retiredAt ?? promotedAt ?? finishedAt),
    }
    clusters.push(cluster)

    if (!isChosen) continue

    const assigned = new Map<number, number>()
    for (const name of profiles.slice(0, segs)) {
      const absorbed = Object.values(ABSORBED).filter((target) => target === name).length
      assigned.set(named.get(name)!.id, OFFERS_PER_PROFILE * (1 + (isLive ? absorbed : 0)))
    }
    liveClusters.set(pos, cluster)
    liveSizes.set(pos, assigned)
    dailyIndex.set(pos, 0)
    weeklyIndex.set(pos, 0)
  }
}

const promotedSegmentIds = new Set(clusters.filter((c) => c.marking === 'Promoted').flatMap((c) => c.centroids.map((ce: any) => ce.segment.id)))
for (const c of clusters) {
  if (c.marking !== 'Candidate') continue
  for (const ce of c.centroids) ce.inherited = promotedSegmentIds.has(ce.segment.id)
}

for (const [name, [cut, hike, lastFreeCut, lastFreeHike, enabled, note]] of Object.entries(STRATEGIES)) {
  const segment = named.get(name)!
  const created = new Date(Date.parse(segment.createdAt.slice(0, 10) + 'T00:00:00Z') + (24 * 3600 + 10 * 3600 + 30 * 60) * 1000)
  strategies.push({
    id: strategies.length + 1,
    segment: card(segment),
    cutStrategy: cut,
    hikeStrategy: hike,
    lastFreeChangeCutStrategy: lastFreeCut,
    lastFreeChangeHikeStrategy: lastFreeHike,
    enabled,
    note,
    createdAt: iso(created),
    updatedAt: iso(enabled ? created : at(58, 11, 15)),
  })
}

const finalRun = lastRun!
const rng = randomizer(SEED)
PROFILE_NAMES.forEach((name, position) => {
  const target = ABSORBED[name] ?? name
  const candidate = PENDING_CANDIDATES[name] ?? null
  const anchor = offsets(target)
  for (let offer = 0; offer < OFFERS_PER_PROFILE; offer++) {
    const number = position * OFFERS_PER_PROFILE + offer
    const pending = candidate !== null && offer < PENDING_PER_PROFILE
    assignments.push({
      id: number + 1,
      offerId: offerId(number),
      productId: productId(number),
      cluster: { id: finalRun.cluster.id },
      segment: card(named.get(target)!),
      distance: distance(jitter(rng, offsets(name), NOISE), anchor),
      day: finalRun.day,
      marking: pending ? 'Pending' : 'Stable',
      candidateSegment: pending ? card(named.get(candidate)!) : null,
      candidateSince: pending ? ymd(at((todayMs - Date.parse(`${finalRun.day}T00:00:00Z`)) / 86400000 + (offer % 3) + 1)) : null,
      lastRun: { id: finalRun.id },
      createdAt: finalRun.finishedAt,
      updatedAt: finalRun.finishedAt,
    })
  }
})

mkdirSync(OUT, { recursive: true })
const files = { clusters, runs, assignments, segments, 'segment-strategies': strategies }
for (const [file, rows] of Object.entries(files)) writeFileSync(join(OUT, `${file}.json`), JSON.stringify(rows, null, 2) + '\n')
console.log(`fixtures for ${TODAY}: ${Object.entries(files).map(([f, r]) => `${f}=${r.length}`).join(' ')}`)
