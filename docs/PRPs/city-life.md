# PRP: City Life

## Source PRD: docs/PRDs/city-life.md
## Date: 2026-06-15

## 1. Context Summary

Ambient sprites — cars, pedestrians, bird flocks — that **read** the world and
animate over it, *following the urban/ecological impacts* (cars by road class,
peds on calm/green streets, birds by `faunaPresence`). A pure deterministic
stepper (`ambientContent.ts`, 50ms substeps, `fork('ambient')`) + a split
renderer (cached offscreen base + per-frame sprite composite) + a continuous
rAF loop gated by a `[Life]` toggle that pauses on `document.hidden`. **Purely
visual and read-only: no world writes, no sim-stream use, no engine/worldgen/
ecology/civic/tech/tools logic change; `hashWorld` unchanged.** This is the last
of the four playtest features.

## 2. Codebase Analysis

**Render loop — `src/main.ts`:**
- `frame(now)` (`:410-425`): `sim.advance`; `if (dirty) { renderer.render(world,
  camera); dirty = false; }`; sim-gated `syncDock`; `requestAnimationFrame`.
  Render happens ONLY on `dirty` → the canvas is frozen between edits.
- Dirty triggers to route through `invalidateBase()` (the full enumeration):
  `markDirty`/`onChange` (pan/zoom, `:355`), opening dismiss (`:118`),
  `onSelect` (`:170`), `applyAt` ok (`:332`) + its `previewAt` (`:317`),
  `cycleOverlay` (`:297`), `clearHover` (`:362`), `resize` (`:379`), and the sim
  tick's eco/civic overlay re-push (`:395`, `:402`). Each sets `dirty = true`.
- `const ambientRng = createRng(seed).fork('ambient')` mirrors the existing
  isolated fork `createRng(seed).fork('city-name')` (`:104`) — a fresh `Rng`
  off the seed, independent of the worldgen/sim forks.
- Dock meta wiring (`:163-178`): `getMetaButtons: () => metaButtons(...)`,
  `onMeta: (id) => …` — the seam to add `[Life]`.

**Renderer — `src/ui/renderer.ts`:** `render(world, camera)` (`:429-484`) sets
the transform, clears, and loops the visible tile range drawing terrain + built
(`builtRenderKey` atlas) + overlay tint + preview. This whole body becomes the
**base pass** (drawn to an offscreen canvas). The constructor builds the atlas
once; `resize(cssW, cssH, dpr)` (`:419`) sizes the canvas — the offscreen base
must track the same backing-store size/DPR.

**Engine reads (read-only):** `map.faunaPresence` (Uint8Array), `map.built`,
`map.idx`, `map.inBounds`; `isRoadKind`/`transportCategory`/`BuiltKind` and
`BuiltKind.RoadHighway/RoadAvenue/RoadStreet/QuietStreet/Promenade/Parklet/
CommunityGarden/Park/RewildedLand` (`fabric.ts`). `createRng`/`Rng.fork`/
`nextInt`/`chance` (`engine/rng.ts`).

**Dock content — `src/ui/dockContent.ts`:** `metaButtons(panelOpen,
activeOverlay)` → `MetaButton[]` with `id: 'tech'|'eco'|'civic'`. Extend: id
union gains `'life'`, signature gains `ambientOn: boolean`, a 4th button
`{id:'life', label:'Life (L)', active: ambientOn}`. `tests/ui/dockContent.test.ts`
asserts the button set → update it.

**Architecture guard:** new pure-ui modules MUST join `PURE_UI_ALLOWLIST`
(`tests/architecture.test.ts:86`); allowlisted ⇒ DOM-free + transcendental-free
(`exp/pow/log/sin/cos/tan/random` banned; `Math.sqrt`/`abs`/`floor`/`min`/`max`
allowed).

**Determinism test patterns:** `hashWorld(world)` (`fabric.ts`) for the
read-only pin; `createRng(seed)` + fork for the stream-isolation pin (a worldgen
run with vs without an interleaved ambient stepper yields the same hash).

## 3. Implementation Plan

**Test Command:** `npx vitest run` (full suite). Per-task: the focused file
(e.g. `npx vitest run tests/ui/ambientContent.test.ts`). Gates also include
`npx tsc --noEmit` and `npm run build`.

> Order: the pure model first (fully unit-tested, the heart), then the renderer
> split (thin shell, regression-preserving), then the main wiring (continuous
> loop + cache invalidation + pause), then the dock toggle. Each task = one
> atomic commit, RED → GREEN → REFACTOR, full suite green at every commit.

