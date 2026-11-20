import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeMovement } from '../src/utils/segmentMovement.ts'

const dynamics = (offerId: string, segment: number, predictedSegment: number | null, daysToSwitch: number | null) =>
  ({ offerId, productId: 'p', day: '2026-11-18', clusterId: 1, segment, productName: null, runnerUpSegment: predictedSegment, switchMargin: 0.1, switchMarginVelocity: -0.1, speed: 0.1, daysToSwitch, predictedSegment, distances: [], velocity: [] })
const transition = (fromSegmentId: number, toSegmentId: number, moves: number) => ({ fromSegmentId, fromSegmentName: null, toSegmentId, toSegmentName: null, moves, meanFromDistance: 0.6, meanToDistance: 0.3 })
const drift = (offerId: string, segmentId: number, cycles: number) => ({ offerId, productId: 'p', productName: null, segmentId, segmentName: null, moves: cycles + 1, cycles, segments: 2, proposals: 0, cancellations: 0, lastChangeDay: '2026-11-17' })

test('movement is grouped by segment: who leaves, who arrives, who moved and who bounces', () => {
  const summary = summarizeMovement(
    [dynamics('a', 1, 2, 3), dynamics('b', 1, 2, 1), dynamics('c', 2, 1, 5), dynamics('d', 1, null, null)],
    [transition(1, 2, 7), transition(2, 1, 4), transition(1, 3, 9)],
    [drift('x', 1, 2), drift('y', 1, 3), drift('z', 2, 0)],
  )

  assert.equal(summary.switchingSoon, 3)
  assert.equal(summary.cycling, 2)
  assert.deepEqual([summary.busiest?.fromSegmentId, summary.busiest?.toSegmentId], [1, 3])

  const one = summary.bySegment.get(1)!
  assert.deepEqual(one.leaving.map((row) => row.offerId), ['b', 'a'])
  assert.deepEqual(one.arriving.map((row) => row.offerId), ['c'])
  assert.deepEqual([one.movedOut, one.movedIn], [16, 4])
  assert.deepEqual(one.destinations, [{ segmentId: 3, moves: 9 }, { segmentId: 2, moves: 7 }])
  assert.deepEqual(one.cycling.map((row) => row.offerId), ['y', 'x'])
  assert.deepEqual(summary.bySegment.get(3)?.origins, [{ segmentId: 1, moves: 9 }])
  assert.equal(summary.bySegment.get(2)?.cycling.length, 0)
})
