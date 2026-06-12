# PRP: Bodhitropolis Foundation

## Source PRD: docs/PRDs/bodhitropolis-foundation.md
## Date: 2026-06-12

## 1. Context Summary

Build the platform slice for Bodhitropolis, the dharmapunk browser
city-builder forked from Micropolis: a Vite + TypeScript + Vitest scaffold in
root `src/`/`tests/`, a deterministic sim kernel (seeded PRNG, fixed-tick
loop), a layered 128×128 tile map model on typed arrays, a multi-stage
worldgen pipeline with stage 1 (terrain: elevation noise, downhill rivers,
lakes, moisture, forests/meadows), and a Canvas2D pixel-art renderer v0 with
pan/zoom. Engine and worldgen code is pure TS, headless-testable, zero
runtime dependencies. Determinism is load-bearing: the future "century of
blight" historical sim and DF-style worldgen reproducibility both depend on
it.

## 2. Codebase Analysis

- **Reference implementation for terrain feel**:
  `micropolis-java/src/micropolisj/engine/MapGenerator.java`
  - Rivers are random walks: `doBRiv()`/`doSRiv()` (lines 255-325) walk a
    cursor, stamping 9×9 (`BRMatrix`) / 6×6 (`SRMatrix`) water blobs, with
    probabilistic direction persistence (`PRNG.nextInt(r1+1) < 10` keeps
    direction; two `> 90` rolls bend it). Lakes are clustered blob stamps
    (`makeLakes()`, lines 212-237). Trees are random-walk "splashes"
    (`treeSplash`, line 457) followed by smoothing passes.
  - We modernize: elevation-first generation with rivers carved downhill from
    springs. Keep the *feel* (meandering, blobby water bodies, organic forest
    edges via dithering) — cite the matrices for blob shapes if useful.
- **Methodology infrastructure to update**:
  - `scripts/hooks/pre-commit` (line 13) and `scripts/hooks/pre-push`
    (line 13) self-skip when no `*.py` files exist under `src/`/`tests/` and
    run `ruff`/`mypy`/`pytest`. Per the template's design (comments at top of
    each hook), swap for the TS stack: pre-commit → `npx tsc --noEmit`;
    pre-push → `npx vitest run`. Keep the self-skip pattern but match `*.ts`.
    Note: `scripts/setup.sh` installs these into `.git/hooks/` — re-run it
    after editing, since the install copies rather than symlinks (verify
    which during Task 1 and re-install if copies).
- **Conventions (CLAUDE.md)**:
  - New code in root `src/` and `tests/` (2026-06-12 gotcha) — legacy
    subtrees are reference-only.
  - Conventional commits, ≤72-char first line; one PRP task = one atomic
    commit (test + implementation together).
  - TDD mandatory: RED → GREEN → REFACTOR per task.
- **Integration points**: none with legacy code. `index.html` + `src/main.ts`
  are the browser entry; everything else is internal modules. `.gitignore`
  needs `node_modules/`, `dist/` entries (check existing file first — it came
  from the template and likely lacks Node entries).

## 3. Implementation Plan

**Test Command:** `npx vitest run`

