import { api } from './client'
import { summarizeMovement, type MovementSummary } from '../utils/segmentMovement'
import type { AssignmentDrift, AuctionDynamics } from '../types/clustering'

const PAGES = 5

/** Forecast of a day plus moves and cycling auctions of a period, grouped by segment for the business view. */
export async function loadMovement(day: string, from: string, to: string): Promise<MovementSummary> {
  const transitions = api.listSegmentTransitions({ from, to })

  const dynamics: AuctionDynamics[] = []
  let capped = false
  for (let page = 0; page < PAGES; page++) {
    const res = await api.listAuctionDynamics({ day, sort: 'daysToSwitch', page, 'per-page': 100 })
    dynamics.push(...res.dynamics.filter((row) => row.daysToSwitch !== null))
    const exhausted = res.dynamics.length < 100 || res.dynamics.some((row) => row.daysToSwitch === null)
    if (exhausted) break
    capped = page + 1 === PAGES
  }

  const drifts: AssignmentDrift[] = []
  for (let page = 0; page < PAGES; page++) {
    const res = await api.listAssignmentDrifts({ from, to, page, 'per-page': 100 })
    drifts.push(...res.drifts.filter((row) => row.cycles > 0))
    if (res.drifts.length < 100 || res.drifts.some((row) => row.cycles === 0)) break
  }

  return summarizeMovement(dynamics, await transitions, drifts, capped)
}
