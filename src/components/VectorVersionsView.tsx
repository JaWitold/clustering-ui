import React, { useEffect, useState } from 'react'
import { Binary, Search, ChevronLeft, ChevronRight, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react'
import type { FeatureVectorRow, VectorVersion } from '../types/clustering'
import { api } from '../api/client'

const PER_PAGE = 20
const HISTORY_DAYS = 14

const SORTS: [value: string, label: string][] = [
  ['offerId', 'Offer ID'],
  ['productName', 'Product name A–Z'],
  ['-productName', 'Product name Z–A'],
  ['productId', 'Product ID'],
  ['segment', 'Segment'],
  ['distance', 'Distance (closest)'],
  ['-distance', 'Distance (farthest)'],
]

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDay(d)
}

const MARKING_STYLE: Record<string, string> = {
  Promoted: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
  Candidate: 'bg-amber-950/60 text-amber-300 border-amber-800',
  Retired: 'bg-slate-800 text-slate-400 border-slate-700',
}

/** Feature names differ per version and v1/v2 compute same-named features differently, so values stay raw. */
const OfferHistory: React.FC<{ version: string; offerId: string; day: string }> = ({ version, offerId, day }) => {
  const [rows, setRows] = useState<FeatureVectorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .offerVectors(version, offerId, { from: shiftDay(day, 1 - HISTORY_DAYS), to: day })
      .then(setRows)
      .catch((e) => setError(e?.message || 'Failed to load the offer history'))
  }, [version, offerId, day])

  if (error) return <div className="text-rose-300">{error}</div>
  if (!rows) return <div className="text-slate-500">Loading history…</div>
  if (rows.length === 0) return <div className="text-slate-500">No vectors in the last {HISTORY_DAYS} days.</div>

  const names = Object.keys(rows[rows.length - 1].features)
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[11px] font-mono">
        <thead className="text-slate-500">
          <tr>
            <th className="px-2 py-1 text-left">Day</th>
            <th className="px-2 py-1 text-left">Seg</th>
            {names.map((n) => (
              <th key={n} className="px-2 py-1 text-right whitespace-nowrap">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-300">
          {rows.map((r) => (
            <tr key={r.day} className="border-t border-slate-800/60">
              <td className="px-2 py-1 whitespace-nowrap">{r.day}</td>
              <td className="px-2 py-1">{r.segment ?? '—'}</td>
              {names.map((n) => (
                <td key={n} className="px-2 py-1 text-right">
                  {r.features[n] !== undefined ? r.features[n].toFixed(4) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const VectorVersionsView: React.FC = () => {
  const [versions, setVersions] = useState<VectorVersion[]>([])
  const [versionError, setVersionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [version, setVersion] = useState('')
  const [day, setDay] = useState(() => shiftDay(isoDay(new Date()), -1))
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('offerId')
  const [page, setPage] = useState(0)
  const [vectors, setVectors] = useState<FeatureVectorRow[]>([])
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [totalPages, setTotalPages] = useState<number | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadVersions = async () => {
    try {
      const list = await api.listVectorVersions()
      setVersions(list)
      setVersion((current) => current || list.find((v) => v.marking === 'Promoted')?.name || list[0]?.name || '')
    } catch (e: any) {
      setVersionError(e?.message || 'Failed to load vector versions')
    }
  }

  const loadVectors = async () => {
    if (!version) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.listVectors(version, { day, search: search.trim() || undefined, sort, page, 'per-page': PER_PAGE })
      setVectors(res.vectors)
      setTotalCount(res.totalCount)
      setTotalPages(res.totalPages)
    } catch (e: any) {
      setError(e?.message || 'Failed to load vectors')
      setVectors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVersions()
  }, [])

  useEffect(() => {
    setExpanded(null)
    loadVectors()
  }, [version, day, sort, page])

  const transition = async (name: string, t: 'Promote' | 'Retire') => {
    const warning =
      t === 'Promote'
        ? `Promote ${name}? The daily pipeline will measure and vectorize ${name} from now on; the current default goes back to Candidate.`
        : `Retire ${name}? It can no longer be computed or promoted.`
    if (!window.confirm(warning)) return
    setBusy(name)
    setVersionError(null)
    try {
      await api.transitionVectorVersion(name, t)
      await loadVersions()
    } catch (e: any) {
      setVersionError(e?.message || `${t} failed`)
    } finally {
      setBusy(null)
    }
  }

  const control =
    'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500'

  return (
    <div className="space-y-6">
      {/* Versions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
            <Binary className="w-5 h-5 text-purple-400" />
            <span>Vector Versions</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            A version is a feature set defined in code. The promoted one is what the daily pipeline measures, vectorizes and
            assigns; other versions run only on demand from the CLI (<code>--vector-version=v1</code>) for comparison.
          </p>
        </div>

        {versionError && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-2 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{versionError}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {versions.map((v) => (
            <div key={v.name} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <span className="font-mono font-bold text-slate-100">{v.name}</span>
              <span className={`px-2 py-0.5 rounded border text-[11px] ${MARKING_STYLE[v.marking] ?? ''}`}>{v.marking}</span>
              {v.marking === 'Candidate' && (
                <>
                  <button
                    onClick={() => transition(v.name, 'Promote')}
                    disabled={busy !== null}
                    className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white"
                  >
                    Promote
                  </button>
                  <button
                    onClick={() => transition(v.name, 'Retire')}
                    disabled={busy !== null}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300"
                  >
                    Retire
                  </button>
                </>
              )}
            </div>
          ))}
          {versions.length === 0 && !versionError && <span className="text-xs text-slate-500">No versions.</span>}
        </div>
      </div>

      {/* Vector preview toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center gap-3">
          <select value={version} onChange={(e) => { setVersion(e.target.value); setPage(0) }} aria-label="Vector version" className={`${control} font-mono`}>
            {versions.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} · {v.marking}
              </option>
            ))}
          </select>
          <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setPage(0) }} aria-label="Day" className={control} />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (page === 0) loadVectors()
              else setPage(0)
            }}
            className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md"
          >
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Product name, offer or product ID..."
                aria-label="Search vectors"
                maxLength={100}
                className={`${control} w-full pl-9`}
              />
            </div>
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shrink-0">
              Search
            </button>
          </form>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0) }} aria-label="Sort vectors" className={control}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button onClick={loadVectors} disabled={loading} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <span className="text-xs px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/80 font-mono">
            {totalCount ?? '…'} vectors
          </span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-start space-x-3 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3 whitespace-nowrap">Product</th>
                <th className="px-4 py-3 whitespace-nowrap">Offer ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Product ID</th>
                <th className="px-4 py-3 whitespace-nowrap">Segment</th>
                <th className="px-4 py-3 whitespace-nowrap">Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono">
              {vectors.map((v) => (
                <React.Fragment key={v.offerId}>
                  <tr
                    onClick={() => setExpanded(expanded === v.offerId ? null : v.offerId)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <button aria-label={`Show history of ${v.offerId}`} aria-expanded={expanded === v.offerId} className="text-slate-500">
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded === v.offerId ? '' : '-rotate-90'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-200 max-w-xs truncate" title={v.productName ?? undefined}>
                      {v.productName ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-purple-300 whitespace-nowrap">{v.offerId}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{v.productId}</td>
                    <td className="px-4 py-3 text-slate-300">{v.segment ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 text-slate-300">{v.distance !== null ? v.distance.toFixed(4) : '—'}</td>
                  </tr>
                  {expanded === v.offerId && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-slate-950/60">
                        <OfferHistory version={version} offerId={v.offerId} day={day} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {vectors.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No vectors for {version || '—'} on {day}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-800 bg-slate-950/60 text-xs">
          <div className="text-slate-400">
            Page <span className="font-semibold text-slate-200">{page + 1}</span>
            {totalPages !== undefined && <span> of {Math.max(1, totalPages)}</span>}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0 || loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(totalPages !== undefined && page + 1 >= totalPages) || loading}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
