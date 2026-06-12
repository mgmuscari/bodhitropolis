# Bodhitropolis

A dharmapunk browser city-builder — a deterministic, procedurally-generated
world atop the GPL-3 Micropolis lineage (the open-sourced SimCity Classic by
Will Wright / Maxis). This repository hosts the modern TypeScript engine in
the root `src/` / `tests/`; the original Micropolis ports live in their legacy
subtrees (`micropolis-activity/`, `MicropolisCore/`, `micropolis-java/`) and
are reference-only.

## Quickstart

```bash
npm install        # install the toolchain (Vite + TypeScript + Vitest)
npm run dev        # serve the app at http://localhost:5173
npx vitest run     # run the test suite
npm run build      # production build (tsc typecheck + vite bundle)
npm run typecheck  # type check only (tsc --noEmit)
```

Open `http://localhost:5173/?seed=<anything>` to generate a specific world.
The same seed always produces the same world — reload to confirm.

## Architecture

Code is split into three layers with a strict, test-enforced purity rule
(`tests/architecture.test.ts`):

- **`src/engine/`** — the deterministic simulation core: a seeded PRNG
  (`rng.ts`, sfc32 with `fork`-by-label streams), a fixed-tick loop
  (`loop.ts`), the layered typed-array tile map (`map.ts`), and the
  built-environment model (`fabric.ts`: the `BuiltKind` taxonomy, the
  `ParcelStore`, placement functions, and connectivity queries). Imports
  nothing from `worldgen` or `ui`.
- **`src/worldgen/`** — value noise / fBm (`noise.ts`), the staged generation
  pipeline (`pipeline.ts`), the terrain stage (`terrain.ts`: elevation,
  ocean/lake/river, moisture, biomes), reusable spatial-field helpers
  (`fields.ts`: distance fields, box density, land runs), and the
  `moses-century` history stage (`moses.ts`). May import `engine`.
- **`src/tech/`** — the data-driven tech tree: a seven-branch unlock DAG
  (`tree.ts`: 34 nodes plus `validateTree`), the deterministic `TechState`
  machine (`state.ts`: unlock rules and a byte-stable snapshot), and
  communal-effort accrual (`effort.ts`). Pure and headless like
  `engine`/`worldgen` — the architecture guard scans it fail-closed. Imports
  only `engine`.
- **`src/tools/`** — the build-tools verb: `tools.ts` (the pure tool system —
  `availableTools`, `previewTool`, `applyTool` over the fabric single-writers,
  spending communal effort) and `inputGeometry.ts` (pure click-vs-drag and
  axis-major line geometry). Pure and headless like `engine`; the architecture
  guard scans it fail-closed. Imports only `engine` and `tech`.
- **`src/ui/`** — a Canvas2D pixel-art renderer (terrain plus an autotiled
  road/rail/transit and footprint-aware building overlay, with a translucent
  build-preview tint), pan/zoom camera, input, the tech panel, and the tool
  dock. Pure presentation/keying (`renderKey.ts`, `toolbarContent.ts`,
  `techContent.ts`, `openingContent.ts`) is allowlisted and headless-tested;
  only the DOM shells and `src/main.ts` touch the DOM.

**Determinism is load-bearing.** `engine` and `worldgen` use only integer math
and exactly-rounded float ops (`+ - * / sqrt`, `Math.imul/floor`) — no
transcendental `Math` (`exp`/`pow`/`log`/`sin`/`cos`/`tan`) and no
`Math.random`, because their results vary across JS engines and would break
"same seed → same world" between browsers. The seeded `rng` is the only
randomness source. This is what makes shared-seed worlds (and the planned
historical simulation) reproducible.

### Built environment (fabric)

The map carries two tile layers for the built world — `built` (a `BuiltKind`:
roads, rail, or a Moses-era building) and `parcel` (the id of the owning
building footprint). Building *attributes* that don't fit in a tile — kind,
density, and condition — live in a parallel-array `ParcelStore` on the
`WorldState`. Because attributes sit outside the map, `hashWorld(world)` (map
snapshot + parcel bytes), not `map.snapshot()` alone, is the canonical
determinism hash for stage tests.

