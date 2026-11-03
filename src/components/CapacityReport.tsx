import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, Cpu, Database, HardDrive, MemoryStick, Server, ShieldAlert } from 'lucide-react'
import { PlotlyChart } from './PlotlyChart'
import { benchConfigs, smallBenchConfigs, type BenchConfig, type BenchPhase } from '../data/capacityBench'

const PHASE_LABELS: Record<string, string> = {
  idle_before: 'Idle (30 days loaded)',
  A_daily_ingest: 'Daily ingest (1 day)',
  B_vectorize_read: 'Vectorize read (14-day window)',
  C_train: 'Training (30 k-means runs)',
  D_promote: 'Promote',
  D_assign: 'Daily assign × 7 days',
  E_update: 'Weekly centroid update',
  F_concurrent: 'Assign + vectorize read together',
  idle_after: 'Idle after',
}

const PHASE_COLORS: Record<string, string> = {
  A_daily_ingest: 'rgba(56,189,248,0.10)',
  B_vectorize_read: 'rgba(168,85,247,0.12)',
  C_train: 'rgba(251,191,36,0.08)',
  D_assign: 'rgba(52,211,153,0.10)',
  E_update: 'rgba(244,114,182,0.25)',
  F_concurrent: 'rgba(248,113,113,0.12)',
}

const PHASE_SHORT: Record<string, string> = {
  A_daily_ingest: 'ingest',
  B_vectorize_read: 'vectorize',
  C_train: 'training',
  D_assign: 'assign × 7',
  E_update: 'weekly',
  F_concurrent: 'assign + read',
}

const COMMANDS: { key: string; label: string; cadence: string; osLoad: string }[] = [
  { key: 'assign-auction-segments', label: 'Daily assign', cadence: 'daily (01:00 chain)', osLoad: 'scan 100k vectors with painless distances, then 100k partial updates' },
  { key: 'update-cluster-centroids', label: 'Weekly centroid update', cadence: 'weekly (Mon 03:00)', osLoad: '2 aggregations over ~700k vectors (7 days)' },
  { key: 'train-auction-clusters', label: 'Training', cadence: 'rare (manual / API)', osLoad: '30 × (full scan of 100k vectors + k-means on a 10k sample)' },
  { key: 'promote-auction-cluster', label: 'Promote', cadence: 'manual', osLoad: 'none' },
]

const RECOMMENDED = 'heap-2g'
const CHART_CONFIG = { displayModeBar: false }

const max = (values: number[]): number => Math.max(...values)
const min = (values: number[]): number => Math.min(...values)
const measured = (config: BenchConfig): BenchPhase[] => config.phases.filter((phase) => phase.phase in PHASE_LABELS)
const working = (config: BenchConfig): BenchPhase[] => measured(config).filter((phase) => !phase.phase.startsWith('idle'))
const idleAfter = (config: BenchConfig): BenchPhase | undefined => config.phases.find((phase) => 'idle_after' === phase.phase)
const storageGib = (config: BenchConfig): number => Object.values(config.storage).reduce((sum, entry) => sum + entry.gib, 0)

const Card: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, icon, children, className = '' }) => (
  <section className={`bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl ${className}`}>
    <h2 className="flex items-center space-x-2 text-sm font-semibold text-slate-200 mb-4">
      {icon}
      <span>{title}</span>
    </h2>
    {children}
  </section>
)

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
    <div className="text-xs text-slate-500">{label}</div>
    <div className="text-xl font-semibold text-slate-100 mt-1">{value}</div>
    {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
  </div>
)

const th = 'px-3 py-2 text-left text-xs font-medium text-slate-400 whitespace-nowrap'
const td = 'px-3 py-2 text-xs text-slate-300 whitespace-nowrap tabular-nums'

