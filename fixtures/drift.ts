// Segment history and dynamics for the mock API: deterministic per auction, aggregated with the same rules as graph-v2
// (move = Promoted/Switched between two segments; cycle = move back into a segment left earlier in the period).
type Row = Record<string, any>

const rand = (id: number, n: number): number => {
  const x = Math.sin(id * 12.9898 + n * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const round = (v: number): number => Math.round(v * 1e6) / 1e6
export const addDays = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const dayIndex = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

export const isMove = (c: Row): boolean => (c.type === 'Switched' || c.type === 'Promoted') && c.fromSegment !== null && c.fromSegment.id !== c.toSegment.id

/** History of every assignment ending on its current segment; `lastDay` is the newest day with data. */
export function generateChanges(assignments: Row[], segments: Row[], lastDay: string): Row[] {
  const changes: Row[] = []
  const event = (a: Row, type: string, day: string, from: Row | null, to: Row, fromDistance: number | null, toDistance: number) => {
    const distances: Record<number, number> = {}
    segments.forEach((s, j) => (distances[s.id] = round(1 + rand(a.id, 40 + j) * 2)))
    if (from) distances[from.id] = fromDistance ?? distances[from.id]
    distances[to.id] = toDistance
    changes.push({ offerId: a.offerId, productId: a.productId, productName: a.productName ?? null, type, day, cluster: a.cluster, run: null, fromSegment: from, toSegment: to, fromDistance, toDistance, distances })
  }

  for (const a of assignments) {
    const moves = [0, 0, 0, 1, 1, 2, 3, 4][Math.floor(rand(a.id, 1) * 8)]
    const others = segments.filter((s) => s.id !== a.segment.id)
    const rival = others[Math.floor(rand(a.id, 2) * others.length)]
    const cycles = moves >= 2 && rand(a.id, 3) < 0.6
    const path: Row[] = [a.segment]
    for (let k = 1; k <= moves; k++) {
      path.unshift(cycles ? (k % 2 === 1 ? rival : a.segment) : others[(Math.floor(rand(a.id, 4) * others.length) + k) % others.length])
    }

    const step = 2 + Math.floor(rand(a.id, 5) * 6)
    event(a, 'New', addDays(lastDay, -(45 + Math.floor(rand(a.id, 6) * 10))), null, path[0], null, round(0.1 + rand(a.id, 7) * 0.5))
    for (let k = 1; k <= moves; k++) {
      const day = addDays(lastDay, -(moves - k) * step - 1)
      const fromDistance = round(0.5 + rand(a.id, 10 + k) * 0.6)
      const toDistance = round(0.1 + rand(a.id, 20 + k) * 0.35)
      event(a, 'Proposed', addDays(day, -2), path[k - 1], path[k], round(fromDistance - 0.05), round(toDistance + 0.05))
      event(a, 'Switched', day, path[k - 1], path[k], fromDistance, toDistance)
    }
    if (rand(a.id, 8) < 0.15) {
      event(a, 'Proposed', addDays(lastDay, -12), a.segment, rival, 0.4, 0.35)
      event(a, 'Cancelled', addDays(lastDay, -11), a.segment, rival, 0.3, 0.5)
    }
    if (a.candidateSegment) event(a, 'Proposed', a.candidateSince ?? lastDay, a.segment, a.candidateSegment, round((a.distance ?? 0.5) + 0.1), round(a.distance ?? 0.5))
  }

  changes.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0))
  changes.forEach((c, i) => {
    c.id = i + 1
    c.createdAt = `${addDays(c.day, 1)}T01:00:00+00:00`
  })
  return changes
}

export function drifts(changes: Row[], assignments: Row[], from: string, to: string): Row[] {
  const byOffer = new Map<string, Row[]>()
  for (const c of changes) {
    if (c.day < from || c.day > to || c.type === 'New') continue
    byOffer.set(c.offerId, [...(byOffer.get(c.offerId) ?? []), c])
  }
  const current = new Map(assignments.map((a) => [a.offerId, a]))
  const rows: Row[] = []
  for (const [offerId, events] of byOffer) {
    const moves = events.filter(isMove)
    const left = new Set<number>()
    let cycles = 0
    for (const m of moves) {
      if (left.has(m.toSegment.id)) cycles++
      left.add(m.fromSegment.id)
    }
    const a = current.get(offerId)!
    rows.push({
      offerId,
      productId: a.productId,
      productName: a.productName ?? null,
      segmentId: a.segment.id,
      segmentName: a.segment.name,
      moves: moves.length,
      cycles,
      segments: new Set(moves.map((m) => m.toSegment.id)).size,
      proposals: events.filter((e) => e.type === 'Proposed' || e.type === 'Restarted').length,
      cancellations: events.filter((e) => e.type === 'Cancelled').length,
      lastChangeDay: events.reduce((max, e) => (e.day > max ? e.day : max), ''),
    })
  }
  return rows.sort((x, y) => y.cycles - x.cycles || y.moves - x.moves || (x.offerId < y.offerId ? -1 : 1))
}

