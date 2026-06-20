# Hybrid satellite renderer — diffusion tiles × real-time procedural shader

**Status:** ground broken (2026-06-19). The bake-independent foundation is landed and live-verified:
the CPU→GPU data bridge (`src/ui/satelliteFormat.ts` + `src/ui/gridTextureBridge.ts`), the WebGL2
procedural pass (`src/ui/satelliteShader.ts` — anti-plaid terrain, animated water, road centerlines
from the adjacency mask, single-pass raymarched drop-shadows), and a `?shaderdemo` harness proving the
pass on a synthetic world (~50 FPS on *software* WebGL in a container → 60 on a GPU). What remains is
**phase 2**: pack the baked diffusion tiles into the albedo atlas the shader samples, then wire the
path to the live world behind `?shader`. That phase depends on the satellite tileset
(`satellite-tileset.md`) finishing its bake.

## Vision

A **hybrid** of the two satellite approaches, not a choice between them:

- **Diffusion tiles own IDENTITY** — the committed Oakland-satellite PNGs (terrain via Tile-ControlNet,
  buildings via txt2img + alpha; see `satellite-tileset.md`) are the base **albedo**. They carry the
  art-directed look that pure procedural noise can't: craftsman roofs, bay water, the patchwork.
- **A WebGL2 fragment shader owns DYNAMICS + DEPTH + VARIATION** — it samples those tiles as a texture
  atlas and adds, in a single 60 FPS pass, what static tiles can't: animated water, raymarched
  drop-shadows from building height, noise-broken tile repetition (kills the "plaid"), SDF shoreline
  blending, and sim-data-driven glow (wellbeing, traffic, pollution).

So: **tiles = what a place IS, shader = how it LIVES and catches light.** Neither alone is enough — a
pure-procedural shader looks generically noisy (no Oakland identity); a pure-tile atlas is static and
repeats. The hybrid is the point.

This is a new **WebGL2 render path** alongside the current Canvas2D renderer (`renderer.ts`, the
single-cached-base-texture + 1:1 blit model). It is feature-flagged and additive — Canvas2D stays the
default/fallback; the shader path is opt-in until proven. The determinism gate is untouched: the
shader is render-only, fed from the same hashed world state.

## 1. Data pipeline & texture packing (CPU → GPU)

A low-res packed texture (`u_data_map`, the world grid, e.g. 128×128) is the only per-frame bridge to
the GPU. Built once from world state, updated via `gl.texSubImage2D` **only on the cells that changed**
(the live agent layer writes the A channel each tick; the hashed built/terrain layers write R/G/B only
on edits). One `Uint8Array`, four channels:

| Chan | Meaning | Source in our model |
|---|---|---|
| **R** Tile type | 0 empty/grass · 1 road · 2 residential · 3 commercial · 4 water · 5 industrial/civic (+ our full `BuiltKind` fan-out — see note) | `kindOf()` terrain + `BuiltKind` → a packed type enum |
| **G** Density/Height | 0–255 building floors / road class (street↔highway) | building tier/footprint height; `transportCategory` for roads |
| **B** Adjacency mask | 8-bit road-connection bitmask N=1 E=2 S=4 W=8 | exactly our `transportMask` (`fabric.ts`) — already computed |
| **A** Sim data | dynamic scalar: traffic density / wellbeing glow / emission | the live layer — pollution, traffic, civic fields (`ambient`) |

Note: Bodhipolis has far more than 6 tile types (`BuiltKind` 16–62, plus the eco/tech buildings). The
R channel packs a **type index**; the shader's tile-atlas lookup (below) resolves index → atlas cell,
so we are not limited to the 6 archetypes in the original spec. The 6 are the procedural-synthesis
fallback for cells with no baked tile.

`GridTextureBridge` (deliverable 2) owns this packing: world grid → bitmasks → `Uint8Array` →
incremental texture upload. It is the WebGL twin of the current `drawBase` invalidation logic.

## 2. Fragment shader pipeline (GLSL ES 3.0)

Screen-space UV → world tile via `floor(v_uv * u_grid_dim)`; local tile coord via
`fract(v_uv * u_grid_dim)` for per-tile procedural detail.

