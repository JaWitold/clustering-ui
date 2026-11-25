# Eneba Price Engine • Clustering Lab UI

A dedicated manual testing and 2D visualization dashboard for the Eneba Auction Clustering Flow (`/v2.0/price-engine/clustering`). Built with **React 19**, **Vite**, **TypeScript**, **Tailwind CSS**, and **Plotly.js**.

---

## Quick Start

```bash
cd /home/jawitold/Development/digitalcodes/clustering-ui

# Install dependencies (if not already installed)
npm install

# Start Vite dev server
npm run dev
```

By default, the server runs on `http://localhost:5173`. Open this URL in your browser.

### Standalone mode (no backend)

```bash
npm run dev:fixtures   # serves /v2.0/price-engine/clustering/* from fixtures/data/*.json
npm run fixtures       # regenerate fixtures (optional date: npm run fixtures -- 2026-11-13)
```

`fixtures/generate.ts` ports graph-v2's `ClusteringFixtures` (3 months of trainings, daily/weekly runs incl. failures, 640 assignments, 12 strategies) into API-shaped JSON. `fixtures/mockApi.ts` is a Vite middleware mirroring list/detail serialization groups, Yii filter/sort/search and pagination headers; writes (transitions, renames, strategy CRUD) live in memory until restart, pipeline triggers answer `202`. A base URL saved in Settings overrides the fixture one — clear it to use fixtures.

---

## Key Features & Visualization Modes

### 1. Centroids & Clusters 2D Visualizer
- **Interactive Cluster Cards**: Review **Candidate**, **Promoted**, and **Retired** clusters with segment count, inertia, silhouette, vector version, and timestamps.
- **Promote & Retire Transitions**: One-click promotion of Candidate clusters into active force (`POST /clusters/{id}/transitions`), and cluster retirement.
- **2D Feature-Pair Scatter Plot**:
  - Select any two of the **19 auction features** for the X and Y axes (Price Position, Competition, Dynamics, Cuts vs Hikes, Trends).
  - Toggle between **Scaled Space** (`[-3, 3]`, robust IQR scaling) and **Source Units** (original human units like EUR, counts, hours).
  - **Weekly Drift Vector Arrows**: Renders directional arrows from the trained baseline (`anchor`) to the current updated position (`scaled`).
  - **Dynamic Bubble Sizing**: Proportional to the number of auctions (`size`) in each centroid.
- **PCA (Principal Component Analysis) 2D Projection**:
  - Mathematically projects the 19-dimensional scaled feature space to the first two principal components (**PC1** vs **PC2**).
  - Displays the explained variance percentage for PC1 and PC2.
  - Projects drift vectors onto the PCA plane.
- **19-Feature Inspector Drawer**: Deep-dive comparison of all 19 features (Scaled, Source, Anchor, Weekly Shift) for any selected centroid.

### 2. Pipeline Workflows & Triggers
- **Stage 1 — Measure Market Days** (`POST /market-days`): Select date ranges (with presets for "Yesterday", "Last 7 Days") to trigger parser replay.
- **Stage 2 — Vectorize Auction Features** (`POST /feature-vectors`): Select target day to aggregate 19 features over the 14-day feature window.
- **Stage 3 — Train Auction Clusters** (`POST /clusters`): Tune `minSegments`, `maxSegments`, `iterations`, and `restarts` to run k-means in ML Commons.
- **Stage 4 — Assign Segments** (`POST /segment-assignments`): Queue the daily assignment of a finished day's auctions to the promoted cluster's segments (hysteresis applies; deduplicated per day).
- **Stage 5 — Update Centroids** (`POST /centroid-updates`): Queue the weekly anchored centroid step for the window ending on a day (skipped when the window overlaps a previous update; deduplicated per day).

### 3. Pipeline Runs Monitor (`GET /runs`, `GET /runs/{id}`)
- Real-time monitoring of `Training`, `DailyAssignment`, and `WeeklyUpdate` runs.
- Configurable **Auto-Refresh** (every 5 seconds) to track asynchronous runs.
- Filter by run type, execution marking (`Completed`, `Running`, `Pending`, `Failed`), and target cluster.
- Modal JSON viewer for run summaries (inertia per $k$, inherited segments, switch counts) and error traces.