### Task 1: Pure ambient model — `ambientContent.ts`
**Files:** `src/ui/ambientContent.ts` (new), `tests/ui/ambientContent.test.ts`
(new), `tests/architecture.test.ts` (allowlist append)
**Approach:** DOM-free, transcendental-free; imports only engine types
(`GameMap`, `BuiltKind`/`isRoadKind`/`transportCategory`, `Rng`).
- `interface AmbientState { cars: Car[]; peds: Ped[]; birds: Flock[]; accMs: number }`
  (sprite fields: float `x,y` world pos, `vx,vy`, kind-specific) +
  `createAmbientState()`.
- `stepAmbient(state, map, rng, dtMs)`: `state.accMs += dtMs`; while
  `accMs >= 50` run a substep (`accMs -= 50`). Each substep: **despawn** (drop a
  car whose tile is no longer a road, a ped off its substrate, thin a flock
  where fauna dropped); **spawn** up to per-kind caps using the rules below;
  **move** (cars/peds step along the grid by integer tile or fractional toward
  the next road tile; flocks = boids: separation+cohesion+alignment vector adds,
  `Math.sqrt` normalize — NO trig). Writes ONLY `state`; `map` is read-only.
- Exported pure decision helpers (unit-test seams):
  `carWeightForRoad(kind)` → highway 3 / avenue 2 / street 1 / quiet 0 / else 0;
  `isPedSubstrate(map, x, y)` (quiet street / promenade / parklet / adjacent to
  CommunityGarden|Park|RewildedLand); `birdSpawnAt(map, x, y)` (`faunaPresence`
  ≥ threshold and not a dead zone); despawn predicates.
- Append `'src/ui/ambientContent.ts'` to `PURE_UI_ALLOWLIST`.
**Tests (RED first):**
- **Determinism:** two `createAmbientState()` stepped with the same
  `createRng(seed).fork('ambient')` + map + dt sequence → deep-equal state.
- **Fixed 50ms substep:** one `step(…,100)` deep-equals two `step(…,50)`; a
  `step(…,30)` then `step(…,70)` equals two 50ms substeps (with 0 accumulator
  left), pinning the accumulator.
- **Car class ratio:** over a fixture with equal-length highway/avenue/street/
  quiet rows + many substeps, mean car counts scale ~3:2:1:0
  (`carWeightForRoad` pinned exactly; zero on quiet/non-road).
- **Ped substrate:** `isPedSubstrate` true on quiet/promenade/parklet/
  garden-adjacent, false on street/avenue/highway/empty.
- **Bird fauna:** `birdSpawnAt` true where fauna ≥ threshold, false in dead
  zones; spawned flock size ∈ [3,7].
- **Despawn:** a car on a tile mutated to non-road (in the test, flip
  `map.built`) is gone next step; a flock over a tile whose fauna is zeroed thins.
- **Read-only:** `hashWorld(world)` byte-identical before and after N
  `stepAmbient` calls (ambient never writes the world).
**Validation:** `npx vitest run tests/ui/ambientContent.test.ts
tests/architecture.test.ts` + full suite.

### Task 2: Renderer split — cached base + sprite composite
**Files:** `src/ui/renderer.ts`
**Approach (thin shell; the pure decisions are in T1):**
- Add a private offscreen `base: HTMLCanvasElement` + `baseDirty = true`;
  `resize()` also (re)sizes `base` to the backing-store dims.
- Refactor the current `render` body into a private `drawBase(world, camera)`
  that draws terrain+built+overlay+preview **into the offscreen `base` ctx**.
- `render(world, camera)` (legacy/ambient-off path): `drawBase(...)` then blit
  `base` to the visible canvas — **behaviorally identical to today** (full draw
  on each dirty call); clears `baseDirty`.
- `invalidateBase()`: `baseDirty = true`.
- `renderFrame(world, camera, ambient)`: if `baseDirty` `drawBase(...)` +
  `baseDirty=false`; blit `base`; then draw sprites — cars as small dark rects,
  peds as 1–2px dots, birds as tiny dot clusters — at `camera.worldToScreen`
  positions, culled to the viewport. Sprite draw is the untested shell.
**Tests:** none new (DOM shell; pixel output is the live-pass gate). The
existing renderer coverage guard (renderKey⊆paintable) stays green (atlas
unchanged).
**Validation:** `npx tsc --noEmit && npm run build && npx vitest run`.

### Task 3: Main wiring — continuous loop, cache invalidation, pause
**Files:** `src/main.ts`
**Approach:**
- `let ambientOn = true;` (PRD Q2 default-on), `const ambientState =
  createAmbientState()`, `const ambientRng = createRng(seed).fork('ambient')`.
