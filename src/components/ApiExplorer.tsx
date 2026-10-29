import React, { useState } from 'react'
import {
  Terminal,
  Send,
  Copy,
  Check,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { apiFetch } from '../api/client'

interface EndpointPreset {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  endpoint: string
  body?: string
}

const PRESETS: EndpointPreset[] = [
  {
    name: '1. List Clusters (Cards)',
    method: 'GET',
    endpoint: '/price-engine/clustering/clusters?sort=-id',
  },
  {
    name: '2. Get Cluster Detail with Centroids',
    method: 'GET',
    endpoint: '/price-engine/clustering/clusters/2',
  },
  {
    name: '3. Train Clusters (Dispatch Worker)',
    method: 'POST',
    endpoint: '/price-engine/clustering/clusters',
    body: JSON.stringify(
      {
        day: '2026-10-28',
        minSegments: 3,
        maxSegments: 5,
        iterations: 50,
        restarts: 5,
      },
      null,
      2,
    ),
  },
  {
    name: '4. Transition Cluster (Promote)',
    method: 'POST',
    endpoint: '/price-engine/clustering/clusters/3/transitions',
    body: JSON.stringify({ transition: 'Promote' }, null, 2),
  },
  {
    name: '5. Transition Cluster (Retire)',
    method: 'POST',
    endpoint: '/price-engine/clustering/clusters/2/transitions',
    body: JSON.stringify({ transition: 'Retire' }, null, 2),
  },
  {
    name: '6. List Pipeline Runs',
    method: 'GET',
    endpoint: '/price-engine/clustering/runs?sort=-id&per-page=10',
  },
  {
    name: '7. Get Run Detail with Summary',
    method: 'GET',
    endpoint: '/price-engine/clustering/runs/3',
  },
  {
    name: '8. List Auction Assignments',
    method: 'GET',
    endpoint: '/price-engine/clustering/assignments?per-page=10',
  },
  {
    name: '9. List Auction Segments',
    method: 'GET',
    endpoint: '/price-engine/clustering/segments',
  },
  {
    name: '10. Rename Segment',
    method: 'PUT',
    endpoint: '/price-engine/clustering/segments/1',
    body: JSON.stringify({ name: 'calm market (renamed)' }, null, 2),
  },
  {
    name: '11. Trigger Measure Market Days',
    method: 'POST',
    endpoint: '/price-engine/clustering/market-days',
    body: JSON.stringify(
      {
        from: '2026-10-21',
        to: '2026-10-28',
      },
      null,
      2,
    ),
  },
  {
    name: '12. Trigger Vectorize Features',
    method: 'POST',
    endpoint: '/price-engine/clustering/feature-vectors',
    body: JSON.stringify({ day: '2026-10-28' }, null, 2),
  },
  {
    name: '13. Trigger Segment Assignment (Daily)',
    method: 'POST',
    endpoint: '/price-engine/clustering/segment-assignments',
    body: JSON.stringify({ day: '2026-10-28' }, null, 2),
  },
  {
    name: '14. Trigger Centroid Update (Weekly)',
    method: 'POST',
    endpoint: '/price-engine/clustering/centroid-updates',
    body: JSON.stringify({ day: '2026-10-28' }, null, 2),
  },
  {
    name: '15. List Segment Strategies',
    method: 'GET',
    endpoint: '/price-engine/clustering/segment-strategies',
  },
  {
    name: '16. Create Segment Strategy Mapping',
    method: 'POST',
    endpoint: '/price-engine/clustering/segment-strategies',
    body: JSON.stringify(
      {
        segment: 3,
        cutStrategy: 'MinimalUndercut',
        hikeStrategy: 'MaxSafe',
        lastFreeChangeCutStrategy: 'Proportional',
        lastFreeChangeHikeStrategy: 'Proportional',
        enabled: true,
        note: 'Tested from API explorer',
      },
      null,
      2,
    ),
  },
]

export const ApiExplorer: React.FC = () => {
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET')
  const [endpoint, setEndpoint] = useState('/price-engine/clustering/clusters')
  const [requestBody, setRequestBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Response state
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({})
  const [responseBody, setResponseBody] = useState<string | null>(null)
  const [latency, setLatency] = useState<number | null>(null)

  const handleSelectPreset = (p: EndpointPreset) => {
    setMethod(p.method)
    setEndpoint(p.endpoint)
    setRequestBody(p.body || '')
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResponseStatus(null)
    setResponseHeaders({})
    setResponseBody(null)
    setLatency(null)

    const start = performance.now()
    try {
      const res = await apiFetch<any>(endpoint, {
        method,
        body: method !== 'GET' && requestBody ? requestBody : undefined,
      })
      const dur = Math.round(performance.now() - start)
      setLatency(dur)
      setResponseStatus(res.status)

      const hdrs: Record<string, string> = {}
      res.headers.forEach((val, key) => {
        hdrs[key] = val
      })
      setResponseHeaders(hdrs)
      setResponseBody(res.data ? JSON.stringify(res.data, null, 2) : '/* Empty response */')
    } catch (err: any) {
      const dur = Math.round(performance.now() - start)
      setLatency(dur)
      setResponseStatus(err?.status || 500)
      setResponseBody(
        err?.data
          ? JSON.stringify(err.data, null, 2)
          : JSON.stringify({ error: err?.message || 'Request failed' }, null, 2),
      )
    } finally {
      setLoading(false)
    }
  }

  const handleCopyResponse = () => {
    if (!responseBody) return
    navigator.clipboard.writeText(responseBody)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <Terminal className="w-5 h-5 text-purple-400" />
              <span>Interactive API Explorer</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Directly invoke and test all 14+ endpoints of the auction clustering flow with real payloads and examine HTTP headers, status codes, and JSON responses.
            </p>
          </div>
        </div>
      </div>

      {/* Main Sandbox Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Presets Menu */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block px-1">
            Endpoint Presets
          </span>
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {PRESETS.map((p) => {
              const methodColor =
                p.method === 'GET'
                  ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800'
                  : p.method === 'POST'
                  ? 'text-blue-400 bg-blue-950/60 border-blue-800'
                  : p.method === 'PUT'
                  ? 'text-amber-400 bg-amber-950/60 border-amber-800'
                  : 'text-rose-400 bg-rose-950/60 border-rose-800'

              return (
                <button
                  key={p.name}
                  onClick={() => handleSelectPreset(p)}
                  className="w-full text-left p-2.5 rounded-xl border border-slate-800/80 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-800/40 transition-all flex items-center justify-between group"
                >
                  <div className="overflow-hidden">
                    <span className="text-xs font-medium text-slate-200 block truncate group-hover:text-purple-300">
                      {p.name}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 block truncate">
                      {p.endpoint}
                    </span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ml-2 ${methodColor}`}>
                    {p.method}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: Request & Response Workbench */}
        <div className="lg:col-span-8 space-y-6">
          {/* Request Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <form onSubmit={handleSend} className="space-y-4">
              <div className="flex items-center space-x-2">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-bold font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>

                <input
                  type="text"
                  required
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="/price-engine/clustering/..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Send</span>
                </button>
              </div>

              {/* Body editor if not GET */}
              {method !== 'GET' && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Request Body (JSON)
                  </label>
                  <textarea
                    rows={4}
                    value={requestBody}
                    onChange={(e) => setRequestBody(e.target.value)}
                    placeholder="{ ... }"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-purple-300 focus:outline-none focus:border-purple-500 resize-y"
                  />
                </div>
              )}
            </form>
          </div>

          {/* Response Inspector */}
          {responseStatus !== null && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-3">
                  <span
                    className={`text-xs px-2.5 py-1 rounded font-bold font-mono border ${
                      responseStatus >= 200 && responseStatus < 300
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : responseStatus >= 400
                        ? 'bg-rose-950 text-rose-400 border-rose-800'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    HTTP {responseStatus}
                  </span>
                  {latency !== null && (
                    <span className="flex items-center space-x-1 text-xs text-slate-400 font-mono">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{latency} ms</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={handleCopyResponse}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Key Pagination / Custom Headers if present */}
              {(responseHeaders['x-pagination-total-count'] ||
                responseHeaders['x-pagination-page-count'] ||
                responseHeaders['content-type']) && (
                <div className="flex flex-wrap gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                  {responseHeaders['x-pagination-total-count'] && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-purple-300">
                      Total: {responseHeaders['x-pagination-total-count']}
                    </span>
                  )}
                  {responseHeaders['x-pagination-page-count'] && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-purple-300">
                      Pages: {responseHeaders['x-pagination-page-count']}
                    </span>
                  )}
                  {responseHeaders['x-pagination-current-page'] && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-purple-300">
                      Page: {responseHeaders['x-pagination-current-page']}
                    </span>
                  )}
                  {responseHeaders['x-debug-token'] && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      Symfony Token: {responseHeaders['x-debug-token']}
                    </span>
                  )}
                </div>
              )}

              {/* Formatted Body */}
              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-purple-300 overflow-x-auto max-h-96">
                {responseBody}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
