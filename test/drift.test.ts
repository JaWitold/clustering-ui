import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drifts, dynamicsOf, generateChanges, transitions } from '../fixtures/drift.ts'

const calm = { id: 1, name: 'calm' }
const war = { id: 2, name: 'war' }
const warm = { id: 3, name: 'warm up' }
const move = (id: number, offerId: string, day: string, from: object, to: object, type = 'Switched') => ({ id, offerId, type, day, fromSegment: from, toSegment: to, fromDistance: 0.6, toDistance: 0.4 })
const assignment = (offerId: string, segment: object) => ({ id: 1, offerId, productId: 'p', productName: null, segment, cluster: { id: 9 }, distance: 0.4, candidateSegment: null })

test('a cycle is a move back into a segment left earlier in the period', () => {
  const changes = [
    move(1, 'a', '2026-10-14', calm, war),
    move(2, 'a', '2026-10-17', war, calm),
    move(3, 'a', '2026-10-20', calm, war),
    move(4, 'b', '2026-10-15', calm, war),
    move(5, 'b', '2026-10-19', war, warm),
    { ...move(6, 'c', '2026-10-18', calm, war, 'Proposed') },
    { ...move(7, 'c', '2026-10-19', calm, war, 'Cancelled') },
  ]
  const rows = drifts(changes, [assignment('a', war), assignment('b', warm), assignment('c', calm)], '2026-10-01', '2026-10-22')

  assert.deepEqual(rows.map((r) => [r.offerId, r.moves, r.cycles, r.segments, r.proposals, r.cancellations]), [
    ['a', 3, 2, 2, 0, 0],
    ['b', 2, 0, 2, 0, 0],
    ['c', 0, 0, 0, 1, 1],
  ])
  assert.deepEqual(drifts(changes, [assignment('a', war), assignment('b', warm), assignment('c', calm)], '2026-10-17', '2026-10-22').find((r) => r.offerId === 'a')?.cycles, 1)
})

test('transitions count moves per segment pair, most moves first', () => {
  const rows = transitions([move(1, 'a', '2026-10-14', calm, war), move(2, 'b', '2026-10-15', calm, war), move(3, 'a', '2026-10-17', war, calm), move(4, 'c', '2026-10-18', calm, war, 'Proposed')], '2026-10-01', '2026-10-22')

  assert.deepEqual(rows.map((r) => [r.fromSegmentName, r.toSegmentName, r.moves, r.meanFromDistance]), [['calm', 'war', 2, 0.6], ['war', 'calm', 1, 0.6]])
})

test('generated history ends on the current segment and dynamics forecast only inside the horizon', () => {
  const assignments = Array.from({ length: 40 }, (_, i) => ({ ...assignment(`o${i}`, [calm, war, warm][i % 3]), id: i + 1 }))
  const changes = generateChanges(assignments, [calm, war, warm], '2026-10-21')

  for (const a of assignments) {
    const moves = changes.filter((c) => c.offerId === a.offerId && (c.type === 'Switched' || c.type === 'New'))
    assert.equal(moves[moves.length - 1].toSegment.id, a.segment.id)
  }
  for (const a of assignments) {
    const row = dynamicsOf(a, '2026-10-21', '2026-10-21', [calm, war, warm], ['margin', 'salesPerDay'])
    assert.ok(row.daysToSwitch === null || (row.daysToSwitch >= 1 && row.daysToSwitch <= 7))
    assert.equal(row.predictedSegment === null, row.daysToSwitch === null)
  }
})