- Route **every** dirty trigger through one helper:
  `const markDirty = () => { dirty = true; renderer.invalidateBase(); }` and
  replace the inline `dirty = true` sites (onSelect, applyAt, previewAt,
  cycleOverlay, clearHover, opening dismiss, the sim-tick overlay re-push) with
  `markDirty()`. (Enumerated in §2 — pin the set in a comment.)
- Frame loop: after `sim.advance`, if `ambientOn && !document.hidden`:
  `stepAmbient(ambientState, world.map, ambientRng, now - last)`;
  `renderer.renderFrame(world, camera, ambientState)`; (base rebuilds inside iff
  invalidated). Else today's `if (dirty) { renderer.render(...); dirty=false; }`.
  Keep `last`/dt bookkeeping correct across the branch.
- `document.addEventListener('visibilitychange', …)`: on becoming visible,
  reset `last = performance.now()` (so dt doesn't jump) and `markDirty()`.
- A toggle closure `setAmbient(on)` flips `ambientOn`, `markDirty()`, and
  refreshes the dock meta; bind a key (`L`) through a gate like E/C
  (suppressed while the opening overlay is up).
**Tests:** none new directly (main.ts is the untested composition root by
convention); the behavior is covered by T1 (stepper) + the live pass. Guard:
`tsc` + `build` + full suite green; ambient-off path unchanged.
**Validation:** `npx tsc --noEmit && npm run build && npx vitest run`.

### Task 4: `[Life]` dock toggle
**Files:** `src/ui/dockContent.ts`, `tests/ui/dockContent.test.ts`, `src/main.ts`
**Approach:**
- `MetaButton['id']` gains `'life'`; `META_LABELS.life = 'Life (L)'`;
  `metaButtons(panelOpen, activeOverlay, ambientOn)` appends
  `{id:'life', label, active: ambientOn}` (after civic).
- `main.ts`: `getMetaButtons: () => metaButtons(techPanel.isOpen(),
  activeOverlay && {kind: activeOverlay.kind}, ambientOn)`; `onMeta` handles
  `'life'` → `setAmbient(!ambientOn)`.
**Tests (RED first):** `metaButtons(false, null, true)` includes
`{id:'life', active:true}` last; `active` tracks the `ambientOn` arg; the
existing tech/eco/civic assertions still hold (now a 4-button list).
**Validation:** `npx vitest run tests/ui/dockContent.test.ts` + full suite.

## 4. Validation Gates
```bash
npx tsc --noEmit
npx vitest run            # ambient stepper determinism/substeps/ratios/despawn/
                          # read-only; dock metaButtons; (renderer/main are shells)
npm run build             # bundles the new module + renderer split
```
Plus the **team-lead live browser pass (Chromium + WebKit)** for AC #10: cars
thick on freeways/avenues and absent from quiet streets; pedestrians on the
calm/green streets; bird flocks over the wild/healed edges; smooth ~60fps with
the base-cache composite at zoom 1; the [Life] toggle on/off; tab-hidden pauses;
no stale base under the sprites.

## 5. Rollback Plan
Each task is an isolated commit and the feature is additive + flag-gated.
Reverting Task 4 drops the toggle (ambient stays on via the default); reverting
Task 3 restores the dirty-only loop (ambient dormant); reverting Task 2 restores
the single-pass `render`; reverting Task 1 removes the module. With ambient OFF
the render path is exactly today's, so a fast kill switch is `ambientOn = false`.
No save format, no migration, no world-state involvement (`AmbientState` is
renderer-side only).

## 6. Uncertainty Log
- **Base-cache invalidation completeness** — the one real hazard. The §2/§3
  enumeration must catch every dirty source; a seam comment pins the set and the
  ambient-off regression (render parity) backstops it. Re-grep `dirty = true` /
  `markDirty` at execute time to confirm none were missed.
- **No-trig motion** — boids with `Math.sqrt` normalization + grid-following
  cars/peds are confirmed expressible without sin/cos; if a smoother bird motion
  later wants trig, keep the *decisions* allowlisted and move only that math to
  the renderer shell (not planned).
- **Sprite caps / rates** are placeholder (live-pass tuned); the *ratios* (car
  class 3:2:1:0, ped substrate, bird fauna, flock 3–7) are the tested contract.
- **Default-on** (PRD Q2) — assumed; trivially flipped if the live pass finds it
  distracting.
- **dt across the visibility pause** — reset `last` on resume so the accumulator
  doesn't fast-forward; pinned by the 50ms-substep test's accumulator behavior.