export function transitions(changes: Row[], from: string, to: string): Row[] {
  const pairs = new Map<string, Row>()
  for (const c of changes) {
    if (c.day < from || c.day > to || !isMove(c)) continue
    const key = `${c.fromSegment.id}>${c.toSegment.id}`
    const p = pairs.get(key) ?? { fromSegmentId: c.fromSegment.id, fromSegmentName: c.fromSegment.name, toSegmentId: c.toSegment.id, toSegmentName: c.toSegment.name, moves: 0, fromSum: 0, toSum: 0 }
    p.moves++
    p.fromSum += c.fromDistance ?? 0
    p.toSum += c.toDistance
    pairs.set(key, p)
  }
  return [...pairs.values()]
    .map((p): Row => ({
      fromSegmentId: p.fromSegmentId,
      fromSegmentName: p.fromSegmentName,
      toSegmentId: p.toSegmentId,
      toSegmentName: p.toSegmentName,
      moves: p.moves,
      meanFromDistance: round(p.fromSum / p.moves),
      meanToDistance: round(p.toSum / p.moves),
    }))
    .sort((x, y) => y.moves - x.moves || x.fromSegmentId - y.fromSegmentId || x.toSegmentId - y.toSegmentId)
}

/** Dynamics of one auction on one day: a margin drifting at a per-auction pace, forecast by linear extrapolation up to `horizon` days. */
export function dynamicsOf(a: Row, day: string, lastDay: string, segments: Row[], featureNames: string[], horizon = 7): Row {
  const others = segments.filter((s) => s.id !== a.segment.id)
  const runnerUp = a.candidateSegment ?? others[Math.floor(rand(a.id, 2) * others.length)]
  const pace = (rand(a.id, 31) - 0.62) * 0.12
  const marginAt = (d: string): number => {
    const base = a.candidateSegment ? -(0.05 + rand(a.id, 32) * 0.3) : 0.05 + rand(a.id, 33) * 1.4
    return base + pace * (dayIndex(d) - dayIndex(lastDay)) + 0.015 * Math.sin(dayIndex(d) + a.id)
  }
  const margin = marginAt(day)
  const marginVelocity = margin - marginAt(addDays(day, -1))
  const held = a.distance ?? 0.5
  const steps = margin < 0 ? 1 : marginVelocity < 0 ? Math.ceil(margin / -marginVelocity) : null
  const daysToSwitch = steps !== null && steps <= horizon ? Math.max(1, steps) : null
  const velocity = featureNames.map((feature, j) => ({ feature, value: round(Math.sin(a.id * 1.3 + j * 2.1) * Math.abs(marginVelocity) * (j % 4 === 0 ? 2.2 : 0.6)) }))

  return {
    offerId: a.offerId,
    productId: a.productId,
    day,
    clusterId: a.cluster.id,
    segment: a.segment.id,
    productName: a.productName ?? null,
    runnerUpSegment: runnerUp?.id ?? null,
    switchMargin: runnerUp ? round(margin) : null,
    switchMarginVelocity: runnerUp ? round(marginVelocity) : null,
    speed: round(Math.sqrt(velocity.reduce((sum, v) => sum + v.value ** 2, 0))),
    daysToSwitch,
    predictedSegment: daysToSwitch !== null ? runnerUp?.id ?? null : null,
    distances: segments.map((s, j) => {
      const distance = s.id === a.segment.id ? held : s.id === runnerUp?.id ? held + margin : held + Math.abs(margin) + 0.4 + rand(a.id, 50 + j) * 2
      return { segmentId: s.id, distance: round(distance), previousDistance: round(s.id === runnerUp?.id ? distance - marginVelocity : distance) }
    }),
    velocity,
  }
}
