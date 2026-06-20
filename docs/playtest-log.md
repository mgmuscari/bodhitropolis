# Playtest log (satellite tileset / live dynamics)

Running capture of Maddy's playtest reports so they're absorbed without thrashing. Newest at top.
`[ ]` open · `[~]` in progress · `[x]` done · `(feat)` = feature request (log, don't build until prioritized).

> **This is the raw capture stream only.** The single consolidated open backlog lives in
> **`docs/bug-queue.md` → "THE BACKLOG"**. Open `[ ]` items here are folded into it (don't track open
> work in two places).

## 2026-06-20 — satellite look pass

- [x] **Water system redesign.** (done: good static base + hybrid stochastic tiling + sloshy wind-driven overlay) The baked water tiles are bad (esp. rivers); the de-cyan grade + subtle
  flipbook overlay reads as "bad base showing through, twinkle pops every ~2s." Target: GOOD static water
  tile as the base (kills the bad tile — "killed with fire"), plus a **subtle 10–20% alpha** animated
  twinkle that is present **100% of the time**, drawn with a **non-row-major** strategy.
- [x] **ANTIPATTERN: per-tile row-major drawing every frame.** The water overlay fills top→bottom row-major
  and doesn't complete in a frame → animation only shows in a horizontal bar at the top. Recurring project
  problem. Needs a better strategy (tileable pattern + cached water clip, O(1) draws/frame).
- [x] **White/silver cars floodfilled → "camouflage cars"** (white→alpha ate the body). Recolor white/silver
  car prompts (non-white) and re-bake. Same class as the clinic white-roof bug.
- [x] River tile `(31,95)` "kill with fire" — it's the bad baked water tile; folded into the water redesign.
- [x] Smog "flash every 2s" → triangle fade-in/out envelope (no pop at loop reset).
- [x] Water foam flicker → fixed foam sites lit smoothly by the moving crest (twinkle, not per-frame random).
- [x] Grass waves direction → now follow `ambient.wind`.
- [x] Precinct = 4 repeated tiles → added 31 to multitile FOOTPRINTS + re-baked (one 2×2).
- [x] Clinic washed out (white roof floodfilled) → re-baked with slate-grey roof + red cross.
- [x] Water too cyan → deep satellite teal (stronger separate water grade).
- [x] Smog should ride prevailing wind → streams downwind.

### Feature requests (logged — build when prioritized)

- [x] **Pedestrians + cyclists as sprites** (`59831488`) — baked walk/cyclist sprites
  (`public/sprites/ambient/peds`, `/cyclists`) wired into the ped draw loop: rotated to heading +
  gait-animated under a tileset; procedural keeps mode dots.
- (feat) **Shader as a settings toggle, rendered UNDER the menu bars** (phase 5) so the shader path can be
  A/B'd live. The CPU dynamics stay as the permanent no-WebGL default.

### Process notes (Maddy)

- Absorb playtest reports by appending here and continuing — don't context-switch on every message.
- Feature requests: LOG, don't immediately build.
- Never navigate/reload Maddy's real browser; verify on the isolated container + the 4173 frozen preview.

## 2026-06-20 — input bugs (batch 2)

- [x] **'r' (redline map) hijacks Cmd/Ctrl+R** (browser reload). Keydown handler must ignore the overlay
  hotkeys when a modifier (meta/ctrl) is held.
- [x] **Drag-to-pan doesn't always release** after lifting finger/mouse — map keeps panning with cursor.
  pointerup/pointercancel not reliably clearing the drag state (pointer capture?).

## 2026-06-20 — batch 3

- [x] **Wavy grass / canopy restored** — removed with the row-major loop; restoring via the non-row-major
  technique (tileable wind-streak sheen scrolled over a cached grass mask, wind-aligned, subtle).
- [x] **Multitile R/C/I blocks render as repeated single tiles** — FIXED (non-square multitile baker + baked 18/19/20/21 grown footprints). DIAGNOSED: R/C/I parcels GROW to
  dynamic rectangular footprints (observed 19=2×1, 20=2×2, 18/21=3×3; vary by seed). Only the FIXED
  square civic/plant footprints were baked as multitile (`b-{kind}-{w}x{w}-…`), so grown R/C/I have no
  cell key and fall back to per-tile `b-{kind}-{pos}-{tier}` singles — each a *whole centered building*
  (footprint method), not composable edge pieces → an N-tile block reads as N repeated buildings. FIX
  (deferred, meaty): extend `generate-multitile.mjs` to NON-square W×H + bake the grown footprints for
  kinds 16–21 (bound the set from revival.ts growth max), so a grown block renders as ONE sliced
  building (renderer already prefers `footprintCellKey(kind,w,h,…)`). Needs growth-max enumerated first.

- [x] **Blue step van sprite was a SIDE view, rotated 90° while driving** — kills vibes. The van bake
  isn't top-down. Re-bake top-down; if diffusion won't reliably give top-down vans, the validator below
  is the real fix. (Buses likely same risk.)
- [x] **Bake VALIDATORS via LMStudio vision (gemma)** — https://lmstudio.tailea7e08.ts.net/v1/models —
  check each baked tile/sprite for correct geometry (e.g. "is this top-down?", "is the building intact
  not floodfilled?") and flag/reject failures. Would've caught the side-van, the floodfilled clinic/cars.

## 2026-06-20 — batch 4

- [x] **Civic center renders single-tile** — FIXED (worldgen 3×3 not baked; non-square multitile baker + civic 3×3 plot) (kind 23 is a 2×2, IS baked as multitile b-23-2x2 + in
  manifest). Investigate: bake cells compose to one building, or renderer not using cellKey for it?
- [x] **Yellow/orange (taxi/van) drives BACKWARDS** — FIXED (`0c3ad03e`,`7e6accfa`): added facesForward
  vision check (front must point up); bake gates cars/cyclists on facing; scanned + re-baked the 6
  backwards sprites (5 valid, bus best-effort).

## 2026-06-20 — batch 5 (big playtest report)

Renderer/look:
- [x] **Smog draws UNDER agents — should be top layer.** Z-order: smog plumes above cars/peds.
- [x] **Curb-parked cars are orthogonal to the curb — should be PARALLEL** (parallel parking).
- [x] **Normalize asphalt tiles to the same average value** (the surface variants differ in brightness).
- [x] **Road type multiplier on asphalt value** — streets lighter than avenues lighter than freeways.
- [x] **Cars need a ±% speed offset** to declump traffic (per-car jitter).
- [x] **Water (scaled/rotated tiles): oscillating sinusoidal translation along the wind vector** + angular
  drift drawn from a normal distribution (richer slosh than the current linear scroll).
- [x] **"Cloud shadows"** — an invisible cloud layer following prevailing wind casts moving soft shadows
  over ALL ground tiles + ambient props (NOT the effects/overlay layers).
- [x] **Rail crossings show graphically** (`af4df58f`) — railCrossingMask + renderer asphalt band under rails + white stop lines.
- [x] **Planted median (11): has a building in it + doesn't form a nice line** — should read as a clean
  green median strip, no building.
Sim/agents:
- [x] **Travelers can path THROUGH dividers/medians — blocked** (`9e0e7946`). Cars were already blocked via canDrive; the gap was peds — isWalkable now excludes PlantedMedian so they route around the barrier.
- [x] **Rails need TRAINS** (`1fd216ef`) — live Train agent rides the rail as a snake of cells, shuttles at dead-ends; red loco + silver cars.
- [x] **People walk around green plots with no destination** — DONE (`80b56fdb`,`a6e42ddc`): retired the
  ambient stroller pool; every agent paths to a real destination; greens are a Leisure stop in the daily
  round (reachability-gated, restorative). → THE BACKLOG §2.

## 2026-06-20 — batch 6 (deferred)

- [x] **Water lake tiles slosh — per-tile AFFINE TRANSFORMS** (`8c02c6ea`). Each visible water tile is
  redrawn per-frame with its static stochastic rotate/scale PLUS an oscillating wind-aligned translate
  + shear (`waterSloshAt`), clipped once to the cached water mask. Foam flipbook on top for twinkle.

## 2026-06-20 — batch 7 (post-feature playtest)

- [x] **Water animation tanks FPS zoomed out** (`5e553a44`) — slosh gated to zoom≥2 (zoom 1 shows the
  whole map's water = thousands of blits/frame; slosh sub-pixel there). Static base shows zoomed out.
- [x] **Pedestrians flash "rainbow road"** (`5e553a44`) — the walk frames are different-coloured PEOPLE,
  not gait frames; cycling them flashed. Each ped now shows ONE stable sprite (no animation). Cyclists too.
- [x] **Tents/junk dead-centre + too big** (`5e553a44`) — scaled down + scattered at a stable per-tile
  jitter; 1–2 junk pieces. Sprite branch gated zoom≥2.
- [~] **Encampment tents cartoonish/side-view** — re-baking with overhead "roof-from-above" prompts +
  top-down/intact validation (bake in flight).
- [~] **One ped sprite has black spots (pigpen)** — walk-4 (highest dark-pixel fraction); re-baking all 4
  peds fresh (validated top-down + intact).
- [~] **Blue vehicle orthogonal to travel, not car-like** — re-baking hatchback-blue + van-silver with
  top-down + FACING + intact validation.