export const CapacityReport: React.FC = () => {
  const allConfigs = [...benchConfigs, ...smallBenchConfigs]
  const [chartId, setChartId] = useState<string>('small-heap-2g')
  const [phasesId, setPhasesId] = useState<string>(RECOMMENDED)
  const selected = smallBenchConfigs.find((config) => config.id === chartId) ?? smallBenchConfigs[0]
  const phasesConfig = allConfigs.find((config) => config.id === phasesId) ?? benchConfigs[0]
  const recommended = benchConfigs.find((config) => config.id === RECOMMENDED) ?? benchConfigs[0]

  const chart = useMemo(() => {
    const phases = measured(selected).filter((phase) => phase.phase in PHASE_COLORS)
    return {
      data: [
        {
          x: selected.timeline.map((sample) => sample.t / 60),
          y: selected.timeline.map((sample) => sample.heapPct),
          name: 'Heap used %',
          type: 'scatter',
          mode: 'lines',
          line: { color: '#a78bfa', width: 1.5 },
          customdata: selected.timeline.map((sample) => PHASE_LABELS[sample.phase] ?? sample.phase),
          hovertemplate: '%{y:.0f}% heap<br>%{customdata}<extra></extra>',
        },
        {
          x: selected.timeline.map((sample) => sample.t / 60),
          y: selected.timeline.map((sample) => (sample.oldMb / (selected.heapGib * 1024)) * 100),
          name: 'Old gen (live set) %',
          type: 'scatter',
          mode: 'lines',
          line: { color: '#34d399', width: 2 },
          hovertemplate: '%{y:.0f}% old gen<extra></extra>',
        },
        {
          x: selected.timeline.map((sample) => sample.t / 60),
          y: selected.timeline.map((sample) => sample.cpu),
          name: 'CPU % (200 = 2 vCPU)',
          type: 'scatter',
          mode: 'lines',
          yaxis: 'y2',
          line: { color: '#38bdf8', width: 1, dash: 'dot' },
          hovertemplate: '%{y:.0f}% CPU<extra></extra>',
        },
      ],
      layout: {
        margin: { l: 60, r: 60, t: 40, b: 90 },
        legend: { orientation: 'h', y: -0.28, x: 0 },
        xaxis: { title: { text: 'minutes since the data were loaded' } },
        yaxis: { title: { text: '% of heap' }, range: [0, 100] },
        yaxis2: { title: { text: 'CPU %' }, overlaying: 'y', side: 'right', range: [0, 220], showgrid: false },
        shapes: phases.map((phase) => ({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: phase.startS / 60,
          x1: phase.endS / 60,
          y0: 0,
          y1: 1,
          fillcolor: PHASE_COLORS[phase.phase],
          line: { width: 0 },
          layer: 'below',
        })),
        annotations: phases.map((phase, index) => ({
          x: (phase.startS + phase.endS) / 120,
          y: 0 === index % 2 ? 1 : 1.07,
          xref: 'x',
          yref: 'paper',
          yanchor: 'bottom',
          text: PHASE_SHORT[phase.phase] ?? phase.phase,
          showarrow: false,
          font: { size: 10, color: '#94a3b8' },
        })),
      },
    }
  }, [selected])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Clustering capacity</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          How much OpenSearch and PHP the clustering pipeline needs at production scale: 100k products, 100k own offers a day,
          ~7 competitors per product, 30 days retained. Synthetic data on an isolated OpenSearch node, the real Symfony
          commands in production mode (no profiler, no debug), three node sizes at 2 vCPU with heap = 50 % of RAM as on AWS.
        </p>
        <p className="text-xs text-slate-500 mt-1">Bench run 2026-10-29 on OpenSearch 3.5 (x86). All three sizes: 0 circuit-breaker trips, 0 rejected requests, 0 failed commands.</p>
      </header>

      <section className="p-5 rounded-2xl bg-emerald-950/30 border border-emerald-800/70 flex items-start space-x-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-100/90 space-y-1">
          <div className="font-semibold text-emerald-300">Recommendation: c7g.large.search (Graviton3, 2 vCPU, 4 GiB → 2 GiB heap), 1 node, 20 GiB gp3</div>
          <div className="text-emerald-100/70 text-xs">
            Minimum on Graviton: m7g.medium.search (1 vCPU, 4 GiB) — same heap, the daily vectorize read just takes ~2× longer.
            1 GiB heap works but idles at 59–78 % with no room to grow (and AWS has no 2 GiB Graviton node); 4 GiB heap is no
            faster. AWS offers no t4g for OpenSearch. PHP needs &lt; 250 MB per command, well within the 1 GB memory_limit.
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="OpenSearch heap needed" value="2 GiB" hint={`live set ≤ ${max(working(recommended).map((phase) => phase.oldGenPeakMb))} MB`} />
        <Stat label="Node RAM" value="4 GiB" hint={`peak RSS ${max(working(recommended).map((phase) => phase.rssPeakGib)).toFixed(1)} GiB`} />
        <Stat label="Disk, 30 days" value={`${storageGib(recommended).toFixed(1)} GiB`} hint="~175 MB/day; ~15 GiB at 90-day retention" />
        <Stat label="PHP peak (any command)" value={`${max(Object.values(recommended.php).map((entry) => entry.peakMb))} MB`} hint="limit 1 GB" />
      </div>

      <Card title="Node sizes compared" icon={<Server className="w-4 h-4 text-purple-400" />}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={th}>Node</th>
                <th className={th}>Heap peak</th>
                <th className={th}>Heap idle after</th>
                <th className={th}>Live set (old gen)</th>
                <th className={th}>RSS peak</th>
                <th className={th}>GC share max</th>
                <th className={th}>Vectorize read p95</th>
                <th className={th}>p95 under assign</th>
                <th className={th}>Train / assign day</th>
                <th className={th}>Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {benchConfigs.map((config) => {
                const phases = working(config)
                const idle = idleAfter(config)
                const assign = config.php['assign-auction-segments']
                const train = config.php['train-auction-clusters']
                const verdict = config.id === RECOMMENDED ? 'recommended' : config.heapGib < recommended.heapGib ? 'works, no headroom' : 'no gain'
                return (
                  <tr key={config.id} className={config.id === RECOMMENDED ? 'bg-emerald-950/20' : ''}>
                    <td className={td}>
                      <div className="font-medium text-slate-100">{config.ramGib} GiB / {config.heapGib} GiB heap</div>
                      <div className="text-slate-500">{config.label}</div>
                    </td>
                    <td className={td}>{max(phases.map((phase) => phase.heapPeakPct))} %</td>
                    <td className={td}>{idle ? `${idle.heapFloorPct}–${idle.heapPeakPct} %` : '—'}</td>
                    <td className={td}>{min(phases.map((phase) => phase.oldGenPeakMb))}–{max(phases.map((phase) => phase.oldGenPeakMb))} MB</td>
                    <td className={td}>{max(phases.map((phase) => phase.rssPeakGib)).toFixed(1)} / {config.ramGib} GiB</td>
                    <td className={td}>{max(phases.map((phase) => phase.gcSharePct)).toFixed(1)} %</td>
                    <td className={td}>{config.vectorizeRead.p95Ms} ms</td>
                    <td className={td}>{config.vectorizeReadUnderAssign.p95Ms} ms</td>
                    <td className={td}>{train?.wallMaxS ?? '—'} s / {assign?.wallMaxS ?? '—'} s</td>
                    <td className={td}>
                      <span className={`px-2 py-0.5 rounded-full border text-xs ${config.id === RECOMMENDED ? 'border-emerald-700 text-emerald-300' : config.heapGib < recommended.heapGib ? 'border-amber-700 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
                        {verdict}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Heap and CPU over the bench (10k offers, 14 days, training k = 3…20)" icon={<MemoryStick className="w-4 h-4 text-purple-400" />}>
        <div className="flex flex-wrap gap-2 mb-3">
          {smallBenchConfigs.map((config) => (
            <button
              key={config.id}
              onClick={() => setChartId(config.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                config.id === chartId ? 'bg-purple-600/20 text-purple-300 border-purple-500/30' : 'text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {config.ramGib} GiB node · {config.heapGib} GiB heap
            </button>
          ))}
        </div>
        <PlotlyChart data={chart.data} layout={chart.layout} config={CHART_CONFIG} className="w-full h-[420px]" />
        <p className="text-xs text-slate-500 mt-2">
          Heap used saw-tooths with garbage; the green live set (old generation) is what the node really keeps. 5-second samples
          from the 10k run (2026-10-30); the 100k run kept per-phase summaries only.
        </p>
      </Card>

      <Card title={`Phases: ${phasesConfig.offers / 1000}k offers, ${phasesConfig.days} days, ${phasesConfig.ramGib} GiB node`} icon={<Cpu className="w-4 h-4 text-purple-400" />}>
        <div className="flex flex-wrap gap-2 mb-3">
          {allConfigs.map((config) => (
            <button
              key={config.id}
              onClick={() => setPhasesId(config.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                config.id === phasesId ? 'bg-purple-600/20 text-purple-300 border-purple-500/30' : 'text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {config.offers / 1000}k · {config.ramGib} GiB node · {config.heapGib} GiB heap
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={th}>Phase</th>
                <th className={th}>Duration</th>
                <th className={th}>Heap peak</th>
                <th className={th}>Live set</th>
                <th className={th}>GC share</th>
                <th className={th}>CPU avg / peak</th>
                <th className={th}>RSS peak</th>
                <th className={th}>Breaker trips</th>
                <th className={th}>Rejections</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {measured(phasesConfig).map((phase) => (
                <tr key={phase.phase}>
                  <td className={td}>{PHASE_LABELS[phase.phase]}</td>
                  <td className={td}>{phase.durationS} s</td>
                  <td className={td}>{phase.heapPeakPct} %</td>
                  <td className={td}>{phase.oldGenPeakMb} MB</td>
                  <td className={td}>{phase.gcSharePct.toFixed(1)} %</td>
                  <td className={td}>{phase.cpuAvgPct} / {phase.cpuPeakPct} %</td>
                  <td className={td}>{phase.rssPeakGib.toFixed(2)} GiB</td>
                  <td className={td}>{phase.breakerTrips}</td>
                  <td className={td}>{phase.rejections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Per operation (PHP worker, production mode)" icon={<Database className="w-4 h-4 text-purple-400" />}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800">
              <thead>
                <tr>
                  <th className={th}>Operation</th>
                  <th className={th}>Cadence</th>
                  <th className={th}>PHP peak</th>
                  <th className={th}>Wall time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {COMMANDS.map((command) => {
                  const peaks = benchConfigs.map((config) => config.php[command.key]).filter(Boolean)
                  return (
                    <tr key={command.key}>
                      <td className={td}>
                        <div className="text-slate-100">{command.label}</div>
                        <div className="text-slate-500 whitespace-normal max-w-xs">{command.osLoad}</div>
                      </td>
                      <td className={td}>{command.cadence}</td>
                      <td className={td}>{min(peaks.map((entry) => entry.peakMb))}–{max(peaks.map((entry) => entry.peakMb))} MB</td>
                      <td className={td}>{max(peaks.map((entry) => entry.wallMaxS))} s{'assign-auction-segments' === command.key ? ' / day' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Same on every node size. In the dev environment the profiler keeps every OpenSearch request, which inflated
            training to 15.3 GB and assign to 1.7 GB — never size from a dev-mode run.
          </p>
        </Card>

        <Card title="Storage (30 days retained)" icon={<HardDrive className="w-4 h-4 text-purple-400" />}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800">
              <thead>
                <tr>
                  <th className={th}>Index</th>
                  <th className={th}>Daily indices</th>
                  <th className={th}>Lucene docs</th>
                  <th className={th}>Primary store</th>
                  <th className={th}>Per day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {Object.entries(recommended.storage).map(([kind, entry]) => (
                  <tr key={kind}>
                    <td className={td}>{'vectors' === kind ? 'auction-vectors' : 'auction-market-days'}</td>
                    <td className={td}>{entry.indices}</td>
                    <td className={td}>{entry.luceneDocs.toLocaleString('en')}</td>
                    <td className={td}>{entry.gib.toFixed(2)} GiB</td>
                    <td className={td}>{Math.round((entry.gib * 1024) / entry.indices)} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Market-day docs embed nested competitors (1 + ~7 + 1 Lucene docs each). 1 shard, 0 replicas per daily index (~60 shards at steady state). Storage grows linearly with retention
            (28–90 days allowed): ~15 GiB at 90 days, plus headroom for merges.
          </p>
        </Card>
      </div>

      <Card title="Small catalogue run: 10k offers, 14 days, training k = 3…20" icon={<Server className="w-4 h-4 text-purple-400" />}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={th}>Node</th>
                <th className={th}>Heap peak</th>
                <th className={th}>Live set (old gen)</th>
                <th className={th}>RSS peak</th>
                <th className={th}>GC share max</th>
                <th className={th}>Training (90 runs)</th>
                <th className={th}>Assign / day</th>
                <th className={th}>Weekly update</th>
                <th className={th}>Vectorize read p95 (alone / with assign)</th>
                <th className={th}>PHP peak train / assign / update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {smallBenchConfigs.map((config) => {
                const phases = working(config)
                const train = config.php['train-auction-clusters']
                const assign = config.php['assign-auction-segments']
                const update = config.php['update-cluster-centroids']
                return (
                  <tr key={config.id}>
                    <td className={td}>{config.ramGib} GiB / {config.heapGib} GiB heap</td>
                    <td className={td}>{max(phases.map((phase) => phase.heapPeakPct))} %</td>
                    <td className={td}>{min(phases.map((phase) => phase.oldGenPeakMb))}–{max(phases.map((phase) => phase.oldGenPeakMb))} MB</td>
                    <td className={td}>{max(phases.map((phase) => phase.rssPeakGib)).toFixed(1)} / {config.ramGib} GiB</td>
                    <td className={td}>{max(phases.map((phase) => phase.gcSharePct)).toFixed(1)} %</td>
                    <td className={td}>{train ? `${Math.round(train.wallMaxS / 60)} min` : '—'}</td>
                    <td className={td}>~{assign ? Math.round(assign.wallTotalS / assign.runs) : '—'} s</td>
                    <td className={td}>{update?.wallMaxS ?? '—'} s</td>
                    <td className={td}>{config.vectorizeRead.p95Ms} / {config.vectorizeReadUnderAssign.p95Ms} ms</td>
                    <td className={td}>{train?.peakMb} / {assign?.peakMb} / {update?.peakMb} MB</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-slate-400 mt-4 space-y-1.5">
          <div>Both sizes passed: 0 circuit-breaker trips, 0 rejected requests, 0 failed commands. At 10k offers the node keeps ~150 MB of live heap, so a 1 GiB heap is enough; the headroom problem only shows at 100k.</div>
          <div>
            Training time scales with the number of k-means runs, not with offers: ~11 s per run at 10k and ~18 s at 100k (the
            sample is capped at 10k rows; most of a run is fixed overhead — ML task polled every 2 s, temporary index created and
            refreshed). k = 3…20 × 5 restarts ≈ 17 min either way; narrow k or use fewer restarts to shorten it.
          </div>
          <div>Assign scales linearly: ~9 s per day at 10k, ~37 s at 100k. Storage: ~18 MB per day (market days 12 MB, vectors 6 MB).</div>
          <div>
            Synthetic data has 6 groups, so inertia flattens after k = 6 and candidates trained with k ≥ 7 end up with 6–10
            non-empty segments. Each training with k = 3…20 adds 18 candidate clusters (~0.5 MB of MariaDB a month at one training a month).
          </div>
          <div className="text-slate-500">
            Bench shortcut: market days and vectors were generated straight into OpenSearch (what Measure + Vectorize produce); from
            there the real train / promote / assign / update commands ran in production mode.
          </div>
        </div>
      </Card>

      <Card title="Database storage per month (MariaDB, 1 training / month)" icon={<Database className="w-4 h-4 text-purple-400" />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <Stat label="One-off (first month)" value="≈ 32 MB" hint="100k assignment rows incl. indexes" />
          <Stat label="Growth per month" value="≈ 0.2 MB" hint="runs, clusters, centroids, segments" />
          <Stat label="+ offer churn" value="≈ 0.32 MB / 1k new offers" hint="assignments are never deleted" />
          <Stat label="After 12 months" value="≈ 35–55 MB" hint="0–5k new offers / month" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={th}>Table</th>
                <th className={th}>Written by</th>
                <th className={th}>Rows / month</th>
                <th className={th}>Size / row (measured)</th>
                <th className={th}>Growth / month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {[
                ['symfony__cluster_assignment', 'daily assign (upsert, one row per offer)', '0 at a stable catalogue; +1 per new offer', '~320 B (164 B data + ~160 B indexes)', '≈ 32 MB once for 100k offers, then churn only'],
                ['symfony__clustering_run', '30 daily assigns + ~4 weekly updates + 1 training', '~35', '0.4–1 KB JSON summary (~2 KB on disk)', '≈ 70 KB'],
                ['symfony__cluster_centroid', 'training: k = 3..8 → 33 centroids', '33', '~1.1 KB JSON (scaled/source/anchor, 19 floats each)', '≈ 80 KB'],
                ['symfony__cluster', 'training: 6 candidate clusters', '6', '~1.7 KB JSON (feature names + scaler stats)', '≈ 25 KB'],
                ['symfony__auction_segment', 'training: new, non-inherited segments', '≤ 33', '~150 B', '≈ 5 KB'],
                ['symfony__segment_strategy', 'manual (UI / API)', '≈ 0', '—', '—'],
              ].map(([table, writer, rows, size, growth]) => (
                <tr key={table}>
                  <td className={`${td} font-mono text-slate-200`}>{table}</td>
                  <td className={`${td} whitespace-normal`}>{writer}</td>
                  <td className={td}>{rows}</td>
                  <td className={`${td} whitespace-normal`}>{size}</td>
                  <td className={`${td} whitespace-normal`}>{growth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-slate-500 mt-3 space-y-1">
          <div>
            Measured on the bench database (99k assignment rows: 15.6 MB data + 16.1 MB indexes). Small tables are estimated from
            their JSON payload; InnoDB page overhead roughly doubles it.
          </div>
          <div>
            Nothing in the clustering flow deletes rows: assignments of vanished offers, old runs and never-promoted clusters stay.
            At this scale that is a few MB a year — a cleanup job is optional, not required. OpenSearch is separate and does not
            grow: the ISM policy keeps a rolling 30 days (≈ 5.1 GiB).
          </div>
        </div>
      </Card>

      <Card title="AWS OpenSearch Service setup (OpenSearch 3.2, Graviton)" icon={<Cloud className="w-4 h-4 text-purple-400" />}>
        <section className="mb-5 p-4 rounded-xl bg-rose-950/30 border border-rose-800/70 flex items-start space-x-3">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-100/80 space-y-1.5">
            <div className="font-semibold text-rose-300 text-sm">Must have: ML Commons k-means on the domain</div>
            <div>
              Training calls the ML Commons <span className="font-mono text-rose-200">_plugins/_ml/_train/kmeans</span> (async) and{' '}
              <span className="font-mono text-rose-200">_predict/kmeans/&lt;model&gt;</span> APIs and polls{' '}
              <span className="font-mono text-rose-200">_plugins/_ml/tasks/&lt;id&gt;</span>, then deletes the losing models
              (<span className="font-mono text-rose-200">DELETE _plugins/_ml/models/&lt;id&gt;</span>). Without them no cluster can be trained — daily assignment and the
              weekly update depend on a promoted cluster, so the whole clustering flow stops.
            </div>
            <div>
              The ML Commons plugin ships on every AWS OpenSearch version, but the domain must let these tasks run on a data node
              (<span className="font-mono text-rose-200">plugins.ml_commons.only_run_on_ml_node = false</span>, or a dedicated ML node), with memory
              circuit breakers that let a 10k-row × 19-feature training (~1.5 MB) through, and the app's IAM role must be allowed the
              ML endpoints.
            </div>
            <div className="text-rose-200/90">
              Verify on staging before choosing the production domain: run <span className="font-mono">app:price-engine:clustering:train-auction-clusters</span>{' '}
              against it and check the run completes with candidate clusters. If AWS blocks custom k-means training there, the
              training step has to move out of OpenSearch (e.g. PHP/Python k-means on the same 10k sample).
            </div>
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={th}>Minimal working</th>
                <th className={th}>Recommended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {[
                ['Data node', 'm7g.medium.search — Graviton3, 1 vCPU, 4 GiB (2 GiB heap)', 'c7g.large.search — Graviton3, 2 vCPU, 4 GiB (2 GiB heap)'],
                ['Node count', '1, no dedicated master', '1, no dedicated master'],
                ['Storage', '20 GiB gp3 (Graviton3 is gp3 only)', '20 GiB gp3; 30 GiB if retention → 90 days'],
                ['Replicas / Multi-AZ', 'none (the app creates indices with 0 replicas)', 'none — data is rebuildable from the parser history + automated snapshots'],
                ['ML Commons k-means', 'required', 'required'],
                ['Expected behaviour', 'same heap as the bench; daily vectorize read ~70 s (1 vCPU)', 'identical to the measured 4 GiB / 2 vCPU config; vectorize read ~35 s'],
              ].map(([label, minimal, recommendedValue]) => (
                <tr key={label}>
                  <td className={`${td} text-slate-400`}>{label}</td>
                  <td className={`${td} whitespace-normal`}>{minimal}</td>
                  <td className={`${td} whitespace-normal text-emerald-200`}>{recommendedValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-5 text-xs text-slate-400">
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">Not worth it / not available</div>
            <div>m7g.large.search (8 GiB): the 4 GiB-heap run was no faster — keep it as the step up if the catalogue grows a lot.</div>
            <div>No t4g instances exist for OpenSearch Service; t3.small/t3.medium are x86 and "not recommended for production".</div>
            <div>No 2 GiB Graviton node — the 1 GiB-heap config passed but idled at 59–78 % heap.</div>
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">Verify on staging</div>
            <div>ML Commons k-means training (above) — blocking.</div>
            <div>OpenSearch 3.2 on Graviton3 in the target region (AWS: c7g/m7g/r7g support all OpenSearch versions).</div>
            <div>Real Graviton CPU timings — the bench ran on x86.</div>
            <div>PHP workers (ECS): train/assign/update need &lt; 250 MB; measure and vectorize are not measured yet.</div>
          </div>
        </div>
      </Card>

      <section className="p-5 rounded-2xl bg-amber-950/20 border border-amber-800/60 flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-100/80 space-y-1">
          <div className="font-semibold text-amber-300 text-sm">Not covered yet</div>
          <div>PHP memory of measure and vectorize (needs synthetic parser data); vectorize keeps every vector in memory, so measure it before rollout.</div>
          <div>Graviton CPU speed — the bench ran on x86, so timings are relative.</div>
          <div>ML Commons k-means on the AWS domain (see the must-have above).</div>
        </div>
      </section>
    </div>
  )
}
