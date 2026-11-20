// Serves /v2.0/price-engine/clustering/* from fixtures/data/*.json (in memory; writes are lost on restart).
// Mirrors graph-v2 list/detail serialization groups, Yii filter/sort/search and 0-based pagination headers.
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { addDays, drifts, dynamicsOf, generateChanges, transitions } from './drift.ts'

type Row = Record<string, any>

const PREFIX = '/v2.0/price-engine/clustering'
const PER_PAGE = [10, 20, 100]

const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]))
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')

const CARD: Record<string, string[]> = {
  clusters: ['id', 'segmentCount', 'featureSetVersion', 'vectorVersion', 'marking', 'inertia', 'silhouette', 'trainingRun', 'promotedAt', 'retiredAt', 'createdAt', 'updatedAt'],
  runs: ['id', 'type', 'day', 'cluster', 'marking', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt'],
  segments: ['id', 'name'],
  'segment-strategies': ['id', 'segment', 'cutStrategy', 'hikeStrategy', 'lastFreeChangeCutStrategy', 'lastFreeChangeHikeStrategy', 'enabled'],
  assignments: [],
  memberships: [],
}
const SEARCH: Record<string, string[]> = {
  clusters: ['vectorVersion', 'featureSetVersion', 'openSearchModelId'],
  assignments: ['offerId', 'productId', 'productName'],
  memberships: ['productName', 'offerId', 'productId'],
  segments: ['name'],
  'segment-strategies': ['note'],
}

// Feature names per vector version, as in graph-v2 Version/V1|V2/Model/AuctionFeatures.php
const VECTOR_FEATURES: Record<string, string[]> = {
  v1: ['priceLevel', 'competitors', 'spreadTop3', 'density5Pct', 'changeRateMedian', 'changeRateTop3', 'activeChangers', 'leaderChurn', 'reactionTime', 'reactionTimeMissing', 'cutHikeBalance', 'cutSize', 'hikeSize', 'bestTrend', 'bestAccel', 'bestVolatility', 'gapToBest', 'firstPositionShare', 'undercutRate'],
  v2: ['spreadTop3', 'densityNearBest', 'changeRateTop3', 'activeChangers', 'leaderChurn', 'reactionTime', 'cutHikeBalance', 'cutSize', 'hikeSize', 'bestTrend', 'bestAccel', 'bestVolatility', 'firstPositionShare', 'undercutRate', 'margin', 'salesPerDay', 'priceChangesPerDay', 'profitPerDay'],
}
const VECTOR_SORTS = ['offerId', 'productId', 'productName', 'distance', 'segment']
const HISTORY_SIZE = 100

const filterValue = (row: Row, field: string) => {
  const v = row[field]
  return v !== null && typeof v === 'object' && 'id' in v ? v.id : v
}

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === 'dayFrom') return row.day >= expected
    if (field === 'dayTo') return row.day <= expected
    if (field === 'run') field = 'lastRun'
    const values = Array.isArray(expected) ? expected : expected?.in ?? [expected]
    return values.map(String).includes(String(filterValue(row, field)))
  })
}

function sortRows(rows: Row[], sort: string | null): Row[] {
  const keys = (sort ?? 'id').split(',').filter(Boolean)
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const desc = key.startsWith('-')
      const f = desc ? key.slice(1) : key
      const x = a[f] ?? ''
      const y = b[f] ?? ''
      if (x !== y) return (x < y ? -1 : 1) * (desc ? -1 : 1)
    }
    return 0
  })
}

