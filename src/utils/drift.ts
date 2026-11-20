import type { AssignmentChangeType, AuctionSegment } from '../types/clustering'
import { ApiError, getStoredConfig } from '../api/client'
import { TRAITS } from './featureFormat'

export const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

export const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return isoDay(date)
}

export const yesterday = (): string => addDays(isoDay(new Date()), -1)

const SEGMENT_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#2dd4bf', '#818cf8', '#a3e635', '#f87171']

/** Stable color per segment: its position among the known segments. */
export const segmentColor = (id: number, segments: AuctionSegment[]): string => {
  const index = segments.findIndex((s) => s.id === id)
  return SEGMENT_COLORS[(index < 0 ? id : index) % SEGMENT_COLORS.length]
}

export const segmentName = (id: number | null, segments: AuctionSegment[]): string =>
  id === null ? '—' : segments.find((s) => s.id === id)?.name || `Segment #${id}`

export const CHANGE_TYPES: Record<AssignmentChangeType, { label: string; hint: string; className: string }> = {
  New: { label: 'New', hint: 'First segment of the auction', className: 'bg-slate-800 text-slate-300 border-slate-700' },
  Promoted: { label: 'Promoted', hint: 'A newly promoted cluster reassigned the auction', className: 'bg-indigo-950/60 text-indigo-300 border-indigo-800' },
  Proposed: { label: 'Proposed', hint: 'Another segment became the nearest', className: 'bg-amber-950/60 text-amber-300 border-amber-800' },
  Restarted: { label: 'Restarted', hint: 'The candidate was replaced, or its streak started over', className: 'bg-orange-950/60 text-orange-300 border-orange-800' },
  Cancelled: { label: 'Cancelled', hint: 'The held segment is the nearest again', className: 'bg-emerald-950/60 text-emerald-300 border-emerald-800' },
  Switched: { label: 'Switched', hint: 'The candidate was confirmed', className: 'bg-purple-950/70 text-purple-200 border-purple-700' },
}

/** How soon a forecast switch is, as badge classes. */
export const urgencyClass = (days: number): string =>
  days <= 2
    ? 'bg-rose-950/70 text-rose-200 border-rose-700'
    : days <= 4
      ? 'bg-amber-950/60 text-amber-200 border-amber-700'
      : 'bg-sky-950/60 text-sky-200 border-sky-800'

const V2_FEATURE_LABELS: Record<string, string> = {
  densityNearBest: 'Sellers near the best price',
  margin: 'Our margin',
  salesPerDay: 'Sales per day',
  priceChangesPerDay: 'Our price changes per day',
  profitPerDay: 'Profit per day',
}

export const featureLabel = (feature: string): string => TRAITS[feature]?.label ?? V2_FEATURE_LABELS[feature] ?? feature

export const signed = (value: number, digits = 3): string => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`

export const errorMessage = (err: unknown): string => {
  if (err instanceof ApiError && err.status === 403) return 'This view needs the Clustering:report permission (history needs Clustering:list). Check the token in Settings.'
  if (err instanceof ApiError && err.status === 404) return `The backend at ${getStoredConfig().baseUrl} does not have this endpoint yet (segment history / auction dynamics not deployed there).`
  if (err instanceof TypeError) {
    return `Could not reach ${getStoredConfig().baseUrl}: the backend is down, blocks this origin, or does not have this endpoint yet. Check the base URL in Settings (clear it to use fixtures).`
  }
  return err instanceof Error ? err.message : 'Request failed.'
}