The placement functions in `fabric.ts` (`placeParcel`, `placeTransport`,
`convertTransport`) and their inverses (`demolishParcel`,
`demolishTransportAt`) are the **single writers** of those layers — everything
else queries. Classic transport placement merges same-category junctions
(road-on-road, rail-on-rail) to the higher-capacity kind so two roads can share
a crossing tile; road↔rail crossings are rejected. The tech-tree transit kinds
(bike paths, streetcars, quiet streets, elevated rail, promenades) are
placeable on **empty land only** — they never merge and never cross, so the
capacity-ordered classic merge stays untouched. `convertTransport` is the
**road diet** path: an explicit table transforms an existing tile in place
(street → quiet street / promenade / bike path, avenue → street, highway →
avenue, rail → streetcar) without demolishing or touching the parcel layer.
Demolition tombstones parcels (`ParcelStore` keeps an `alive` flag rather than
compacting, because the `parcel` tile layer holds baked ids); `transportMask`
drives renderer autotiling and `parcelTouchesRoad` answers frontage queries
(connection-category road, so quiet streets count as frontage).

### The Moses-century history stage

`moses-century` (`moses.ts`) is the settlement stage: it grows a coherent city
on the terrain and then wrecks it, in five deterministic era sub-steps that
each fork their own rng stream and thread one shared `MosesState`:

1. **Founding & streetcar town** — picks a flat, water-near, rail-extendable
   site; lays a street grid; runs streetcar rail as radial extensions beyond
   the grid; grows an early fabric of houses, commerce, and a civic core.
2. **Motor age** — upgrades the arterials to avenues, extends the grid, and
   adds rail/water-frontage industry and downtown parking.
3. **Highways & urban renewal** — carves a highway corridor (and often a
   perpendicular second) through the densest fabric, demolishing what stands
   in its path, rips out every streetcar rail, and drops tower-in-the-park
   Projects and a civic megablock.
4. **Suburban flight** — grows street spurs into open land away from the
   expressways and fills a suburban ring (measured by *road-network* distance,
   not crow-flies), while the inner-city core declines.
5. **Disinvestment** — decays every parcel by a redlining-shaped falloff of
   highway distance and abandons (demolishes) those that fall below threshold,
   leaving parking craters — the blighted start state.

Each era writes a line into `world.log` (the chronicle), so the generated
history is legible. Like every stage it is **deterministic** (same seed → same
city) and touches only the `built`/`parcel` layers and parcel attributes — the
four terrain layers are byte-identical before and after.

### The opening challenge

When the app loads, an overlay turns the generated history into the game's
first move: it names the city, tells its century, shows its wounds, and asks
the player to heal it. The pipeline is pure and headless-tested; only the final
overlay touches the DOM.

- **City name** (`engine/names.ts`) — `cityName(rng)` builds a pronounceable,
  title-cased name from a `'city-name'` fork of the world seed (so the name is
  reproducible and independent of the worldgen streams).
- **Chronicle** (`worldgen/chronicle.ts`) — `parseChronicle(world.log)` groups
  the era log lines into entries with fixed year ranges (1900–2000), skipping
  the bare stage names and preserving event text verbatim.
- **Blight report** (`worldgen/report.ts`) — `buildReport(world)` reads the
  final state: parcels standing, condition mean/median and derelict/struggling
  shares, projects still standing, and — sourced from the era-5 chronicle line,
  so the numbers match the prose beside them — the abandoned/cratered counts.
  The core-vs-periphery gradient is reported as a survivorship-free abandonment
  share (the highway core loses far more than the far suburbs).
- **Copy** (`ui/openingContent.ts`, pure) — `statLines`, `eraHeadline`, and
  `challengeText` turn the report and chronicle into legible strings; the
  overlay shell (`ui/opening.ts`) mounts them.

Dismiss the overlay with **Begin**, **Enter**, or **Escape**; the map is live
beneath it. Append **`?nointro=1`** to skip the overlay entirely. Because every
input is the deterministic world, `?seed=<anything>` reproduces an identical
name, chronicle, and numbers on every load.

### The tech tree

The unlock spine of the dharmapunk city: a tech tree the player advances by
spending *communal effort*. Press **`T`** to open the right-docked panel
(suppressed while the opening overlay is up).