- **Hybrid albedo sample (the core of the hybrid):** for each tile, sample the **diffusion tile atlas**
  (a texture-array / atlas of our committed PNGs) at `(type, variant, localUV)` for the base color.
  Variant + a per-tile hash rotate/mirror/colour-jitter the sample so the same grass tile never reads
  twice the same way — anti-"plaid" on the GPU (the problem we hand-fixed with `surfaceVariantIndex`,
  now free and continuous). Where no baked tile exists for a type, fall back to procedural synthesis:
  - **Terrain/water:** layered fBm (Simplex/Voronoi) breaks repetition; water uses **time-dilated
    noise** to modulate specular highlights (the one thing a static tile can't do).
  - **Roads:** branch on the B-channel adjacency mask to paint lane markings / shoulders / intersection
    geometry procedurally over the asphalt albedo — the GPU version of our `transportMask` autotiler +
    the road-structure masks (`roadCurbMask`, `freewayMedianAxis`, …) already in `fabric.ts`.
  - **Structures:** deterministic per-tile hash (world-coord id) selects roof variant/colour/orientation
    where we lean procedural; otherwise the baked building tile (with its alpha) composites over the
    ground albedo — exactly the tiles-sit-on-ground model we just built.

- **SDF transitions:** blend tile-type boundaries (grass↔water shoreline, road↔parcel curb) with a
  signed-distance falloff instead of hard tile edges — softer, more "satellite photo," and it hides the
  16-px grid.

## 3. Single-pass 2D raymarched drop shadows

Depth/height without a second pass: from the fragment's world UV, step backward along
`u_sun_direction`; at each step sample `u_data_map`, compare the step count to the building height in
the **G channel**; on intersection, attenuate the fragment, using the fractional offset for a soft
falloff. Hard-cap **10–16 steps** so it stays trivial. This gives the city real volume — tall
buildings cast over their neighbours and the street — which is the single biggest "depth" win over flat
tiles, and it animates with a day cycle if `u_sun_direction` rotates.

## 4. Deliverables

Mapped to our stack (TypeScript, `src/ui/`, not standalone JS):

1. **`src/ui/satelliteShader.ts`** ✅ — WebGL2 program (`SatelliteShader`) + the vertex/fragment GLSL.
   The GLSL *source builders* (`buildVertexSource`/`buildFragmentSource`/`glslDefines`) are pure and
   unit-tested for the CPU↔GPU enum contract; the GL program + `mountSatelliteDemo` are browser code.
2. **`src/ui/satelliteFormat.ts` + `src/ui/gridTextureBridge.ts`** ✅ — the data contract (`SatType`,
   `packCell`) and `GridTextureBridge` (world grid → 4-channel `Uint8Array` → dirty-rect for
   `texSubImage2D`). Pure/DOM-free (allowlisted), reuse `transportMask`/`transportCategory`. Fully
   unit-tested.
3. **Mock/dev harness** ✅ — `?shaderdemo` route mounts `mountSatelliteDemo` on a synthetic 64×64
   world (`buildDemoWorld`: terrain bands + elevation, a lake, a road grid with traffic, contrasting
   tower blocks) proving procedural synthesis + raymarched shadows + the animation tick. Safe to open
   in a scratch browser — it returns before the live game boots.

## Relationship to the current renderer

- Canvas2D `renderer.ts` stays the default and the fallback (no-WebGL2 browsers, the determinism-safe
  baseline). The shader path is a **feature-flagged alternative backend** reading the same world.
- The **tile atlas the shader samples IS `proceduralAtlas()` + the satellite tileset** — the same key
  space (`renderKey.ts`), now uploaded as a GPU texture array instead of blitted on CPU. The
  `tilesetExport` harness already dumps every tile to PNG; that becomes the atlas-bake step.
- The live agent layer (cars/peds/fields) keeps its current draw, or migrates to the A channel + GPU
  sprites later.

## Dependencies & phasing

1. **(in-progress)** Bake the satellite tileset (terrain + building PNGs) — the shader's albedo
   source. Without baked tiles the shader is pure-procedural and loses the Oakland identity.
2. **(next, gated on the bake)** Atlas bake: pack the tileset PNGs into a single GPU texture array
   (the `tilesetExport` keyspace), and have the fragment shader composite the baked albedo over the
   procedural base per SatType (the procedural synthesis becomes the no-baked-tile fallback).
3. ✅ `GridTextureBridge` + `satelliteFormat` (CPU packing) — reuses existing masks; unit-tested.
4. ✅ `satelliteShader.ts` + `?shaderdemo` (deliverable 3) — proved the pass on a dummy grid.
5. Wire to the live world as a **settings TOGGLE** (not just `?shader`); A/B against Canvas2D; tune.
   The WebGL canvas renders the base UNDER the menu bars / UI layer (Maddy 2026-06-20). (The bridge
   already accepts a live `GameMap`; this is camera/viewport mapping + reading the live world each
   invalidation + the two-canvas stack: WebGL base ← Canvas2D sprites/overlays/UI on top.)
6. The shader is **additive, never a replacement**: the CPU dynamics (animated-water flipbook,
   wind-aligned grass sheen, smog plumes, drop-shadow-free flat look) are a PERMANENT path for
   machines that can't run WebGL2 — they look good and ship as the default. Do NOT retire them at
   parity; the shader is the opt-in high-end path (Maddy 2026-06-20).

## Open questions (for Maddy)

- **Atlas vs texture-array:** one packed sprite-sheet (simpler, one bind) vs a `TEXTURE_2D_ARRAY`
  (cleaner indexing, per-type filtering)? Lean array for the typed keyspace.
- **Height source:** buildings have no explicit height field today — derive G from `BuiltKind` +
  tier, or add a height to worldgen?
- **Scope of procedural-vs-tile per type:** terrain leans procedural (water especially); buildings
  lean tile (the alpha objects). Confirm the split per type.
- **Ambient layer:** keep CPU sprites over the shader, or fold cars/smog into the A channel + GPU?
