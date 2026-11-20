import type { AssignmentDrift, AuctionDynamics, SegmentTransition } from '../types/clustering'

export interface SegmentFlow {
  segmentId: number
  moves: number
}

/** What is happening around one segment: who is about to leave or arrive, who moved lately and who keeps bouncing. */
export interface SegmentMovement {
  leaving: AuctionDynamics[]
  arriving: AuctionDynamics[]
  movedOut: number
  movedIn: number
  destinations: SegmentFlow[]
  origins: SegmentFlow[]
  cycling: AssignmentDrift[]
}

export interface MovementSummary {
  bySegment: Map<number, SegmentMovement>
  switchingSoon: number
  cycling: number
  busiest: SegmentTransition | null
  /** The forecast list was cut off, so the counts are lower bounds. */
  capped: boolean
}

const empty = (): SegmentMovement => ({ leaving: [], arriving: [], movedOut: 0, movedIn: 0, destinations: [], origins: [], cycling: [] })

/** Groups the forecast (dynamics with a predicted switch), the recent moves and the cycling auctions by segment. */
export function summarizeMovement(dynamics: AuctionDynamics[], transitions: SegmentTransition[], drifts: AssignmentDrift[], capped = false): MovementSummary {
  const bySegment = new Map<number, SegmentMovement>()
  const of = (segmentId: number): SegmentMovement => {
    const movement = bySegment.get(segmentId) ?? empty()
    bySegment.set(segmentId, movement)
    return movement
  }

  const soon = dynamics.filter((row) => row.daysToSwitch !== null && row.predictedSegment !== null)
  for (const row of soon) {
    of(row.segment).leaving.push(row)
    of(row.predictedSegment!).arriving.push(row)
  }

  for (const transition of transitions) {
    const from = of(transition.fromSegmentId)
    from.movedOut += transition.moves
    from.destinations.push({ segmentId: transition.toSegmentId, moves: transition.moves })
    const to = of(transition.toSegmentId)
    to.movedIn += transition.moves
    to.origins.push({ segmentId: transition.fromSegmentId, moves: transition.moves })
  }

  const cycling = drifts.filter((row) => row.cycles > 0)
  for (const row of cycling) of(row.segmentId).cycling.push(row)

  for (const movement of bySegment.values()) {
    movement.leaving.sort((a, b) => a.daysToSwitch! - b.daysToSwitch!)
    movement.arriving.sort((a, b) => a.daysToSwitch! - b.daysToSwitch!)
    movement.destinations.sort((a, b) => b.moves - a.moves)
    movement.origins.sort((a, b) => b.moves - a.moves)
    movement.cycling.sort((a, b) => b.cycles - a.cycles)
  }

  return {
    bySegment,
    switchingSoon: soon.length,
    cycling: cycling.length,
    busiest: transitions.reduce<SegmentTransition | null>((best, row) => (best === null || row.moves > best.moves ? row : best), null),
    capped,
  }
}