Module dependency rule (enforced by Task 8's architecture test):
`src/engine/` imports nothing from `src/worldgen/` or `src/ui/`;
`src/worldgen/` may import `src/engine/`; only `src/ui/` + `src/main.ts` may
touch the DOM.

### Task 1: Toolchain scaffold + hook conversion
**Files:** `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `index.html`, `src/main.ts`, `tests/smoke.test.ts`,
`scripts/hooks/pre-commit`, `scripts/hooks/pre-push`, `.gitignore`
**Approach:**
- `npm init -y` then edit: name `bodhitropolis`, private, type `module`,
  scripts: `dev` (vite), `build` (tsc && vite build), `test` (vitest run),
  `typecheck` (tsc --noEmit). Dev deps: `typescript`, `vite`, `vitest` (let
  npm resolve current majors; pin via lockfile).
- `tsconfig.json`: strict true, `noUncheckedIndexedAccess` true, target
  ES2022, moduleResolution bundler, include `src`, `tests`, `vite.config.ts`.
- `vite.config.ts`: default config; vitest reads it (add `test` block:
  environment `node`).
- `index.html`: canvas-bearing minimal page loading `/src/main.ts`.
- `src/main.ts`: placeholder that no-ops outside a browser (guard on
  `typeof document !== 'undefined'`) so importing it headless is safe.
- Hooks: replace Python commands; change self-skip `find` patterns to
  `*.ts`. pre-commit: `npx tsc --noEmit`. pre-push: `npx vitest run`.
  Re-run `./scripts/setup.sh` to reinstall if `.git/hooks` holds copies.
- `.gitignore`: append `node_modules/`, `dist/`.
**Tests:** `tests/smoke.test.ts` — vitest runs, imports `src/main.ts` without
throwing (proves headless-import safety), trivial assertion.
**Validation:** `npx vitest run` green; `npx tsc --noEmit` clean; commit
triggers converted pre-commit hook successfully.

### Task 2: Seeded PRNG
**Files:** `src/engine/rng.ts`, `tests/engine/rng.test.ts`
**Approach:** Implement sfc32 (public-domain algorithm, 128-bit state) plus a
string→seed hash (e.g. splitmix32 over a 32-bit FNV-1a of the string).
API:
```ts
interface Rng {
  next(): number;            // float in [0, 1)
  nextInt(n: number): number; // integer in [0, n)
  chance(p: number): boolean;
  fork(label: string): Rng;  // independent child stream, deterministic
}
createRng(seed: string | number): Rng
```
`fork` hashes the label into the child seed — pipeline stages each fork so
inserting a stage never perturbs sibling streams.
**Tests (RED first):** same seed → identical first 16 outputs (pin exact
values once GREEN, then assert them forever); different seeds differ;
`nextInt(n)` bounds over 10k draws; mean of 10k `next()` within 0.48-0.52;
`fork('a')` ≠ `fork('b')` streams; `fork` is deterministic across runs.
**Validation:** `npx vitest run`

### Task 3: Fixed-tick simulation loop
**Files:** `src/engine/loop.ts`, `tests/engine/loop.test.ts`
**Approach:** Accumulator pattern, no DOM/timers:
```ts
class FixedTickLoop {
  constructor(tickMs: number, onTick: (tick: number) => void)
  advance(elapsedMs: number): void  // accumulates, fires 0..n ticks
  readonly tickCount: number
}
```
Clamp pathological `elapsedMs` (e.g. > 1000ms) to avoid spiral-of-death;
expose `alpha` (accumulator fraction) for future render interpolation.
**Tests:** advancing 100ms at tickMs=50 fires 2 ticks; irregular deltas
(7+13+30ms…) fire exactly floor(total/tickMs); tick indices are sequential;
clamping caps ticks per advance; zero/negative elapsed fires nothing.
**Validation:** `npx vitest run`

### Task 4: Layered map model
**Files:** `src/engine/map.ts`, `tests/engine/map.test.ts`
**Approach:**
```ts
const enum Water { None, River, Lake, Ocean }
const enum LandCover { Bare, Meadow, Grass, Forest }
class GameMap {
  constructor(width = 128, height = 128)
  readonly elevation: Float32Array  // [0,1]
  readonly water: Uint8Array        // Water enum
  readonly moisture: Float32Array   // [0,1]
  readonly landCover: Uint8Array    // LandCover enum
  readonly built: Uint16Array       // reserved, 0 = empty
  idx(x, y): number; inBounds(x, y): boolean
  // typed getters/setters per layer
  snapshot(): string   // stable hash/serialization of all layers
}
```
Typed arrays sized w*h; `snapshot()` enables byte-identical determinism
assertions (FNV-1a over the concatenated buffers is enough).
**Tests:** dimensions/layer lengths; idx math at corners; inBounds edges;
get/set roundtrip per layer; snapshot equal for equal content, differs after
any single-cell mutation.
**Validation:** `npx vitest run`

### Task 5: Value noise + fBm
**Files:** `src/worldgen/noise.ts`, `tests/worldgen/noise.test.ts`
**Approach:** Seeded lattice value noise: integer lattice hashed via
splitmix32(seed ^ hash(x,y)) → [0,1); bilinear interpolation with smoothstep;
`fbm(x, y, {octaves, lacunarity, gain})` summing octaves, normalized to
[0,1]. Pure functions of (seed, x, y) — no internal state, so sampling order
can never affect results.
**Tests:** determinism (same seed+coords → same value, across two separate
calls); output within [0,1]; different seeds → different fields (compare 100
samples, expect <5 collisions); continuity: |n(x,y) − n(x+0.01,y)| < 0.05 for
sampled points; fBm with more octaves has more high-frequency variance
(compare adjacent-sample deltas, octaves=1 vs 5).
**Validation:** `npx vitest run`

### Task 6: Worldgen pipeline abstraction
**Files:** `src/worldgen/pipeline.ts`, `tests/worldgen/pipeline.test.ts`
**Approach:**
```ts
interface WorldState { map: GameMap; seed: string; log: string[] }
interface WorldgenStage { name: string; apply(world: WorldState, rng: Rng): void }
runPipeline(opts: {seed: string; width?: number; height?: number},
            stages: WorldgenStage[]): WorldState
```
`runPipeline` creates the map, then for each stage calls
`stage.apply(world, rootRng.fork(stage.name))` and appends to `log`. Stage
rng streams keyed by name → adding/removing a stage doesn't perturb others.
**Tests:** stages run in order (log); each stage receives a different rng
stream (record first draws); same seed + same stages → identical
`map.snapshot()`; removing stage B doesn't change the rng draws stage C sees
(fork independence — the core determinism contract).
**Validation:** `npx vitest run`

### Task 7: Terrain stage (worldgen stage 1)
**Files:** `src/worldgen/terrain.ts`, `tests/worldgen/terrain.test.ts`
**Approach:** One `terrainStage(params)` returning a `WorldgenStage`; params
with defaults: `seaLevel 0.32`, `springCount 3`, `forestMoisture 0.6`,
`noise {octaves 5, ...}`. Sub-steps, each a private function:
1. *Elevation*: fBm over map coords (scale ~1/48 tiles), normalized [0,1].
2. *Ocean & lakes*: cells below seaLevel are water; flood-fill from map
   edges marks `Ocean`; remaining below-sea components are `Lake`.
3. *Rivers*: pick `springCount` springs from the top elevation quartile
   (rng-chosen among candidates); walk steepest-descent with momentum
   (prefer continuing direction on near-ties — the upstream `doBRiv` feel,
   MapGenerator.java:255) carving `River` and slightly eroding elevation;
   terminate at any water or map edge; on local-minimum stall, fill to
   `Lake` and stop (cheap, plausible).
4. *Moisture*: BFS distance-to-nearest-water, mapped through exp falloff,
   blended 70/30 with an independent fBm field.
5. *Land cover*: water → Bare; else thresholds on moisture (≥forestMoisture
   → Forest, mid → Grass, low → Meadow) with rng dithering in a ±0.05 band
   at each boundary for organic edges.
**Tests:** determinism — two full `runPipeline` calls, same seed → equal
`snapshot()`; different seeds → different snapshots; for seeds
`['bodhi-1'..'bodhi-5']`: water fraction in [0.08, 0.45], forest fraction in
[0.05, 0.55]; every `River` cell has a 4-neighbor that is water or is on the
map edge (connectivity); all springs start above seaLevel; land cover is
Bare on all water cells.
**Validation:** `npx vitest run`

### Task 8: Architecture guard (DOM-free engine)
**Files:** `tests/architecture.test.ts`
**Approach:** Node `fs` walk of `src/engine/` and `src/worldgen/`; fail if
source matches `\b(window|document|HTMLCanvasElement|requestAnimationFrame|
navigator|localStorage)\b` or imports from `../ui` / `src/ui`. Also assert
`src/engine` files never import from `src/worldgen` (dependency direction).
**Tests:** the guard itself (it IS the test) plus a self-check: assert it
flags a synthetic bad string via the matcher function exported for testing.
**Validation:** `npx vitest run`

### Task 9: Camera + Canvas renderer v0 + input
**Files:** `src/ui/camera.ts`, `src/ui/renderer.ts`, `src/ui/input.ts`,
`src/main.ts`, `index.html`, `tests/ui/camera.test.ts`
**Approach:**
- `camera.ts` (pure, testable): `{x, y, zoom}` with zoom ∈ {1,2,3,4} (integer
  scales × 16px base tile); `worldToScreen`/`screenToWorld`; `pan(dx,dy)`
  clamped to map bounds; `zoomAt(screenPt, dir)` keeping the point under the
  cursor fixed (integer steps).
- `renderer.ts` (DOM, thin): build a programmatic tile atlas once on an
  offscreen canvas — 16×16 tiles per (water type | land cover | elevation
  band): base color + 2-color ordered-dither checker for texture (Stardew-ish
  warmth: deep/shallow blues, meadow gold-greens, forest deep greens, shore
  sand). Draw only the visible tile range; `imageSmoothingEnabled = false`;
  scale canvas by devicePixelRatio with integer transforms.
- `input.ts`: pointer drag → pan; wheel → zoomAt; arrows → pan.
- `main.ts`: run worldgen (seed from URL `?seed=`, default fixed), create
  camera/renderer, rAF render loop (sim loop wired but with no stages yet —
  it just exists and ticks).
**Tests:** camera only (pure math): worldToScreen/screenToWorld round-trip at
each zoom; zoomAt keeps cursor-point invariant; pan clamping at all four map
edges; zoom clamps at min/max. Renderer/input stay untested thin shells
(manual validation) — keep all logic that can live in camera.ts there.
**Validation:** `npx vitest run`; manual: `npm run dev` shows pixel-crisp
terrain; drag/wheel/arrows work; `?seed=x` changes the map, reload with same
seed reproduces it.

### Task 10: Developer docs
**Files:** `README.md` (prepend Bodhitropolis section), `docs/PRDs/bodhitropolis-foundation.md` (status flip after merge — leave DRAFT for now)
**Approach:** Top-of-README section: project one-liner (dharmapunk
city-builder, GPL-3 Micropolis lineage), quickstart (`npm install`,
`npm run dev`, `npx vitest run`), architecture sketch (engine/worldgen/ui
purity rule), pointer to `dialectic.md` for methodology. Keep the upstream
Micropolis README content below a divider.
**Tests:** none (docs).
**Validation:** `npx vitest run` still green (no code touched).

## 4. Validation Gates

```bash
# Type check (also runs as pre-commit hook)
npx tsc --noEmit

# Unit tests (also runs as pre-push hook)
npx vitest run

# Manual acceptance (Task 9+)
npm run dev   # crisp pixel terrain, pan/zoom, ?seed= reproducibility
```

## 5. Rollback Plan

All changes are additive (new root `src/`, `tests/`, npm files) except the
git-hook command swap and `.gitignore` append. Rollback = don't merge the
branch; for the hooks, `git checkout main -- scripts/hooks/ && ./scripts/setup.sh`
restores Python defaults. No data, schema, or deployment surface exists yet.

## 6. Uncertainty Log

- **Water/forest fraction bounds (Task 7)** are educated guesses; if a seed
  in the test set lands outside, tune *params* (seaLevel, noise scale) — do
  not widen bounds past plausibility. Flag for human eyeball at `npm run dev`.
- **River walker stall behavior** (fill-to-lake on local minimum) is a design
  guess; acceptable for v0, revisit when the Moses-century stage needs real
  hydrology.
- **npm registry access** is assumed available for `npm install`; versions
  resolved at install time and pinned by lockfile rather than pre-pinned here.
- **Hook install mechanism**: whether `scripts/setup.sh` copies or symlinks
  hooks — Task 1 verifies and re-installs if needed.
- **`const enum` under Vite/esbuild**: esbuild doesn't fully erase
  `const enum` across files; if it complains, switch to plain `enum` or
  literal unions — tests are written against values, not enum identity.
- **DPR + integer zoom interaction** (Task 9) may need rounding care on
  non-integer devicePixelRatio displays; acceptance is visual crispness, not
  a pinned formula.
