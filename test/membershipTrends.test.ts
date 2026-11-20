import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeTotals, segmentTraces, stackedTraces } from '../src/utils/membershipTrends.ts'

const color = (segmentId: number) => `#00000${segmentId}`
const day = (d: string, profit: number, unitsSold = 0) => ({ day: d, priceChanges: 0, paidPriceChanges: 0, unitsSold, revenue: 0, profit })
const daily = [
  { segmentId: 1, segmentName: 'calm', offers: 3, days: [day('2026-11-17', 150), day('2026-11-18', -50, 2)] },
  { segmentId: 2, segmentName: null, offers: 1, days: [day('2026-11-17', 0), day('2026-11-18', 1000, 5)] },
]

test('one line per segment, money in euros, named after the segment', () => {
  const traces = segmentTraces(daily, 'profit', color)

  assert.deepEqual(traces.map((t) => [t.name, t.x, t.y]), [
    ['calm', ['2026-11-17', '2026-11-18'], [1.5, -0.5]],
    ['Segment #2', ['2026-11-17', '2026-11-18'], [0, 10]],
  ])
  assert.deepEqual(traces.map((t) => [t.type, t.line.color]), [['scatter', '#000001'], ['scatter', '#000002']])
})

test('counts stay counts', () => {
  assert.deepEqual(segmentTraces(daily, 'unitsSold', color).map((t) => t.y), [[0, 2], [0, 5]])
})

test('stacked bars keep one trace per segment', () => {
  const traces = stackedTraces(daily, 'unitsSold', color)

  assert.deepEqual(traces.map((t) => [t.type, t.name, t.y]), [
    ['bar', 'calm', [0, 2]],
    ['bar', 'Segment #2', [0, 5]],
  ])
})

test('range totals sum the days per segment, largest first', () => {
  assert.deepEqual(rangeTotals(daily, 'profit'), [
    { segmentId: 2, name: 'Segment #2', offers: 1, value: 10 },
    { segmentId: 1, name: 'calm', offers: 3, value: 1 },
  ])
})
