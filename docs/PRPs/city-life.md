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
- Dirty triggers, **split by whether they change the cached BASE** (terrain/
  built/overlay/camera) **or only the per-frame composite** (preview/selection).
  Because the preview moves OUT of the base into the composite (CRITIC-YP2), the
  base-invalidation set SHRINKS to map/camera/overlay changes. Two named
  chokepoints (11 total triggers = 7 base + 4 preview/selection):
  - **`markDirty()` = `dirty = true; renderer.invalidateBase();`** — the **7**
    BASE-affecting triggers: `onChange`/pan-zoom (`:355`), `resize` (`:379`),
    `applyAt` ok (`:332`, mutates the built/parcel layer), `cycleOverlay`
    (`:297`), the sim tick's eco/civic overlay re-push (`:395`, `:402`), and
    opening dismiss (`:118`).
  - **`markPreviewDirty()` = `dirty = true;`** (NO `invalidateBase`) — the **4**
    preview/selection-only triggers: `previewAt` (`:317`, hover tile-change),
    `clearHover` (`:362`), `onSelect` (`:169`), `onHotkey` (`:368`). These change
    only the preview/selection, which now lives in the composite, so they must
    NOT invalidate the base — that is exactly what makes hover/tool-drag cheap
    (CRITIC-YP2: a per-tile hover no longer triggers an O(visible-tiles) base
    rebuild). They still set `dirty` so the ambient-OFF `if (dirty)` path repaints.
  Note this SUPERSEDES the YP1-era "route onHotkey through invalidateBase" fix:
  with preview no longer in the base, the stale-preview-tint hazard is gone, and
  onHotkey correctly belongs in the preview-only set. The helpers are the
  GUARANTEE; the lists are documentation.
- `const ambientRng = createRng(seed).fork('ambient')` mirrors the existing
  isolated fork `createRng(seed).fork('city-name')` (`:104`) — a fresh `Rng`
  off the seed, independent of the worldgen/sim forks.
- Dock meta wiring (`:163-178`): `getMetaButtons: () => metaButtons(...)`,
  `onMeta: (id) => …` — the seam to add `[Life]`.

**Renderer — `src/ui/renderer.ts`:** `render(world, camera)` (`:454-531`) sets
the transform, clears, and loops the visible tile range drawing terrain + built
(`builtRenderKey` atlas) + overlay tint + preview. The split (CRITIC-YP2):
terrain + built + overlay become the **base pass** (cached to an offscreen
canvas, rebuilt only on map/camera/overlay change); the **preview** — a cheap,
cursor-following 1-tile tint that changes on every hover — moves OUT of the base
INTO the per-frame composite, alongside the sprites, so a hover never invalidates
the base. The constructor builds the atlas once; `resize(cssW, cssH, dpr)`
(`:444`) sizes the canvas — the offscreen base must track the same backing-store
size/DPR.

**Sprite population + performance model (CRITIC-YP1):** the stepper is
camera-FREE (no viewport arg — for purity + determinism across pan/zoom), so it
CANNOT spawn "by visible busy-road tiles" (PRD Q1's original premise, hereby
superseded). Instead `stepAmbient` spawns **map-wide**, weighted by road-class /
ped-substrate / fauna, up to a **GLOBAL per-kind CAP** (bounded total, ~hundreds),
and locates candidates by **deterministic rng rejection-sampling** (sample K
random tiles per substep, test the spawn predicate — NEVER an O(mapArea≈65k)
full-map scan). The RENDERER culls sprites to the viewport at draw. Net: the STEP
is O(capped total), the DRAW is O(visible sprites) — the latter is exactly PRD
§2.2's "O(visible sprites) per frame" claim; the former is bounded and
frame-rate-independent. (Caps are live-pass-tuned; the cap-bounded step + viewport
cull is the contract.)