export function fixturesApi(): Plugin {
  const load = (name: string): Row[] => JSON.parse(readFileSync(new URL(`./data/${name}.json`, import.meta.url), 'utf8'))
  const db: Record<string, Row[]> = Object.fromEntries(Object.keys(CARD).filter((name) => name !== 'memberships').map((name) => [name, load(name)]))

  // Vector versions come from code in graph-v2; here v2 is the promoted default, v1 an on-demand candidate.
  const vectorVersions: Row[] = [
    { id: 1, name: 'v1', marking: 'Candidate', createdAt: now(), updatedAt: now() },
    { id: 2, name: 'v2', marking: 'Promoted', createdAt: now(), updatedAt: now() },
  ]
  // Vectors are derived on the fly: one per assignment per day (no day after today), deterministic per offer, day and version.
  const vectorOf = (version: string, a: Row, day: string): Row => {
    const seed = a.id * 31 + Number(day.replaceAll('-', '')) % 997 + (version === 'v1' ? 7 : 0)
    const promoted = vectorVersions.find((v) => v.name === version)?.marking === 'Promoted'
    return {
      offerId: a.offerId,
      productId: a.productId,
      productName: a.productName,
      day,
      features: Object.fromEntries(VECTOR_FEATURES[version].map((f, j) => [f, Math.round(Math.sin(seed + j * 1.7) * 1e6) / 1e6])),
      segment: promoted ? a.segment.id : null,
      distance: promoted ? a.distance : null,
    }
  }
  const isPastDay = (day: string | null) => !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= new Date().toISOString().slice(0, 10)

  const lastDay = addDays(new Date().toISOString().slice(0, 10), -1)

  // Daily stats per auction come from per-auction rates of production (cluster 54, 2026-11-17…19; money in cents),
  // shaped by the weekday and a few one-off days, and spread unevenly over the auctions of a segment.
  type Stats = { priceChanges: number; paidPriceChanges: number; unitsSold: number; revenue: number; profit: number }
  const METRICS = ['priceChanges', 'paidPriceChanges', 'unitsSold', 'revenue', 'profit'] as const
  const RATES: Record<string, Stats> = {
    'Bestsellery · duży zysk przy niskiej marży': { priceChanges: 16, paidPriceChanges: 9.5, unitsSold: 24, revenue: 71000, profit: 2150 },
    'Wojna cenowa · brak sprzedaży': { priceChanges: 8.5, paidPriceChanges: 0.35, unitsSold: 0.14, revenue: 350, profit: 3 },
    'Niska marża · spokojnie, brak sprzedaży': { priceChanges: 0.25, paidPriceChanges: 0.01, unitsSold: 0.1, revenue: 87, profit: 1.5 },
    'Gonimy lidera · brak sprzedaży': { priceChanges: 8.8, paidPriceChanges: 0.15, unitsSold: 0.2, revenue: 320, profit: 0.9 },
    'Wojna cenowa na kartach podarunkowych · strata': { priceChanges: 19, paidPriceChanges: 13, unitsSold: 1.9, revenue: 2500, profit: -320 },
  }
  // Index = UTC weekday (0 = Sunday): sales peak at the weekend, repricing slows down.
  const SALES_BY_WEEKDAY = [1.12, 0.92, 0.95, 0.97, 1.0, 1.08, 1.18]
  const CHANGES_BY_WEEKDAY = [0.92, 1.05, 1.0, 1.0, 1.0, 0.98, 0.95]
  // One-off days, counted back from yesterday: the shapes seen on production in November.
  const EVENTS: { daysAgo: number; segment: string; changes?: number; sales?: number; profit?: number }[] = [
    { daysAgo: 0, segment: 'Niska marża · spokojnie, brak sprzedaży', changes: 7 },
    { daysAgo: 0, segment: 'Gonimy lidera · brak sprzedaży', sales: 4 },
    { daysAgo: 0, segment: 'Wojna cenowa · brak sprzedaży', sales: 2.4, profit: 6 },
    { daysAgo: 1, segment: 'Wojna cenowa na kartach podarunkowych · strata', sales: 3.5, profit: 2.5 },
    { daysAgo: 6, segment: 'Bestsellery · duży zysk przy niskiej marży', sales: 1.4, profit: 1.6 },
    { daysAgo: 12, segment: 'Wojna cenowa na kartach podarunkowych · strata', changes: 1.6, profit: 1.8 },
    { daysAgo: 20, segment: 'Wojna cenowa · brak sprzedaży', changes: 1.8 },
  ]
  const unit = (n: number) => {
    const x = Math.sin(n) * 43758.5453
    return x - Math.floor(x)
  }
  const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000)
  const daysOf = (from: string, to: string) => {
    const days: string[] = []
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
    return days
  }
  const lastDayNumber = dayNumber(lastDay)
  const ratesBySegmentId = new Map(db.assignments.map((a) => [a.segment.id, RATES[a.segment.name]]))
  const offerDay = (a: Row, day: string): Stats => {
    const rates = ratesBySegmentId.get(a.segment.id)
    const n = dayNumber(day)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    const event = EVENTS.find((e) => e.daysAgo === lastDayNumber - n && RATES[e.segment] === rates)
    const weight = 0.4 + 1.2 * unit(a.id * 7.13)
    const factor = { changes: CHANGES_BY_WEEKDAY[weekday] * (event?.changes ?? 1), sales: SALES_BY_WEEKDAY[weekday] * (event?.sales ?? 1) }
    const stats = {} as Stats
    METRICS.forEach((metric, i) => {
      const scale = metric === 'priceChanges' || metric === 'paidPriceChanges' ? factor.changes : factor.sales * (metric === 'profit' ? (event?.profit ?? 1) : 1)
      const expected = (rates?.[metric] ?? 0) * weight * scale * (0.8 + 0.4 * unit(a.id * 31 + n * 17 + i))
      stats[metric] = Math.floor(expected) + (unit(a.id * 97 + n * 13 + i * 5) < expected - Math.floor(expected) ? 1 : 0)
    })
    return stats
  }
  const sumDays = (a: Row, days: string[]): Stats => {
    const sum = { priceChanges: 0, paidPriceChanges: 0, unitsSold: 0, revenue: 0, profit: 0 }
    for (const day of days) {
      const stats = offerDay(a, day)
      for (const metric of METRICS) sum[metric] += stats[metric]
    }
    return sum
  }
  // Same default as production: yesterday − clustering.feature_window_days (2) through yesterday.
  const rangeOf = (params?: URLSearchParams) => {
    const to = params?.get('to') || lastDay
    return daysOf(params?.get('from') || addDays(to, -2), to)
  }
  const assignmentByOffer = new Map(db.assignments.map((a) => [a.offerId, a]))

  // Memberships are derived from the assignments: the promoted cluster keeps each offer's segment, any other cluster deals offers round-robin.
  let membershipId = 0
  const recordMemberships = (cluster: Row) => {
    db.memberships = db.memberships.filter((m) => m.cluster.id !== cluster.id)
    const window = rangeOf()
    db.assignments.forEach((a, i) => {
      const centroid = cluster.centroids.find((ce: Row) => ce.segment.id === a.segment.id) ?? cluster.centroids[i % cluster.centroids.length]
      db.memberships.push({
        id: ++membershipId,
        cluster: { id: cluster.id },
        segment: centroid.segment,
        offerId: a.offerId,
        productId: a.productId,
        productName: a.productName,
        distance: a.distance ?? 0,
        ...sumDays(a, window),
        statsFrom: window[0],
        statsTo: window[window.length - 1],
        features: Object.fromEntries(cluster.featureNames.map((f: string, j: number) => [f, centroid.source[j]])),
      })
    })
  }
  db.memberships = []
  db.clusters.filter((c) => c.marking === 'Promoted').forEach(recordMemberships)

  const segmentsOf = (clusterId: number) => {
    const bySegment = new Map<number, { segmentId: number; segmentName: string | null; offers: Row[] }>()
    for (const m of db.memberships.filter((r) => r.cluster.id === clusterId)) {
      const entry = bySegment.get(m.segment.id) ?? { segmentId: m.segment.id, segmentName: m.segment.name, offers: [] as Row[] }
      entry.offers.push(assignmentByOffer.get(m.offerId)!)
      bySegment.set(m.segment.id, entry)
    }
    return [...bySegment.values()].sort((a, b) => a.segmentId - b.segmentId)
  }
  const membershipTotals = (clusterId: number, params: URLSearchParams) => {
    const days = rangeOf(params)
    return segmentsOf(clusterId).map(({ segmentId, segmentName, offers }) => {
      const total = { segmentId, segmentName, offers: offers.length, priceChanges: 0, paidPriceChanges: 0, unitsSold: 0, revenue: 0, profit: 0, statsFrom: days[0], statsTo: days[days.length - 1] }
      for (const a of offers) {
        const sum = sumDays(a, days)
        for (const metric of METRICS) total[metric] += sum[metric]
      }
      return total
    })
  }
  const membershipDailyTotals = (clusterId: number, params: URLSearchParams) => {
    const days = rangeOf(params)
    return segmentsOf(clusterId).map(({ segmentId, segmentName, offers }) => ({
      segmentId,
      segmentName,
      offers: offers.length,
      days: days.map((day) => {
        const total = { day, priceChanges: 0, paidPriceChanges: 0, unitsSold: 0, revenue: 0, profit: 0 }
        for (const a of offers) {
          const stats = offerDay(a, day)
          for (const metric of METRICS) total[metric] += stats[metric]
        }
        return total
      }),
    }))
  }

  // Segment history and dynamics are derived from the assignments (see drift.ts); yesterday is the newest day with data.

  const promotedCluster = db.clusters.find((c) => c.marking === 'Promoted')
  const promotedSegments: Row[] = promotedCluster?.centroids.map((ce: Row) => ce.segment) ?? []
  const changes = generateChanges(db.assignments, promotedSegments, lastDay)
  const DYNAMICS_SORTS = ['daysToSwitch', 'switchMargin', 'switchMarginVelocity', 'speed', 'offerId', 'productName']
  const dynamicsDay = (day: string): Row[] =>
    day <= lastDay && day > addDays(lastDay, -30) ? db.assignments.map((a) => dynamicsOf(a, day, lastDay, promotedSegments, promotedCluster?.featureNames ?? [])) : []
  const period = (q: URLSearchParams, res: ServerResponse): [string, string] | null => {
    const from = q.get('from')
    const to = q.get('to')
    if (!from || !to) return invalid(res, from ? 'to' : 'from', 'This value should not be null.'), null
    if (from > to) return invalid(res, 'from', 'The first day must not be after the last day.'), null
    return [from, to]
  }

  function driftRoute(resource: string, offerId: string | undefined, q: URLSearchParams, res: ServerResponse) {
    if (resource === 'assignment-changes') {
      const filter = q.get('filter') ? JSON.parse(q.get('filter')!) : {}
      const one = (expected: any, value: any) => (expected?.in ?? [expected]).map(String).includes(String(value))
      const rows = changes.filter((c) =>
        Object.entries<any>(filter).every(([field, expected]) => {
          if (field === 'dayFrom') return c.day >= (expected.gte ?? expected)
          if (field === 'dayTo') return c.day <= (expected.lte ?? expected)
          if (field === 'fromSegment' || field === 'toSegment') return one(expected, c[field]?.id)
          return one(expected, c[field])
        }),
      )
      return paginate(sortRows(searchRows(rows, ['offerId', 'productName'], q), `${q.get('sort') ?? '-day'},-id`), q, res)
    }
    if (resource === 'assignment-drifts') {
      const range = period(q, res)
      return range ? paginate(drifts(changes, db.assignments, ...range), q, res) : undefined
    }
    if (resource === 'segment-transitions') {
      const range = period(q, res)
      return range ? send(res, 200, transitions(changes, ...range)) : undefined
    }
    if (offerId) {
      const range = period(q, res)
      if (!range) return
      const a = db.assignments.find((r) => r.offerId === offerId)
      const days: string[] = []
      for (let day = range[0] > addDays(lastDay, -29) ? range[0] : addDays(lastDay, -29); a && day <= range[1] && day <= lastDay; day = addDays(day, 1)) days.push(day)
      return send(res, 200, a ? days.map((day) => dynamicsOf(a, day, lastDay, promotedSegments, promotedCluster?.featureNames ?? [])) : [])
    }

    const day = q.get('day')
    if (!day) return invalid(res, 'day', 'This value should not be null.')
    const sort = q.get('sort') ?? 'daysToSwitch'
    const field = sort.replace(/^-/, '')
    if (!DYNAMICS_SORTS.includes(field)) return invalid(res, 'sort', 'The value you selected is not a valid choice.')
    const segment = q.get('segment')
    const direction = sort.startsWith('-') ? -1 : 1
    const rows = searchRows(dynamicsDay(day).filter((r) => !segment || String(r.segment) === segment), ['offerId', 'productId', 'productName'], q)
    rows.sort((x, y) => Number(x[field] === null) - Number(y[field] === null) || direction * (x[field] < y[field] ? -1 : x[field] > y[field] ? 1 : 0) || (x.offerId < y.offerId ? -1 : 1))
    paginate(rows, q, res)
  }

  const promotedSegmentIds = () => new Set(db.clusters.filter((c) => c.marking === 'Promoted').flatMap((c) => c.centroids.map((ce: Row) => ce.segment.id)))
  const clusterDetail = (c: Row) => {
    const promoted = promotedSegmentIds()
    return { ...c, centroids: c.centroids.map((ce: Row) => ({ ...ce, inherited: c.marking === 'Candidate' ? promoted.has(ce.segment.id) : null })) }
  }
  const detail = (resource: string, row: Row) => (resource === 'clusters' ? clusterDetail(row) : row)

  function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
    res.statusCode = status
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    if (body === undefined) return res.end()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const error = (res: ServerResponse, status: number, message: string) => send(res, status, { message, code: 'f1x7u4e0' })
  const invalid = (res: ServerResponse, field: string, message: string) => send(res, 422, [{ field, message }])

  async function readBody(req: IncomingMessage): Promise<Row> {
    let raw = ''
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const searchRows = (rows: Row[], fields: string[], query: URLSearchParams) => {
    const search = query.get('search')?.toLowerCase()
    return search ? rows.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(search))) : rows
  }

  function list(resource: string, query: URLSearchParams, res: ServerResponse) {
    const filter = query.get('filter') ? JSON.parse(query.get('filter')!) : {}
    const rows = sortRows(searchRows(db[resource].filter((r) => matches(r, filter)), SEARCH[resource] ?? [], query), query.get('sort'))
    const keys = CARD[resource]
    paginate(keys.length ? rows.map((r) => pick(r, keys)) : rows, query, res)
  }

  function paginate(rows: Row[], query: URLSearchParams, res: ServerResponse) {
    const page = Number(query.get('page') ?? 0)
    const perPage = Number(query.get('per-page') ?? 20)
    if (!PER_PAGE.includes(perPage) || page < 0 || !Number.isInteger(page)) return invalid(res, 'per-page', 'Invalid pagination parameters.')

    send(res, 200, rows.slice(page * perPage, (page + 1) * perPage), {
      'X-Pagination-Total-Count': String(rows.length),
      'X-Pagination-Page-Count': String(Math.ceil(rows.length / perPage)),
      'X-Pagination-Current-Page': String(page + 1),
      'X-Pagination-Per-Page': String(perPage),
    })
  }

  function transition(cluster: Row, name: string, res: ServerResponse) {
    if (name === 'Promote') {
      if (cluster.marking !== 'Candidate') return error(res, 409, `Cluster ${cluster.id} is not a candidate.`)
      if (db.clusters.some((c) => c.marking === 'Promoted')) return error(res, 409, 'Another cluster is promoted; retire it first.')
      Object.assign(cluster, { marking: 'Promoted', promotedAt: now(), updatedAt: now() })
    } else if (name === 'Retire') {
      if (cluster.marking === 'Retired') return error(res, 409, `Cluster ${cluster.id} is already retired.`)
      Object.assign(cluster, { marking: 'Retired', retiredAt: now(), updatedAt: now() })
    } else {
      return invalid(res, 'transition', 'Choose Promote or Retire.')
    }
    send(res, 200, clusterDetail(cluster))
  }

  async function vectorVersionRoute(req: IncomingMessage, url: URL, res: ServerResponse) {
    const [, name, action, offerId, tail] = url.pathname.slice(PREFIX.length + 1).split('/').map(decodeURIComponent)
    const method = req.method ?? 'GET'
    const q = url.searchParams
    if (!name) return method === 'GET' ? paginate(vectorVersions.map((v) => pick(v, ['id', 'name', 'marking', 'createdAt'])), q, res) : error(res, 405, 'Method not allowed.')

    const version = vectorVersions.find((v) => v.name === name)
    if (!version) return error(res, 404, `No vector version ${name}.`)
    if (!action && method === 'GET') return send(res, 200, version)

    if (action === 'transitions' && method === 'POST') {
      const t = (await readBody(req)).transition
      if (t === 'Promote') {
        if (version.marking !== 'Candidate') return error(res, 409, `Vector version ${name} is not a candidate.`)
        for (const v of vectorVersions.filter((v) => v.marking === 'Promoted')) Object.assign(v, { marking: 'Candidate', updatedAt: now() })
        Object.assign(version, { marking: 'Promoted', updatedAt: now() })
      } else if (t === 'Retire') {
        if (version.marking !== 'Candidate') return error(res, 409, `Only a candidate vector version can be retired; ${name} is ${version.marking}.`)
        Object.assign(version, { marking: 'Retired', updatedAt: now() })
      } else {
        return invalid(res, 'transition', 'Choose Promote or Retire.')
      }
      return send(res, 200, version)
    }

    if (action === 'vectors' && !offerId && method === 'GET') {
      const day = q.get('day')
      if (!day) return invalid(res, 'day', 'This value should not be null.')
      const sort = q.get('sort') ?? 'offerId'
      if (!VECTOR_SORTS.includes(sort.replace(/^-/, ''))) return invalid(res, 'sort', 'The value you selected is not a valid choice.')
      const rows = isPastDay(day) ? db.assignments.map((a) => vectorOf(name, a, day)) : []
      return paginate(sortRows(searchRows(rows, ['offerId', 'productId', 'productName'], q), `${sort},offerId`), q, res)
    }

    if (action === 'offers' && offerId && tail === 'vectors' && method === 'GET') {
      const from = q.get('from')
      const to = q.get('to')
      if (!from || !to) return invalid(res, from ? 'to' : 'from', 'This value should not be null.')
      if (from > to) return invalid(res, 'to', 'The range must not end before it starts.')
      const a = db.assignments.find((r) => r.offerId === offerId)
      const days: string[] = []
      for (let d = new Date(`${from}T00:00:00Z`); a && days.length < HISTORY_SIZE; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10)
        if (day > to || !isPastDay(day)) break
        days.push(day)
      }
      return send(res, 200, a ? days.map((day) => vectorOf(name, a, day)) : [])
    }
    return error(res, 404, 'No route found.')
  }

  function saveStrategy(body: Row, existing: Row | null, res: ServerResponse) {
    const segment = db.segments.find((s) => s.id === Number(existing?.segment.id ?? body.segment))
    if (!segment) return invalid(res, 'segment', 'This segment does not exist.')
    if (!existing && db['segment-strategies'].some((s) => s.segment.id === segment.id)) return error(res, 409, `Segment ${segment.id} already has a strategy mapping.`)
    const fields = ['cutStrategy', 'hikeStrategy', 'lastFreeChangeCutStrategy', 'lastFreeChangeHikeStrategy']
    const missing = fields.find((f) => !body[f])
    if (missing) return invalid(res, missing, 'This value should not be blank.')

    const row = existing ?? { id: Math.max(0, ...db['segment-strategies'].map((s) => s.id)) + 1, segment: { id: segment.id, name: segment.name }, createdAt: now() }
    Object.assign(row, pick(body, fields), { enabled: body.enabled ?? true, note: body.note ?? null, updatedAt: now() })
    if (!existing) db['segment-strategies'].push(row)
    send(res, existing ? 200 : 201, row)
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, 'http://fixtures')
    const [resource, idPart, action] = url.pathname.slice(PREFIX.length + 1).split('/')
    const id = idPart ? Number(idPart) : null
    const method = req.method ?? 'GET'

    if (resource === 'vector-versions') return vectorVersionRoute(req, url, res)
    if (['market-days', 'feature-vectors', 'segment-assignments', 'centroid-updates'].includes(resource) || (resource === 'clusters' && id === null && method === 'POST')) {
      return method === 'POST' ? send(res, 202) : error(res, 405, 'Method not allowed.')
    }
    if (resource === 'memberships' && id === null && method === 'POST') {
      const clusterId = Number((await readBody(req)).cluster)
      const cluster = db.clusters.find((c) => c.id === clusterId)
      if (!cluster) return invalid(res, 'cluster', 'This cluster does not exist.')
      recordMemberships(cluster)
      return send(res, 202)
    }
    if (['assignment-changes', 'assignment-drifts', 'segment-transitions', 'auction-dynamics'].includes(resource)) {
      return method === 'GET' ? driftRoute(resource, resource === 'auction-dynamics' && idPart ? decodeURIComponent(idPart) : undefined, url.searchParams, res) : error(res, 405, 'Method not allowed.')
    }
    if (!(resource in CARD)) return error(res, 404, 'No route found.')
    if (id === null) {
      if (method === 'GET') return list(resource, url.searchParams, res)
      if (method === 'POST' && resource === 'segment-strategies') return saveStrategy(await readBody(req), null, res)
      return error(res, 405, 'Method not allowed.')
    }

    const row = db[resource].find((r) => r.id === id)
    if (!row) return error(res, 404, `No ${resource} row with id ${id}.`)
    if (resource === 'clusters' && action === 'membership-totals' && method === 'GET') return send(res, 200, membershipTotals(row.id, url.searchParams))
    if (resource === 'clusters' && action === 'membership-daily-totals' && method === 'GET') return send(res, 200, membershipDailyTotals(row.id, url.searchParams))
    if (resource === 'clusters' && action === 'transitions' && method === 'POST') return transition(row, (await readBody(req)).transition, res)
    if (action) return error(res, 404, 'No route found.')
    if (method === 'GET' && !['assignments', 'memberships'].includes(resource)) return send(res, 200, detail(resource, row))
    if (method === 'PUT' && resource === 'segments') {
      const name = (await readBody(req)).name
      Object.assign(row, { name: name === '' ? null : name, updatedAt: now() })
      for (const ref of [...db.clusters.flatMap((c) => c.centroids.map((ce: Row) => ce.segment)), ...db.assignments.flatMap((a) => [a.segment, a.candidateSegment]), ...db['segment-strategies'].map((s) => s.segment), ...db.memberships.map((m) => m.segment)]) {
        if (ref?.id === id) ref.name = row.name
      }
      return send(res, 200, row)
    }
    if (method === 'PUT' && resource === 'segment-strategies') return saveStrategy(await readBody(req), row, res)
    if (method === 'DELETE' && resource === 'segment-strategies') {
      db[resource].splice(db[resource].indexOf(row), 1)
      return send(res, 204)
    }
    return error(res, 405, 'Method not allowed.')
  }

  return {
    name: 'clustering-fixtures-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next()
        handle(req, res).catch((e: Error) => error(res, 500, e.message))
      })
    },
  }
}
