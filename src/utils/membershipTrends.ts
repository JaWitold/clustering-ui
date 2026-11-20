import type { SegmentDailyMembershipTotals } from '../types/clustering'

export type TrendMetric = 'profit' | 'revenue' | 'unitsSold' | 'priceChanges' | 'paidPriceChanges'

export const TREND_METRICS: { key: TrendMetric; label: string; money: boolean }[] = [
  { key: 'profit', label: 'Profit', money: true },
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'unitsSold', label: 'Units sold', money: false },
  { key: 'priceChanges', label: 'Price changes', money: false },
  { key: 'paidPriceChanges', label: 'Paid price changes', money: false },
]

const isMoney = (metric: TrendMetric): boolean => TREND_METRICS.find((m) => m.key === metric)?.money ?? false

/** Money arrives in cents; charts show euros. */
const value = (metric: TrendMetric, raw: number): number => (isMoney(metric) ? raw / 100 : raw)

const label = (segment: SegmentDailyMembershipTotals): string => segment.segmentName || `Segment #${segment.segmentId}`

export const segmentTraces = (daily: SegmentDailyMembershipTotals[], metric: TrendMetric, color: (segmentId: number) => string) =>
  daily.map((segment) => ({
    type: 'scatter' as const,
    mode: 'lines+markers' as const,
    name: label(segment),
    x: segment.days.map((d) => d.day),
    y: segment.days.map((d) => value(metric, d[metric])),
    line: { color: color(segment.segmentId), width: 2 },
    marker: { size: 5 },
  }))

export const stackedTraces = (daily: SegmentDailyMembershipTotals[], metric: TrendMetric, color: (segmentId: number) => string) =>
  daily.map((segment) => ({
    type: 'bar' as const,
    name: label(segment),
    x: segment.days.map((d) => d.day),
    y: segment.days.map((d) => value(metric, d[metric])),
    marker: { color: color(segment.segmentId) },
  }))

export interface SegmentRangeTotal {
  segmentId: number
  name: string
  offers: number
  value: number
}

export const rangeTotals = (daily: SegmentDailyMembershipTotals[], metric: TrendMetric): SegmentRangeTotal[] =>
  daily
    .map((segment) => ({
      segmentId: segment.segmentId,
      name: label(segment),
      offers: segment.offers,
      value: value(metric, segment.days.reduce((sum, d) => sum + d[metric], 0)),
    }))
    .sort((a, b) => b.value - a.value)