- **Seven branches** (`tech/tree.ts`) — New Urbanism, Green Development,
  Restorative Justice, Intentional Communities, Gift Economy, Solarpunk, and
  Anarcho-Communism: 34 nodes in an acyclic prerequisite graph. Prerequisites
  cross branches (Restorative Justice is load-bearing — you cannot heal the
  built environment without healing the community), and `validateTree` proves
  the structure sound: unique ids, no dangling prereqs, no cycles, every node's
  prereq closure terminates at a no-prereq root, and each granted build kind is
  unique and a valid `BuiltKind`.
- **Communal effort** (`tech/effort.ts`) — the first real per-tick simulation
  work: each sim tick accrues `max(1, floor(aliveParcels / 8 + conditionMean /
  32))` effort — a finite integer ≥ 1 (a zero-parcel guard keeps the empty world
  at exactly 1). **This formula is a deliberate PLACEHOLDER** — the real civic
  simulation will replace it; the accrual *contract* (deterministic, integer,
  ≥ 1 per tick) is the part that stays.
- **Unlocking** (`tech/state.ts`) — a node unlocks once its prerequisites are
  met and enough effort has accrued, spending exactly its cost. The panel marks
  each node locked / affordable / unlocked and names any unmet prerequisites; an
  open panel re-derives every tick, so nodes flip to affordable as effort rises.
  `TechState` is pure (no rng, no `Date`) with a byte-stable snapshot (sorted
  unlocked ids + effort), so unlock history is reproducible.
- **What it gates** — nodes grant either *capabilities* (flags later features
  read) or *build kinds*: new transit and buildings (bike paths, streetcars,
  parklets, community gardens, co-op housing, communes, …). The build tools
  (below) place those kinds as the tree grants them; the `road-diets`
  capability unlocks the classic road-diet conversions.

### Build tools

The game's core verb — **build, convert, bulldoze** — paid for in communal
effort. An always-on dock at the bottom of the screen lists every tool the tech
tree has unlocked so far; click one to select it (its cost shows as `Name ·
cost`, and it greys out when you cannot afford it), then click the map to apply.

- **Hotkeys** — **`i`** selects Inspect (a free, non-mutating readout of the
  clicked tile — kind, condition, parcel — shown as a status line in the dock),
  **`x`** selects Bulldoze, and **`Escape`** deselects.
  A hovered tool tints its target tile translucent **green** (valid) or **red**
  (invalid) before you commit.
- **Building & transit** — a building tool places its parcel footprint on empty
  land; a transit tool (bike path, streetcar, quiet street, elevated rail,
  promenade) places a tile on empty land. With a transit tool held, **dragging
  paints a straight line** of tiles; with any other tool (or none) a drag still
  **pans** the map — to pan with a transit tool held, deselect or hold the
  middle mouse button. A short press (under ~5px of motion) is always a click,
  never a drag.
- **Conversions are road diets, not demolition** — the conversion tools
  transform a road in place rather than clearing it: an avenue narrows to a
  street, a highway comes down to a boulevard-grade avenue, a street becomes a
  quiet street / promenade / bike path, old rail hums back as a streetcar. The
  conversion tools for the transit targets appear as the tree grants those
  kinds; the classic road-diet conversions (avenue→street, highway→avenue)
  appear once **Road Diets** is unlocked.
- **Bulldoze** — removes whatever occupies a tile: a building (the whole parcel,
  tombstoned) or a transport tile. It is the cheapest tool, and demolition is
  loss — nothing is refunded.
- **Effort costs** — every action except Inspect spends communal effort through
  the same guarded debit the tech tree uses (so the effort total can never
  drift): bulldoze 1, conversions 2–4/tile, transit 3–6/tile, buildings 8–30 by
  size. These are placeholder economy values — balancing is a later pass.

Tool application is a deterministic function of `(world, tech, action)` and
routes only through the fabric single-writers, so a scripted build sequence
replays to an identical world hash and effort snapshot.

### Ecology

