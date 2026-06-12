# PRP: Urban Fabric

## Source PRD: docs/PRDs/urban-fabric.md
## Date: 2026-06-12

## 1. Context Summary

Add the built-environment model to Bodhitropolis: a `BuiltKind` taxonomy
(roads/rail/Moses-era buildings), a parcel system (multi-tile footprints with
density/condition in a struct-of-arrays store + a new `parcel` map layer),
pure placement/query functions (validity, road connection mask,
road-adjacency), renderer v1 (autotiled roads, footprint- and
condition-aware building tiles), and a deterministic placeholder
`fabric-demo` worldgen stage that lays a visible test town. This is the
substrate the Moses-century history sim (next feature) will grow.

## 2. Codebase Analysis

All paths from the merged foundation (PR #1):

- **Enum pattern to copy** — `src/engine/map.ts:12-16`: `as const` object +
  literal-union type (NOT `const enum`; esbuild constraint, plan-review
  precedent). `BuiltKind` follows this exactly.
- **Layer pattern** — `src/engine/map.ts:48-60`: typed arrays sized `w*h`
  in the constructor; `snapshot()` at map.ts:111-119 FNV-folds each layer via
  `fnv1aBytes`. Add `parcel: Uint16Array` to both. ParcelStore contributes
  its own bytes to the snapshot (see Task 2) so condition mutations change it.
- **Stage contract** — `src/worldgen/pipeline.ts:19-23`: `{name,
  apply(world, rng)}`; stage rng forked by name (pipeline.ts:37). The demo
  stage forks sub-streams like `terrainStage` does (terrain.ts:343-348).
- **Worldgen helper style** — `src/worldgen/terrain.ts`: exported pure
  sub-step functions with focused unit tests (e.g. `selectSprings` tested
  with hand-crafted elevation at terrain.test.ts:71-90). Fabric placement
  functions follow this.
- **Renderer extension point** — `src/ui/renderer.ts:60-71` `buildAtlas()`
  (kind-band keyed `Map<string, HTMLCanvasElement>`), `makeTile` Bayer
  dither at renderer.ts:39-58, draw loop at renderer.ts:129-136 (`kindOf`
  switch). Extend: after the terrain tile, draw a built overlay tile when
  `built[i] != 0`.
- **Architecture rules (mechanically enforced)** — `tests/architecture.test.ts`
  auto-scans `src/engine` + `src/worldgen`: no DOM, no
  `Math.(exp|pow|log|sin|cos|tan|random)`, engine never imports worldgen,
  nothing imports ui. New files are covered automatically; the road-mask
  helper therefore lives in engine (pure, history-sim-reusable).
- **Test conventions** — `tests/{engine,worldgen,ui}/*.test.ts`; determinism
  asserted by double-run `snapshot()` comparison (terrain.test.ts:32-36);
  invariants swept across seeds (terrain.test.ts:143-147 asserts
  `componentCount >= 1` — never write an invariant test satisfiable by
  absence: assert existence alongside the invariant).
- **Conventions**: conventional commits ≤72 chars; one task = one atomic
  commit; TDD RED→GREEN→REFACTOR; never weaken tests.

**Execution mechanics note:** as with the foundation feature, team mode is
environmentally unavailable this session; execution runs via a headless
proposer (`DIALECTIC_TEAM_AGENT=1 claude -p`, model opus), the team lead
stays out of `src//tests/`, and gates are re-verified independently by the
lead afterward.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: BuiltKind taxonomy + parcel layer + snapshot extension
**Files:** `src/engine/fabric.ts` (new), `src/engine/map.ts`,
`tests/engine/fabric.test.ts` (new), `tests/engine/map.test.ts`
**Approach:**
- `fabric.ts`:
```ts
export const BuiltKind = {
  None: 0,
  // transport 1..15
  RoadStreet: 1, RoadAvenue: 2, RoadHighway: 3, Rail: 4,
  // Moses-era buildings 16..47
  HouseSingle: 16, Apartments: 17, Projects: 18, CommercialStrip: 19,
  Offices: 20, Industrial: 21, ParkingLot: 22, Civic: 23,
  // 48+ reserved for tech-tree-era kinds (parklets, co-ops, communes…)
} as const;
export type BuiltKind = (typeof BuiltKind)[keyof typeof BuiltKind];
export const isRoadKind = (k: number): boolean => k >= 1 && k <= 3;
export const isTransportKind = (k: number): boolean => k >= 1 && k <= 4;
export const isBuildingKind = (k: number): boolean => k >= 16 && k <= 47;
```
- `map.ts`: add `readonly parcel: Uint16Array` (constructed alongside the
  others; 0 = none, else parcelIndex+1); fold into `snapshot()` after
  `built`.
**Tests (RED):** kind ranges + predicates (each boundary); map gets the new
layer sized w*h; setting a `parcel` cell changes `snapshot()`; existing map
tests still pass untouched.
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: ParcelStore
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:** struct-of-arrays with growth-by-push (plain number arrays are
fine — determinism comes from content, not storage class):
```ts
export interface ParcelInit { x: number; y: number; width: number; height: number;
  kind: BuiltKind; density?: number; condition?: number }
export class ParcelStore {
  // parallel arrays: anchorX, anchorY, width, height, kind, density, condition
  add(p: ParcelInit): number;            // returns parcel index
  count(): number;
  get(i: number): Readonly<Parcel>;      // materialized view
  setCondition(i: number, v: number): void;  // clamped 0..255
  setDensity(i: number, v: number): void;
  snapshotBytes(): Uint8Array;           // stable byte encoding of all fields
}
```
`GameMap.snapshot()` cannot see the store, so worldgen-level determinism
tests hash `map.snapshot() + store.snapshotBytes()` — provide
`hashWorld(map, store): string` in fabric.ts wrapping both (FNV, reuse map's
helper by exporting it from map.ts).
**Tests (RED):** add/get roundtrip incl. defaults (density 1, condition 255);
count; setCondition clamps and changes `hashWorld`; snapshotBytes stable
across two identical stores, differs on any field change.
**Validation:** `npx vitest run`

### Task 3: Placement validity + placeParcel/placeRoad
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
```ts
export function canPlaceParcel(map, x, y, w, h): boolean
  // in-bounds; every tile: water==Water.None, built==0, parcel==0
export function placeParcel(map, store, init): number | -1
  // validates, writes kind into built + (index+1) into parcel for the
  // footprint, adds store entry; returns index or -1
export function canPlaceTransport(map, x, y): boolean
  // in-bounds, land, built==0 (v1: no road/rail overlap, no crossings)
export function placeTransport(map, x, y, kind): boolean
```
Placement functions are the ONLY writers of built/parcel tiles (single
source of truth; PRD risk #1). Buildings: footprints 1×1..3×3 validated
(`w,h ∈ [1,3]`).
**Tests (RED):** success path writes every footprint tile (kind + parcel id)
and store agrees; rejections each tested: OOB, water tile anywhere in
footprint, overlap with road, overlap with existing parcel, bad footprint
size; placeTransport on water/occupied rejected; placement keeps
tile-kind/store-kind agreement (sweep all tiles, assert
`built[i]` building-kind ⇒ `parcel[i] != 0` and store kind matches).
**Validation:** `npx vitest run`

### Task 4: Road connection mask + parcel road-adjacency
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
```ts
export function transportMask(map, x, y): number
  // bit 0=N,1=E,2=S,3=W set when that 4-neighbor is the SAME transport
  // category (road kinds connect to road kinds; rail only to rail)
export function parcelTouchesRoad(map, store, i): boolean
  // any tile 4-adjacent to the footprint perimeter is a road kind
```
**Tests (RED):** all 16 mask configurations exhaustively on a 5×5 fixture;
road-rail non-connection; mask at map corners (OOB neighbors = unset);
parcelTouchesRoad true (road along one edge) / false (isolated); 3×3 parcel
adjacency via a single road tile diagonal-only → false (diagonals don't
count).
**Validation:** `npx vitest run`

### Task 5: fabric-demo worldgen stage
**Files:** `src/worldgen/fabricdemo.ts` (new),
`tests/worldgen/fabricdemo.test.ts` (new)
**Approach:** `fabricDemoStage(): WorldgenStage` named `fabric-demo`.
PLACEHOLDER banner comment: the Moses-century feature replaces this stage.
Sub-steps (rng forks: `site`, `layout`):
1. *Site*: scan a centered spiral for the first `SITE×SITE` (e.g. 24×24)
   all-land window (reuse `canPlaceParcel`-style sweep); rng tie-break among
   the first few candidates so different seeds vary. If none (pathological
   all-water map), log `fabric-demo: no site` into `world.log` and return
   without placing — stage must not throw.
2. *Roads*: a crossroads through the site center — `RoadAvenue` E-W,
   `RoadStreet` N-S, slight rng jitter of the crossing point; clip at water.
3. *Parcels*: walk road frontage; place one of each building kind (footprints:
   house 1×1, strip 1×2, parking 2×2, apartments/projects/offices/industrial/
   civic 2×2 or 3×3) with varied density/condition from rng; skip frontage
   tiles where `canPlaceParcel` fails.
**Tests (RED):** determinism — two runs same seed → equal
`hashWorld(map, store)`; different seeds differ; for 3 seeds: every building
kind placed ≥1 (assert existence — non-vacuous), all parcels
`parcelTouchesRoad`, no built tile on water, all placements internally
consistent (Task 3's agreement sweep as a shared helper); all-water map
fixture → no placement, no throw, log entry present.
**Validation:** `npx vitest run`

### Task 6: Renderer v1 — roads, rail, buildings
**Files:** `src/ui/renderer.ts`, `src/main.ts`
**Approach:**
- Atlas additions (programmatic, Bayer-dithered, same `makeTile` machinery):
  - per road kind × 16 mask variants: asphalt base (street warm-gray,
    avenue darker + center line, highway near-black + double line), lane
    stripes drawn toward connected edges; rail: gravel base + ties + twin
    rails toward connected edges.
  - per building kind: warm-palette block (brick reds, project concrete,
    strip beige+sign stripe, office steel-blue, industrial rust, parking
    asphalt grid, civic sandstone) with footprint-position variation
    (corner/edge/center roof inset) and 2 condition tiers (weathered accent
    when condition < 128).
- Draw pass: after terrain tile, if `built[i]` → draw overlay
  `built-{kind}-{maskOrPos}-{condTier}`. Mask via `transportMask` (engine
  import — allowed direction); parcel position/condition via `parcel[i]` →
  store lookup. `Renderer.render` gains a `store: ParcelStore` parameter
  (main.ts passes the demo store; thread it via `WorldState` — see Task 5:
  put the store on `WorldState` as `world.parcels`).
- `main.ts`: add `fabricDemoStage()` after `terrainStage()`.
**Note:** adding `parcels: ParcelStore` to `WorldState` (pipeline.ts) is the
clean carrier — created in `runPipeline`, used by any stage. Do this in
Task 2 or 5, whichever lands the dependency first (executor's choice, note
it in the commit).
**Tests:** none new in ui beyond keeping camera tests green (renderer remains
an untested thin shell; ALL new pure logic — masks, predicates — already
lives in engine from Tasks 3-4). Manual: `npm run dev` — crossroads renders
with correct junction arms, building kinds distinguishable, condition
weathering visible, crisp at zooms 1-4.
**Validation:** `npx vitest run`; `npm run build`; manual dev check.

### Task 7: Docs
**Files:** `README.md`
**Approach:** extend the architecture sketch: fabric model (BuiltKind,
parcels, placement single-writers), `fabric-demo` placeholder status and its
planned replacement by the Moses-century stage.
**Tests:** none (docs).
**Validation:** `npx vitest run` still green.

## 4. Validation Gates

```bash
npx tsc --noEmit        # pre-commit hook gate
npx vitest run          # pre-push hook gate
npm run build           # production transpilation
npm run dev             # manual: junctions, kinds, weathering, crispness
```

## 5. Rollback Plan

Additive feature on a branch: revert = don't merge. The only foundation
files touched are map.ts (new layer + snapshot fold), pipeline.ts
(WorldState.parcels), renderer.ts (overlay pass), main.ts (one stage) — all
backward-compatible extensions; reverting the branch restores PR #1 behavior
exactly.

## 6. Uncertainty Log

- **Site-finding heuristic** (centered spiral, first-fit window) is a guess
  at "good demo placement"; any deterministic choice is acceptable for a
  placeholder. Moses-century will bring real settlement logic.
- **Kind code ranges** (1-15 transport, 16-47 Moses, 48+ future) are a
  taxonomy bet; cheap to renumber before anything persists (no save format
  exists yet).
- **`WorldState.parcels` placement** (pipeline-owned vs stage-created) —
  PRP picks pipeline-owned for uniformity; if it proves awkward the executor
  may attach it in the demo stage instead, documenting why in the commit.
- **Renderer atlas size** grows to ~(7 terrain + 4×16 transport + 8×3×2
  building) tiles ≈ 120 16×16 canvases — trivial memory, but if atlas-key
  string churn shows up in profiling later, switch to integer keys (not now).
- **Condition tiers** (2) are a placeholder for the blight feature's needs;
  the store keeps full 0-255 resolution regardless.
