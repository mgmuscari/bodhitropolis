# PRD: Urban Fabric

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/urban-fabric

## 1. Problem Statement

Bodhitropolis now has a living landscape (merged PR #1: deterministic engine,
terrain worldgen, pixel-art renderer) but no city. The game's core premise —
inherit a city wrecked by a century of Robert Moses-style development and
heal it — requires a *built environment*: roads, rail, and zoned parcels with
Moses-era building kinds. The next feature after this one (the Moses-century
worldgen history sim) needs an urban fabric model to grow; the blight system
needs per-parcel condition to decay; the eventual tech tree needs a kind
taxonomy with headroom for solarpunk replacements (parklets, co-ops,
communes, vertical farms). None of that exists yet — the map's `built` layer
is a reserved, all-zero Uint16Array.

This feature is the urban fabric data model, its placement/query rules, its
rendering, and a placeholder demo stage proving the whole chain end-to-end.

## 2. Proposed Solution

1. **Built-kind taxonomy** — a `BuiltKind` code space (as-const + literal
   union, like `Water`/`LandCover`) covering Moses-era fabric: road kinds
   (street, avenue, highway), rail, and building kinds (single-family house,
   apartment block, public-housing project, commercial strip, downtown
   office, industrial, parking lot, civic). Explicit numeric headroom for
   future tech-tree-era kinds.
2. **Tile + parcel model** — roads/rail live directly in the existing
   `built` layer (one tile = one kind code). Buildings are *parcels*:
   multi-tile footprints (1×1 to 3×3) anchored Micropolis-style, with every
   covered tile carrying the kind code, plus a new `parcel` layer mapping
   tiles to entries in a `ParcelStore` (struct-of-arrays: anchor, footprint,
   kind, density, condition). Condition is the future blight driver.
3. **Placement + query rules** — pure engine functions: footprint validity
   (in-bounds, on land, unoccupied), parcel placement, road placement, road
   4-neighbor connection mask (also the renderer's autotile input), and
   parcel road-adjacency (the minimum the history sim needs to grow a city
   along roads).
4. **Renderer v1** — programmatic pixel-art tiles layered over terrain:
   connection-aware road/rail tiles (16 autotile variants from the neighbor
   mask), per-kind building tiles with footprint-aware variation
   (corner/edge/center) and condition-aware weathering, in the established
   Bayer-dither warm palette (SimCity × Stardew).
5. **`fabric-demo` worldgen stage** — a deterministic placeholder stage that
   finds a buildable site near the map center, lays a crossroads, and places
   sample parcels of every kind so `npm run dev` shows the fabric. Clearly
   marked as scaffolding the Moses-century feature will replace.

All under the locked design rules: engine/worldgen DOM-free, no
transcendental Math, seeded rng only, typed arrays, TDD.

## 3. Architecture Impact

- **Modified**: `src/engine/map.ts` (add `parcel` layer; extend `snapshot()`
  to cover new layers — run-to-run comparisons only, no pinned hashes exist),
  `src/ui/renderer.ts` (atlas + draw pass extension), `src/main.ts` (add
  demo stage to the pipeline).
- **New**: `src/engine/fabric.ts` (BuiltKind, ParcelStore, placement/query
  functions), `src/worldgen/fabricdemo.ts` (demo stage),
  `tests/engine/fabric.test.ts`, `tests/worldgen/fabricdemo.test.ts`,
  renderer-side autotile-mask tests if the mask helper lands in engine
  (it should — it is pure).
- **Data model**: one new typed-array layer (`parcel: Uint16Array`, 0 = none,
  else parcelIndex+1 → caps at 65,534 parcels, far above a 128×128 ceiling);
  ParcelStore arrays (`anchorX/anchorY/width/height/kind/density/condition`).
- **API**: engine exports only; no external surface. Architecture guard
  auto-covers the new files (directory scan).
- **Dependencies**: none added.

## 4. Acceptance Criteria

1. `npx vitest run` green, including new fabric/demo tests; `npx tsc
   --noEmit` and `npm run build` clean.
2. `BuiltKind` distinguishes at minimum: street, avenue, highway, rail,
   single-family, apartments, projects, commercial strip, offices,
   industrial, parking, civic — with documented code-space headroom.
3. Parcel placement rejects: out-of-bounds, any-tile-on-water, any-tile
   overlapping existing built/parcel tiles. Tests cover each rejection and
   the success path (all footprint tiles carry kind + parcel id; store entry
   matches).
4. Road placement marks tiles; the 4-neighbor connection mask is computed
   correctly for all 16 configurations (exhaustive test).
5. `parcelTouchesRoad` is true iff some footprint-perimeter-adjacent tile is
   a road (tested true and false cases).
6. The `fabric-demo` stage is deterministic (same seed → identical
   `snapshot()` twice), places ≥1 parcel of every building kind, every
   placed parcel passes validity, every placed parcel is road-adjacent, and
   nothing is placed on water (all asserted by tests).
7. `npm run dev` visibly renders roads with correct junction connections and
   distinguishable building kinds over terrain; pixel-crisp at all zooms.
8. Determinism rules hold: architecture guard still passes over the new
   engine/worldgen files; map `snapshot()` covers the new layers and parcel
   attributes (mutating a parcel's condition changes the snapshot — tested).

## 5. Risk Assessment

- **Encoding sprawl**: cramming kind+variant+anchor into bit-packed u16
  codes would be premature; the parcel layer + store keeps codes flat.
  Risk: two sources of truth (tile kind vs store kind) drifting — placement
  functions are the only writers; tests assert agreement.
- **Autotile scope creep**: full Micropolis-style road graphics (bridges,
  intersections with rail, diagonals) is a rabbit hole. v1 is 16 mask
  variants per road kind + rail, programmatic.
- **Renderer perf**: per-frame mask computation is O(visible tiles); cached
  atlas lookups keep it cheap at 128×128. Not a risk at this scale.
- **Snapshot semantics change**: extending `snapshot()` changes its values
  vs. PR #1 — safe (no test pins absolute hashes; determinism tests compare
  run-to-run within a build).
- **Demo-stage entrenchment**: placeholder stages have a way of becoming
  load-bearing. Mitigation: name it `fabric-demo`, mark it placeholder in
  code + PRD, and scope the Moses-century feature to delete it.

## 6. Open Questions

1. Should `density` be a parcel attribute now or derived later? (Assume:
   store a Uint8 now — the history sim will write it; zero-cost to carry.)
2. Rail under/over roads (crossings)? (Assume: v1 forbids road/rail tile
   overlap entirely; crossings are a later kind.)
3. Should the road mask helper live in engine or ui? (Assume engine —
   it is pure, the history sim may want it, and engine purity rules make it
   trivially testable.)

## 7. Out of Scope

- The Moses-century growth simulation and any blight metrics/decay (next
  feature — it grows the fabric this feature models)
- Player tools, editing, bulldozing; traffic, economy, population sim
- Tech-tree kinds (parklets, co-ops, communes…) beyond code-space headroom
- Real tileset art, sprites, animation; bridges, diagonal roads, crossings
- Pathfinding/network algorithms beyond adjacency + connection mask