The land is a participant, not a backdrop. Three new tile layers —
**soil health**, **flora vitality**, and **fauna presence** (each 0–255) — are
seeded the moment the world is born: the Moses century broke the soil along its
corridors and pushed the wild out to the edges, and you start with that wound
already in the ground. A pure ecology tick runs every `ECO_CADENCE` sim steps,
advancing the three layers together:

- **Soil** recovers slowly on open land and is healed faster near gardens,
  parklets, and compost; fresh pavement caps it low.
- **Flora** grows where the soil is healthy, spreads onto bare ground from rich
  neighbours, and thins under the influence of busy roads and industry.
- **Fauna** colonises toward a tile's **carrying capacity** — a habitat ceiling
  set by its flora, riparian (water-adjacent) edges, and wildlife corridors — so
  it never floods past what the land can hold.

The three couple with a one-tick lag (a healed garden raises soil this tick,
flora answers the next, fauna the one after), because the tick is strictly
double-buffered: every step reads the previous state and writes a scratch copy,
so the result never depends on tile-scan order.

- **The road-diet ecological payoff** — a busy road (street, avenue, highway)
  *fragments* habitat: fauna cannot cross it and none accumulates on it. A
  **quiet street, promenade, or bike path does not** — it carries a wildlife
  verge that lets fauna relay across it over time. So converting a road to a
  calm corridor literally reconnects the wild, tile by tile. The payoff is
  encoded as data (the influence table keys on the built *kind*, not its traffic
  category) precisely so this distinction is real.
- **Biodiversity** is **Simpson's index** over a 7×7 window of habitat classes —
  the deliberate no-transcendentals choice (Simpson, not Shannon, so there is no
  `log`). It is computed as an **exact rational** and only then floored into a
  byte for display, so the determinism guarantee holds across browsers.
- **The overlay** — press **`E`** to cycle a translucent heatmap over the map:
  off → soil → flora → fauna → biodiversity → off. The soil/flora/fauna views
  read the live layers, so they update as the ecology ticks; the biodiversity
  view recomputes each tick. A legend line names the active view in the dock.

Ecology reads the built environment (which kinds sit where) but writes **only**
its own three layers — an automated test asserts every other map layer, the
parcel store, and tech state stay byte-identical across a tick. The seeding and
the tick are deterministic functions of state (no RNG in the tick), so the same
seed always grows the same land. As with effort costs, every **rate, threshold,
and cap here is placeholder ecology** — the tested contract is the directional
invariants and determinism, never the balance, which a tuning pass will set once
the civic simulation consumes these layers.

## Methodology

This project is built with the Dialectic development methodology. See
[`dialectic.md`](dialectic.md) for the methodology spec and `CLAUDE.md` for
project conventions.

---

# Open Source Micropolis, based on the original SimCity Classic from Maxis, by Will Wright. #

This is the source code for Micropolis (based on [SimCity](http://en.wikipedia.org/wiki/SimCity_(1989_video_game))), released under the GPL. Micropolis is based on the original SimCity from Electronic Arts / Maxis, and designed and written by Will Wright.

## [Description](../wiki/Description.md) ##
A description of the Micropolis project source code release.

## [News](../wiki/News.md) ##
The latest news about recent development.

## [DevelopmentPlan](../wiki/DevelopmentPlan.md) ##
The development plan, and a high level description of tasks that need to be done.

## [ThePlan](../wiki/ThePlan.md) ##
Older development plan for the TCL/Tk version of Micropolis and the C++/Python version too.

## [Assets](../wiki/Assets.md) ##
List of art and text assets, and work that needs to be done for Micropolis.

## Documentation ##

This is the old documentation of the HyperLook version of SimCity, converted to wiki text.
It needs to be brought up to date and illustrated.

  * [Introduction](../wiki/Introduction.md)
  * [Tutorial](../wiki/Tutorial.md)
  * [User Reference](../wiki/UserReference.md)
  * [Inside The Simulator](../wiki/InsideTheSimulator.md)
  * [History Of Cities And City Planning](../wiki/History.md)
  * [Bibliography](../wiki/Bibliography.md)
  * [Credits](../wiki/Credits.md)

## [License](../wiki/License.md) ##
The Micropolis GPL license.

## Tools ##
[![](http://wingware.com/images/coded-with-logo-129x66.png)](http://wingware.com/)