**Engine reads (read-only):** `map.faunaPresence` (Uint8Array), `map.built`
(Uint16Array), `map.idx`, `map.inBounds`; `isRoadKind` (kinds 1..3 — street/
avenue/highway) and the `BuiltKind` members `RoadHighway/RoadAvenue/RoadStreet/
QuietStreet/Promenade/Parklet/CommunityGarden/Park/RewildedLand` (`fabric.ts`).
**Car traversability is pinned to `isRoadKind` (1..3), deliberately NOT
`transportCategory`:** `transportCategory(QuietStreet=7)` returns `1` ("reads as
road", fabric.ts:534) and would admit quiet streets — letting a car *path onto*
one — whereas `isRoadKind(7)` is `false` (fabric.ts:69), so cars stay off quiet
streets at MOVEMENT as well as spawn (see YP4, Task 1). `transportCategory` is
therefore unused by ambient. `createRng`/`Rng.fork`/`nextInt`/`chance`
(`engine/rng.ts`).

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
(`GameMap`, `BuiltKind`/`isRoadKind`, `Rng`). (Not `transportCategory` — per §2,
car traversability uses `isRoadKind`, so quiet streets stay car-free.)
- `interface AmbientState { cars: Car[]; peds: Ped[]; birds: Flock[]; accMs: number }`
  (sprite fields: float `x,y` world pos, `vx,vy`, kind-specific) +
  `createAmbientState()`.
- `stepAmbient(state, map, rng, dtMs)`: **clamp first** —
  `state.accMs += Math.min(dtMs, AMBIENT_MAX_FRAME_MS)` (a module const `= 1000`,
  mirroring `FixedTickLoop.maxFrameMs`, loop.ts:36) — then while `accMs >= 50`
  run a substep (`accMs -= 50`). The clamp bounds substeps-per-call to ≤20, so a
  GC pause / debugger break / OS sleep / missed visibility reset can never spiral
  into a synchronous hang — the same spiral-of-death lesson `FixedTickLoop`
  already encodes (loop.ts:10-16,58); correctness does NOT depend on any external
  `last` reset. Each substep: **despawn** (drop a car whose tile is no longer an
  `isRoadKind` (1..3) road, a ped off its substrate, thin a flock where fauna
  dropped); **spawn** map-wide up to GLOBAL per-kind caps via deterministic rng
  rejection-sampling (sample K random tiles, test the spawn predicate — never a
  full-map O(65k) scan; §2 perf model); **move** per the motion model below.
  Writes ONLY `state`; `map` is read-only.
- **Motion model (CRITIC-YP6 — pin it; "step toward the next tile" alone
  oscillates):** each car carries a **heading** and a committed **target tile**;
  its float pos advances toward the target each substep; **on arrival** (reaching
  the target center) it recommits — picking among the target's connected
  `isRoadKind` (1..3) neighbors, **excluding the immediate U-turn** (the tile it
  came from) unless a dead-end forces it, chosen deterministically via `rng`. So a
  car flows along a road and turns at junctions instead of vibrating A→B→A; it
  can never step onto a QuietStreet (non-`isRoadKind`). Peds wander among adjacent
  substrate tiles with the same no-immediate-reversal rule. Flocks = boids:
  separation+cohesion+alignment vector adds, `Math.sqrt` normalize — NO trig.
- Exported pure decision helpers (unit-test seams):
  `carWeightForRoad(kind)` → highway 3 / avenue 2 / street 1 / quiet 0 / else 0
  (a spawn **weight**); `isCarRoad(kind)` = `isRoadKind(kind)` (the
  **traversability** predicate — quiet/non-road → false, so cars neither spawn on
  NOR move onto quiet streets; this is the seam that closes the spawn-vs-move
  gap); `isPedSubstrate(map, x, y)` (quiet street / promenade / parklet /
  adjacent to CommunityGarden|Park|RewildedLand); `birdSpawnAt(map, x, y)`
  (`faunaPresence` ≥ threshold and not a dead zone); `nextRoadStep(map, x, y,
  fromDir, rng)` → the chosen connected `isRoadKind` neighbor (excluding the
  U-turn `fromDir` unless dead-end) — the motion seam, so junction-turn behavior
  is unit-testable, not buried in the loop; despawn predicates.
- Append `'src/ui/ambientContent.ts'` to `PURE_UI_ALLOWLIST`.
**Tests (RED first):**
- **Determinism:** two `createAmbientState()` each stepped with its OWN freshly
  constructed, identically-seeded fork — `createRng(seed).fork('ambient')` built
  TWICE, never one shared instance (`Rng` is a stateful generator, rng.ts:85-117;
  sharing one fork would feed the second run already-advanced numbers and the
  states would NOT be equal) — over the same map + dt sequence → deep-equal state.
- **Fixed 50ms substep:** one `step(…,100)` deep-equals two `step(…,50)`; a
  `step(…,30)` then `step(…,70)` equals two 50ms substeps (with 0 accumulator
  left), pinning the accumulator.
- **Spiral-of-death clamp:** `step(…, 10_000_000)` runs at most
  `AMBIENT_MAX_FRAME_MS/50` (≤20) substeps and returns synchronously — pinning
  that a pathological dt cannot hang, independent of any `last` reset (mirrors
  loop.ts's `maxFrameMs` clamp). A clamped huge step deep-equals a `step(…, 1000)`.
- **Car weight (THE contract — exact/pure):** `carWeightForRoad` asserted
  EXACTLY — highway 3 / avenue 2 / street 1 / quiet 0 / non-road 0. This pure
  unit test, not any emergent count, is the load-bearing ratio pin (deterministic,
  no tolerance). AC#3's "pure ratio assertion" maps to THIS, not to spawn counts
  (CRITIC-YP7).
- **Car class ordering (emergent, fixed-seed exact):** at a FIXED stated seed over
  a fixture with equal-length highway/avenue/street/quiet rows + N substeps,
  assert the realized per-class counts as **exact integers for that seed** AND the
  **ordering** highway > avenue > street > quiet = 0 — NOT a tolerance-banded
  "~3:2:1:0" (emergent counts are seed-dependent; a bare "~" is flaky-or-vacuous,
  CRITIC-YP7). Droppable in favor of the exact weight test if it proves brittle —
  never weaken it to pass.
- **Cars never enter quiet streets (movement, not just spawn):** seed a car on a
  RoadStreet(1) tile orthogonally adjacent to a QuietStreet(7) tile; over many
  substeps it never occupies the quiet tile — `isCarRoad`/`isRoadKind`
  traversability closes the spawn-vs-move gap that `transportCategory===1` would
  open (AC#3/AC#10 "absent from quiet streets" enforced at movement).
- **Motion: no oscillation (CRITIC-YP6):** a car on a straight `isRoadKind`
  segment advances **monotonically** along it and never reverses on the next step
  (open road); at a T-junction `nextRoadStep` never returns the U-turn `fromDir`
  unless it is the only connected road (dead-end). Pins the heading/turn model so
  the central visual isn't live-pass-only.
- **Ped substrate:** `isPedSubstrate` true on quiet/promenade/parklet/
  garden-adjacent, false on street/avenue/highway/empty.
- **Bird fauna:** `birdSpawnAt` true where fauna ≥ threshold, false in dead
  zones; spawned flock size ∈ [3,7].
- **Despawn:** a car on a tile mutated to non-road (in the test, flip
  `map.built`) is gone next step; a flock over a tile whose fauna is zeroed thins.
- **Read-only (AC#7 pin a):** `hashWorld(world)` byte-identical before and after
  N `stepAmbient` calls (ambient never writes the world).
- **Stream isolation (AC#7 pin b — distinct from pin a):** a worldgen+sim run
  (`runPipeline` + N `FixedTickLoop`/`simTick` advances) yields `hashWorld` H; an
  identical run with `stepAmbient(...)` interleaved between the sim advances yields
  the SAME H. Ambient draws only from `createRng(seed).fork('ambient')`, never the
  worldgen `rootRng = createRng(opts.seed)` (pipeline.ts:42,45), so no
  sim/worldgen stream is advanced. Pin (a) proves no map writes; pin (b) proves no
  rng-stream advance — a future shared-rng refactor would pass (a) yet fail (b),
  which is exactly why this cheap, correct-by-construction pin is worth fixing.
**Validation:** `npx vitest run tests/ui/ambientContent.test.ts
tests/architecture.test.ts` + full suite.

### Task 2: Renderer split — cached base + sprite composite
**Files:** `src/ui/renderer.ts`
**Approach (thin shell; the pure decisions are in T1):**
- Add a private offscreen `base: HTMLCanvasElement` + `baseDirty = true`;
  `resize()` also (re)sizes `base` to the backing-store dims.
- Refactor the current `render` body into a private `drawBase(world, camera)`
  that draws terrain+built+overlay **into the offscreen `base` ctx** — **NOT the
  preview** (preview moves to the per-frame composite, CRITIC-YP2) —
  using the EXACT setup today's `render` uses: `baseCtx.setTransform(dpr,0,0,dpr,
  0,0)` + **`baseCtx.imageSmoothingEnabled = false`** (renderer.ts:457-458) — the
  base ctx scales BASE_TILE→ts, so without smoothing=false the pixel-art blurs.
  `base` is backing-store sized (`cssW*dpr × cssH*dpr`, matching the visible
  canvas), so tile draws land at identical device pixels.
- **Composite/blit spec (the parity-critical detail):** to put `base` on the
  visible canvas, set the visible ctx to **IDENTITY** (`setTransform(1,0,0,1,0,
  0)`) and `drawImage(base, 0, 0)` 1:1 (same backing-store dims → no rescale);
  the visible ctx ALSO sets `imageSmoothingEnabled = false` so the blit never
  re-smooths. The sprite pass then RESTORES `setTransform(dpr,0,0,dpr,0,0)` and
  draws at `camera.worldToScreen` CSS-space coords (camera.ts:57-60). Full
  sequence per frame: `drawBase` (dpr→base) → identity blit base→visible → dpr
  sprite draw. Getting this wrong is double-scale (blit under dpr) or blur
  (smoothing on) — the two vectors YP5 flags.
- A private `composite(world, camera)` does the shared per-frame work, in THREE
  explicit steps: (1) if `baseDirty`, `drawBase(...)` + `baseDirty=false`; (2)
  identity-blit `base` to the visible canvas; (3) **(dpr transform) draw the
  preview on top** (the hover/drag tint — it lives in the composite now, NOT the
  base). Both entry points call `composite`, so the preview is ALWAYS drawn.
- `render(world, camera)` (legacy/ambient-off path) = `composite(...)` =
  **drawBase (iff dirty) + blit + preview, NO sprites** — **output-identical to
  today** (terrain+built+overlay+**preview**), now cache-optimized: the base
  rebuilds only when invalidated and the preview always redraws, so a hover
  (preview-only `dirty`) is a cheap blit+preview, NOT a full O(visible-tiles)
  redraw (CRITIC-YP2).
- `invalidateBase()`: `baseDirty = true`.
- `renderFrame(world, camera, ambient)` = `composite(...)` (**drawBase iff dirty
  + blit + preview**) **then** (dpr transform) draw sprites — cars as small dark
  rects, peds as 1–2px dots, birds as tiny dot clusters — at
  `camera.worldToScreen` positions, culled to the viewport (the O(visible sprites)
  draw, §2 perf model). So both paths draw the preview; renderFrame adds sprites
  on top. Sprite pixel
  output is the untested shell.
**Tests:** The renderer is a DOM shell and — in the current node test env (no
jsdom; `renderKey.test.ts` imports only renderer's exported *sets*, never
`new Renderer`, because `buildAtlas` derefs `document`) — pixel output stays the
live-pass gate. But two cheap headless backstops on the cache LOGIC are feasible
behind a minimal `document` shim + recording 2D-context (`vi.stubGlobal`), and
should be added (CRITIC-YP8):
- **Base dims track `resize`:** after `resize(cssW,cssH,dpr)`, the offscreen
  `base` width/height `=== Math.round(cssW*dpr)`/`Math.round(cssH*dpr)` (matches
  the visible canvas — the robust, low-cost guard against the backing-store/DPR
  hazard the blit depends on).
- **`invalidateBase()` gates the rebuild (spy on `drawBase`):** `drawBase` runs
  exactly ONCE on the first frame and on each frame PRECEDED by `invalidateBase()`;
  a frame with NO preceding `invalidateBase()` does NOT call `drawBase` (it blits
  the cached base) — asserted for BOTH `render()` (ambient-off) and `renderFrame()`
  (ambient-on). This is the headless proof that a preview-only/hover `dirty` no
  longer rebuilds the base (CRITIC-YP2) and that base-affecting changes do.
If the shim proves too heavy at execute time, fall back to the live pass for the
spy and keep the dims assertion (which needs no recording ctx), relying on the
precise smoothing/transform spec above; record that decision in the commit. The
existing renderKey⊆paintable guard stays green (atlas unchanged).
**Validation:** `npx tsc --noEmit && npm run build && npx vitest run`.

### Task 3: Main wiring — continuous loop, cache invalidation, pause
**Files:** `src/main.ts`
**Approach:**
- `let ambientOn = true;` (PRD Q2 default-on), `const ambientState =
  createAmbientState()`, `const ambientRng = createRng(seed).fork('ambient')`,
  and a SEPARATE ambient clock `let lastAmbient = performance.now()`. The sim's
  `last` is never touched by ambient (see the frame-loop + visibility bullets —
  YP3: two independent clocks).
- **TWO named dirty helpers** (CRITIC-YP2 — preview moved to the composite, so the
  BASE-invalidation set shrank to map/camera/overlay changes): extend the existing
  `markDirty` at `:95-97` (today only `dirty = true`) to
  `const markDirty = () => { dirty = true; renderer.invalidateBase(); }`, and add
  `const markPreviewDirty = () => { dirty = true; };` (no invalidateBase). Wire:
  - `markDirty()` → the **7 BASE sites**: `applyAt` ok (`:332`), `cycleOverlay`
    (`:297`), the sim-tick eco/civic re-push (`:395`/`:402`); plus `onChange`/
    pan-zoom (`:355`), opening dismiss (`:118`), `resize` (`:379`) which already
    call `markDirty`.
  - `markPreviewDirty()` → the **4 preview/selection sites**: `previewAt`
    (`:317`), `clearHover` (`:362`), `onSelect` (`:169`), `onHotkey` (`:368`).
    These set `dirty` (so the ambient-off path repaints) but MUST NOT invalidate
    the base — preview lives in the composite now; this is the hover-thrash fix.
    `applyAt`'s trailing `previewAt` re-tint is fine — `applyAt` already
    `markDirty()`'d the base.
  **The helpers are the GUARANTEE; §2 is documentation.** Forward rule: a base/
  camera/overlay change calls `markDirty()`; a preview/selection-only change calls
  `markPreviewDirty()` — never a raw `dirty = true`. Pin both sets in a seam
  comment; re-grep `dirty = true` at execute time to confirm zero un-routed sites.
- Frame loop: the **sim path is UNCHANGED** — `sim.advance(now - last); last =
  now;` exactly as today (do NOT fold the ambient dt into `last`). THEN, if
  `ambientOn && !document.hidden`:
  `stepAmbient(ambientState, world.map, ambientRng, now - lastAmbient)`;
  `lastAmbient = now`; `renderer.renderFrame(world, camera, ambientState)` (base
  rebuilds inside iff invalidated). Else today's `if (dirty) { renderer.render(...);
  dirty=false; }`. The two clocks are independent: `last` drives the sim (its
  `FixedTickLoop` clamp owns catch-up), `lastAmbient` drives ambient (its own
  Task-1 clamp owns catch-up) — so ambient timing can NEVER perturb sim timing.
- `document.addEventListener('visibilitychange', …)`: on becoming visible, reset
  **`lastAmbient = performance.now()`** (so the ambient dt doesn't jump) and
  `markDirty()`. **Do NOT reset the sim's `last`** — resetting it would suppress
  the sim's legitimate post-stall catch-up (`FixedTickLoop` clamps a long hidden
  gap to `maxFrameMs`=1000 → ~10 ticks at `SIM_TICK_MS`=100, loop.ts:36,58 /
  main.ts:52,411), silently changing sim behavior on every tab-resume. Leaving
  `last` alone keeps the sim byte-identical to today whether ambient is off OR on
  (AC#7 / "no sim logic change"). The ambient clamp (Task 1) already makes a
  missed reset harmless, so this handler is for smoothness, not safety.
- A toggle closure `setAmbient(on)` flips `ambientOn`, resets `lastAmbient =
  performance.now()` when turning ON (so the first ambient dt after a dormant
  period is small — also clamp-guarded), `markDirty()`, and refreshes the dock
  meta; bind a key (`L`) through a gate like E/C (suppressed while the opening
  overlay is up).
**Tests:** none new directly (main.ts is the untested composition root by
convention); the behavior is covered by T1 (stepper) + the live pass. Guard:
`tsc` + `build` + full suite green; ambient-off path unchanged.
**Validation:** `npx tsc --noEmit && npm run build && npx vitest run`.

### Task 4: `[Life]` dock toggle
**Files:** `src/ui/dockContent.ts`, `tests/ui/dockContent.test.ts`, `src/main.ts`
**Approach:**
- `MetaButton['id']` gains `'life'`; `META_LABELS.life = 'Life (L)'`;
  `metaButtons(panelOpen, activeOverlay, ambientOn: boolean)` — a **REQUIRED 3rd
  param** — appends `{id:'life', label, active: ambientOn}` (after civic).
- **Call-site churn (CRITIC-YP5 — `tsc` errors until ALL are updated, fix in the
  SAME commit):** the new required param breaks every 2-arg caller. Update
  `main.ts:173` → `getMetaButtons: () => metaButtons(techPanel.isOpen(),
  activeOverlay && {kind: activeOverlay.kind}, ambientOn)`, and every 2-arg call
  in `tests/ui/dockContent.test.ts` (`:6,11,15,22,29,36,44`). `onMeta` handles
  `'life'` → `setAmbient(!ambientOn)`.
**Tests (RED first):** the existing exact-array assertions **BREAK and must be
rewritten**, not "preserved" (CRITIC-YP5): `dockContent.test.ts:7-8` assert the
id array `['tech','eco','civic']` and the exact label array — both become the
4-button set `['tech','eco','civic','life']` (+ the `'Life (L)'` label). Add:
`metaButtons(false, null, true)` puts `{id:'life', active:true}` LAST; `active`
tracks the `ambientOn` arg (true↔false); the tech/eco/civic active-flag logic is
unchanged (now within a 4-button list).
**Validation:** `npx vitest run tests/ui/dockContent.test.ts` + full suite.

## 4. Validation Gates
```bash
npx tsc --noEmit
npx vitest run            # ambient: determinism/substeps/spiral-clamp/weight+
                          # ordering/quiet-traversal/motion/despawn/read-only/
                          # stream-isolation; renderer base-dims + invalidate-spy;
                          # dock metaButtons (4-button); (main is a shell)
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
- **Base-cache invalidation completeness** — the one real hazard, now SMALLER:
  CRITIC-YP2 moved the preview out of the base into the per-frame composite, so
  the base-invalidation set shrank to the **7** map/camera/overlay triggers
  (`markDirty`), with the **4** preview/selection triggers on a separate
  `markPreviewDirty` (dirty-only). The two named helpers are the GUARANTEE; §2 is
  documentation. Forward rule: base/camera/overlay → `markDirty()`; preview/
  selection-only → `markPreviewDirty()`; never a raw `dirty = true`. A seam
  comment pins both sets; an execute-time re-grep of `dirty = true` confirms zero
  un-routed sites. (The earlier YP1 "route onHotkey through invalidateBase" fix is
  SUPERSEDED — with preview out of the base the stale-tint hazard is gone and
  onHotkey is correctly preview-only. The split also de-risks hover/tool-drag: a
  per-tile hover is now a cheap blit+preview, not an O(visible-tiles) rebuild.)
- **No-trig motion** — boids with `Math.sqrt` normalization + grid-following
  cars/peds are confirmed expressible without sin/cos; if a smoother bird motion
  later wants trig, keep the *decisions* allowlisted and move only that math to
  the renderer shell (not planned).
- **Sprite caps / rates + perf model** (CRITIC-YP1) — the stepper is camera-FREE
  and spawns map-wide up to GLOBAL per-kind caps via rng rejection-sampling (no
  O(65k) full-map scan); the renderer culls to the viewport at draw. STEP is
  O(capped total), DRAW is O(visible sprites) (PRD §2.2's claim). Caps/rates are
  placeholder (live-pass tuned); the tested contracts are the exact
  `carWeightForRoad` (3/2/1/0), ped substrate, bird fauna, flock 3–7, and the
  fixed-seed count ordering. SUPERSEDES PRD Q1's "visible busy-road tiles" spawn
  premise (a viewport-coupled spawn would break determinism on pan).
- **Motion model** (CRITIC-YP6) — cars carry a heading + committed target and
  recommit at junctions to a connected `isRoadKind` neighbor excluding the U-turn
  (rng-deterministic), so traffic flows instead of oscillating; peds wander
  substrate with the same no-immediate-reversal rule. Pinned by the
  no-oscillation motion test (the `nextRoadStep` seam). Boids stay sqrt-only.
- **Default-on** (PRD Q2) — assumed; trivially flipped if the live pass finds it
  distracting.
- **dt across the visibility pause** — resolved by a SEPARATE `lastAmbient` clock
  (YP3): the sim's `last` is NEVER reset (preserving its post-stall catch-up, so
  sim output is byte-identical to today — AC#7), and a pathological ambient dt is
  bounded by the Task-1 `AMBIENT_MAX_FRAME_MS` clamp (YP2) rather than by any
  external reset. The visibility handler resets only `lastAmbient`, for
  smoothness not safety. This supersedes PRD Q4's shared-`last`-reset premise,
  which would have silently dropped ~10 sim ticks per tab-resume.
- **Accumulator spiral guard** (YP2) — `stepAmbient` clamps `dtMs` to
  `AMBIENT_MAX_FRAME_MS` (=1000, mirroring `FixedTickLoop.maxFrameMs`, loop.ts:36)
  so substeps/call ≤20; a GC pause, debugger break, OS sleep, or missed
  visibility reset cannot hang the frame. Pinned by the spiral-clamp test.
- **Car traversability** (YP4) — pinned to `isRoadKind` (1..3), NOT
  `transportCategory` (which returns 1 for QuietStreet, fabric.ts:534). Cars are
  absent from quiet streets at MOVEMENT, not only spawn; pinned by the
  cars-never-enter-quiet test. `transportCategory` is unused by ambient.
