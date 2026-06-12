# PRD: Bodhitropolis Foundation

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/bodhitropolis-foundation

## 1. Problem Statement

Bodhitropolis is a dharmapunk city-builder: a modern, browser-based, heavily
modified fork of Micropolis (the GPL release of SimCity Classic). Where SimCity
models the Robert Moses school of urban planning — highways, single-use zones,
police budgets, growth as the win condition — Bodhitropolis models the repair:
the player inherits a city wrecked by a century of car-centric American
development and heals it using a tech tree rooted in New Urbanism, green
development, restorative justice, intentional communities, gift economies,
eco/solarpunk practice, and anarcho-communist organization.

**The full game vision** (this PRD's north star; later features deliver it):

- **Tech tree** rooted in: New Urbanist philosophy, green development,
  restorative justice, intentional communities, gift-based economies,
  eco/solarpunk, anarcho-communism. Unlocks gate new transit, zoning, housing,
  and utility modes. Examples:
  - Road Diets → parklets, quiet streets (car-free), bike shares, community
    garden curb strips / medians / street replacements
  - Decentralized Infra → urban composting, vertical farming, renewables,
    local grids, wastewater recycling, small modular reactors / community
    energy nodes, community AI nodes
  - Zoning/Density → ADUs, co-op housing, collective ownership, communes,
    urban bazaars, flea markets, craft fairs, maker spaces
  - Transit → streetcar revival, elevated rail, drone deliveries, bike paths,
    urban promenades
- **Ecological simulation**: fauna, flora, biodiversity, local microbiomes as
  first-class simulation layers that respond to land use.
- **Political/civic simulation**: governance, consent, community power.
- **Worldgen** inspired by Dwarf Fortress: generate terrain, then simulate one
  century of Robert Moses-esque urban development; the game opens with the
  player challenged to fix the blight.
- **Graphics**: pixel art fusing SimCity's top-down density with the comfy
  cottagecore warmth of Stardew Valley.

**Why this feature now:** none of that can be built without a platform. The
repo currently contains three legacy implementations (C/TCL, C++/Python,
Java), none of which runs in a browser. This feature creates the modern
TypeScript foundation — deterministic sim kernel, layered map model, worldgen
pipeline stage 1, and a pixel-art canvas renderer — that every subsequent
feature builds on. Per CLAUDE.md, new code goes in root `src/` and `tests/`
so methodology enforcement (hooks, TDD gates) applies.

## 2. Proposed Solution

A Vite + TypeScript + Vitest browser application with a strict
engine/renderer split:

1. **Scaffold** — Vite app, strict `tsconfig`, Vitest, `npm` scripts. Engine
   code (`src/engine/`) is pure TypeScript with zero DOM dependencies and is
   fully testable headless. The browser shell (`src/ui/`) owns the canvas.
2. **Deterministic kernel** — a seeded PRNG and a fixed-tick simulation loop
   decoupled from the render loop. Same seed → same world → same simulation,
   Dwarf Fortress-style. This determinism is load-bearing for the future
   "century of blight" historical simulation and for TDD itself.
3. **Layered map model** — a 128×128 tile grid where each tile has layered
   data: terrain (elevation, water, soil), land cover (flora), built
   environment (reserved for zones/roads/buildings), and headroom for
   ecological layers (fauna, biodiversity, microbiome) without schema breaks.
4. **Worldgen pipeline, stage 1 (terrain)** — an explicit multi-stage pipeline
   abstraction. Stage 1 generates elevation (noise), carves rivers downhill,
   pools lakes, and seeds forests/meadows by moisture. Later stages —
   settlement, the Moses century, blight — are future features that slot into
   the same pipeline.
5. **Renderer v0** — a canvas tile renderer with pan/zoom, integer pixel
   scaling, `imageSmoothingEnabled = false`, and programmatic placeholder
   tiles (dithered color swatches keyed to terrain) until a real tileset
   feature lands.

## 3. Architecture Impact

- **New top-level directories**: `src/` (engine, worldgen, ui), `tests/`.
  These are the directories the Dialectic hooks (`block-solo-implementation.sh`,
  git hooks) guard — the git hooks' Python commands must be swapped for the
  TypeScript equivalents (`npm` lint/test) as part of this feature.
- **New files (indicative)**:
  - `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
  - `src/engine/rng.ts` — seeded PRNG
  - `src/engine/loop.ts` — fixed-tick loop
  - `src/engine/map.ts` — tile grid + layers
  - `src/worldgen/pipeline.ts`, `src/worldgen/terrain.ts`
  - `src/ui/renderer.ts`, `src/ui/camera.ts`, `src/main.ts`
  - `tests/engine/*.test.ts`, `tests/worldgen/*.test.ts`
- **Data model**: typed-array-backed tile layers (e.g. `Float32Array`
  elevation, `Uint8Array` land cover) for performance headroom at larger map
  sizes; a `TileLayers` interface designed for additive extension.
- **API**: none external. Internal module boundaries: `engine` (pure),
  `worldgen` (pure, depends on engine), `ui` (DOM, depends on both).
- **Dependencies**: `vite`, `typescript`, `vitest` (dev). Zero runtime
  dependencies — noise and PRNG are implemented in-repo (small, testable,
  license-clean).
- **Legacy subtrees untouched**: `micropolis-activity/`, `MicropolisCore/`,
  `micropolis-java/` remain as reference implementations.
  `micropolis-java/src/micropolisj/engine/MapGenerator.java` is the canonical
  reference for river/forest generation feel.

## 4. Acceptance Criteria

1. `npm install && npx vitest run` passes from the repo root with all tests
   green.
2. `npm run dev` serves a page that renders a generated 128×128 terrain map
   on a canvas with visible water, shore, grass/meadow, forest, and elevation
   variation, in a pixel-art style (no smoothing/blur on zoom).
3. Worldgen is deterministic: generating twice with the same seed yields
   byte-identical layer data (asserted by test); different seeds yield
   different maps.
4. The PRNG is seeded and reproducible: a test pins exact expected outputs
   for a known seed.
5. The simulation loop runs at a fixed tick rate decoupled from render: a
   headless test advances N ticks deterministically; tick count does not
   depend on frame timing.
6. Terrain output is plausible: tests assert rivers reach map edge or water
   body, water fraction within configured bounds, forest fraction within
   configured bounds (no hand-waved "looks right").
7. `src/engine/` and `src/worldgen/` import nothing from the DOM (`window`,
   `document`, `HTMLCanvasElement`) — enforced by a test or lint rule.
8. Pan (drag or arrow keys) and zoom (wheel, stepped integer scales) work in
   the browser shell.
9. Git hooks updated: pre-commit/pre-push run the TypeScript toolchain
   (typecheck + vitest) instead of the Python defaults, and pass.
10. README section (root) documents how to run the dev server and tests.

## 5. Risk Assessment

- **Scope creep is the main risk.** The vision is a whole game; this feature
  is a platform slice. The PRP must hold the line (see Out of Scope).
- **Determinism leaks**: `Math.random()` or iteration-order dependence
  sneaking into engine code would silently break reproducible worldgen.
  Mitigation: tests pin exact seeded outputs; engine code review gate.
- **Performance at scale**: 128×128 is trivial, but layer design choices
  (object-per-tile vs typed arrays) set the trajectory for 256×256+ maps with
  ecology layers. Mitigation: typed arrays from day one.
- **Pixel-art rendering pitfalls**: canvas blurring from fractional scales or
  default smoothing. Mitigation: integer zoom steps, explicit
  `imageSmoothingEnabled = false`, device-pixel-ratio handling.
- **GPL hygiene**: the project is GPL-3 (Micropolis lineage). In-repo noise
  and PRNG implementations avoid license ambiguity from vendored snippets.
- **Hook conversion**: swapping the Python git hooks for npm equivalents
  touches methodology infrastructure; a mistake could silently disable gates.
  Mitigation: hook behavior is exercised as part of validation (criterion 9).

## 6. Open Questions

1. Map size default — 128×128 now; should worldgen parameterize size from the
   start (cheap) so 256×256 "regions" are possible later? (PRP assumes yes:
   size is a generation parameter, 128 is the default.)
2. Noise algorithm — value noise with fBm octaves is simpler to implement and
   test than true Perlin; visual difference at tile resolution is negligible.
   (PRP assumes value-noise fBm.)
3. Renderer technology — plain Canvas2D now; PixiJS/WebGL if/when sprite
   counts demand it. (PRP assumes Canvas2D; the renderer is behind a small
   interface so a swap is contained.)
4. Where does the "century of blight" historical sim live in the pipeline
   contract? (PRP assumes: pipeline stages receive and return a `WorldState`;
   history stages are just more stages — no contract change needed.)

## 7. Out of Scope

Explicitly NOT in this feature (each is a future feature with its own
PRD/PRP):

- The tech tree (any of it) and all unlockables
- Zoning, building placement, roads, player tools of any kind
- The Moses-century historical simulation and blight generation (worldgen
  stages 2+)
- Ecological simulation layers (fauna, flora dynamics, biodiversity,
  microbiomes) — the map model reserves room, nothing more
- Political/civic simulation
- Real pixel-art tilesets, sprites, animation, audio (placeholder
  programmatic tiles only)
- Save/load, UI chrome beyond pan/zoom, accessibility passes, mobile input
- Multiplayer, deployment, CI pipelines