### 4. Auction Segment Assignments (`GET /assignments`)
- Filterable table of our offer assignments under the active cluster.
- Search by `offerId`, filter by `segment` and hysteresis status (`Stable` vs `Pending`).
- Distance to centroid and `candidateSince` tracking for hysteresis streaks.

### 5. Segments & Strategy Mappings (`/segments`, `/segment-strategies`)
- List and inline rename auction segments (`PUT /segments/{id}`).
- Full CRUD for Task 15 Segment Strategies: map segments to `CutStrategyName` and `HikeStrategyName`, plus last-free-change strategies.

### 6. Segment movement in the business view, Drift & Forecast for analysts (`/auction-dynamics`, `/assignment-drifts`, `/segment-transitions`, `/assignment-changes`)
- **Segments (business view)**, live grouping only: a "Segment stability" bar (auctions expected to change segment within a week, auctions bouncing in the last 14 days, busiest route) and a **Movement** column per segment (leaving soon, joining soon, bouncing). Clicking it opens the segment's movement drawer: who is about to leave or join and when, whether their pricing strategy changes with the move, where auctions went and came from, and the bouncing auctions. Any auction opens the drill-down. If the movement endpoints are unavailable the view simply shows no movement.
- **Drift & Forecast** is an Admin tab with the detailed panels below; the business view links to it.
- **Forecast**: auctions of a day ordered by the soonest predicted segment switch, with the predicted segment, the switch margin (distance to the runner-up minus distance to the held segment), its daily change and the auction's speed. Tiles count switches expected tomorrow, in 2–3 and in 4–7 days.
- **Drift**: auctions that changed in a period — moves, cycles (a move back into a segment left earlier in the period), distinct segments, proposed and cancelled candidates. Cycling auctions first.
- **Flows**: heatmap of moves per (from, to) segment pair plus the busiest routes; click a cell or a route to list its moves.
- **History**: every recorded event (New, Promoted, Proposed, Restarted, Cancelled, Switched) with the distance to the old and the new segment.
- **Auction drill-down** (click any row): 30-day switch-margin trend with event markers, distance to the four nearest segments, the features that moved most on the day, acceleration (difference of two days' margin change) and the auction's full history.
- Forecast, Drift and Flows need `Clustering:report`; History needs `Clustering:list`. In fixtures mode the data is derived from the assignments by `fixtures/drift.ts`.

### 7. Strategy program editor (prototype)

Block editor (Blockly 13) for the price-engine strategy language v1, the check that its grammar maps to blocks one to one. Tab **Programs**. Runs on fixtures only: nothing is saved, no backend call.

- `src/strategyLanguage/blocks.ts`: one block per grammar production (graph-v2 `docs/price-engine/strategy-language/spec-v1.md` §6). Socket shapes carry the types (Boolean, Number, Action).
- `src/strategyLanguage/mapping.ts`: AST JSON (spec §6.1) ⇄ Blockly workspace state, pure functions. An empty socket is reported as a hole and the AST is not sendable.
- The final `return` is a fixed socket of the program block. A `return` block is refused in the top-level chain (custom connection checker).
- A number dropped into a negation block becomes a negative number at once.
- A program call shows one socket per constant of the called program; an empty socket means no override.
- Catalogue (26 system functions, 17 strategies, callable programs) comes from `fixtures/data/strategy-language/*.json`, generated from spec §12.
- `fixtures/data/strategy-language/corpus/valid/` is a copy of the frozen conformance corpus (`graph-v2/symfony/tests/Assets/strategy-language/v1/valid/`). `npm test` runs every case through AST → blocks → AST and expects no difference. Refresh the copy with `cp -r` when the corpus gains cases.

Not in the prototype: text printing (the backend prints canonical text from the AST), diagnostics on blocks, saving.

### 8. Interactive API Explorer
- Test every endpoint in the flow with preloaded templates, editable HTTP methods, request bodies, and real-time response inspection (headers, status, timing, JSON body).

---

## Authentication & API Connection

- The UI is pre-configured to connect directly to `http://localhost:2080/v2.0`.
- The Bearer JWT token is preloaded for User 11 (`test@test.test`) who holds all required permissions:
  `Clustering:list`, `Clustering:manage`, `Clustering:measure`, `Clustering:strategies`, `Clustering:train`, `Clustering:vectorize`.
- Settings can be updated at any time via the slider icon in the top navigation bar.
