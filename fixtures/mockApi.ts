// Serves /v2.0/price-engine/clustering/* from fixtures/data/*.json (in memory; writes are lost on restart).
// Mirrors graph-v2 list/detail serialization groups, Yii filter/sort/search and 0-based pagination headers.
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

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
}
const SEARCH: Record<string, string[]> = {
  clusters: ['vectorVersion', 'featureSetVersion', 'openSearchModelId'],
  assignments: ['offerId', 'productId'],
  segments: ['name'],
  'segment-strategies': ['note'],
}

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
  const db: Record<string, Row[]> = Object.fromEntries(Object.keys(CARD).map((name) => [name, load(name)]))

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

  function list(resource: string, query: URLSearchParams, res: ServerResponse) {
    const page = Number(query.get('page') ?? 0)
    const perPage = Number(query.get('per-page') ?? 20)
    if (!PER_PAGE.includes(perPage) || page < 0 || !Number.isInteger(page)) return invalid(res, 'per-page', 'Invalid pagination parameters.')

    const filter = query.get('filter') ? JSON.parse(query.get('filter')!) : {}
    const search = query.get('search')?.toLowerCase()
    let rows = db[resource].filter((r) => matches(r, filter))
    if (search) rows = rows.filter((r) => (SEARCH[resource] ?? []).some((f) => String(r[f] ?? '').toLowerCase().includes(search)))
    rows = sortRows(rows, query.get('sort'))

    const slice = rows.slice(page * perPage, (page + 1) * perPage)
    const keys = CARD[resource]
    send(res, 200, keys.length ? slice.map((r) => pick(r, keys)) : slice, {
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

    if (['market-days', 'feature-vectors', 'segment-assignments', 'centroid-updates'].includes(resource) || (resource === 'clusters' && id === null && method === 'POST')) {
      return method === 'POST' ? send(res, 202) : error(res, 405, 'Method not allowed.')
    }
    if (!(resource in CARD)) return error(res, 404, 'No route found.')
    if (id === null) {
      if (method === 'GET') return list(resource, url.searchParams, res)
      if (method === 'POST' && resource === 'segment-strategies') return saveStrategy(await readBody(req), null, res)
      return error(res, 405, 'Method not allowed.')
    }

    const row = db[resource].find((r) => r.id === id)
    if (!row) return error(res, 404, `No ${resource} row with id ${id}.`)
    if (resource === 'clusters' && action === 'transitions' && method === 'POST') return transition(row, (await readBody(req)).transition, res)
    if (action) return error(res, 404, 'No route found.')
    if (method === 'GET' && resource !== 'assignments') return send(res, 200, detail(resource, row))
    if (method === 'PUT' && resource === 'segments') {
      const name = (await readBody(req)).name
      Object.assign(row, { name: name === '' ? null : name, updatedAt: now() })
      for (const ref of [...db.clusters.flatMap((c) => c.centroids.map((ce: Row) => ce.segment)), ...db.assignments.flatMap((a) => [a.segment, a.candidateSegment]), ...db['segment-strategies'].map((s) => s.segment)]) {
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
