# Bodhitropolis — Artwork Generation Requirements

Requirements for generating game graphics via the ComfyUI pixel-art pipeline.

## 0. Non-negotiable framing

**Bodhitropolis is the product. Micropolis is reference/inspiration ONLY.**

The repo carries several Micropolis implementations and the `micropolis-graphics/`
asset tree. These exist so we understand the *shape* of the problem — the tile
vocabulary, the simulation behavior, the visual grammar of a city-builder. They are
**never shipped**. No Micropolis pixel ends up in the game.

Every asset this pipeline produces is **original art for Bodhitropolis**, expressing
*its* themes and *its* `BuiltKind` vocabulary — not a re-skin of SimCity. The game
carries deliberate weight (anti-Moses / environmental-justice framing; "decay" not
"blight"; the player **repairs / restores / rewilds**, never "redevelops"). The art
must serve that, not the original's neutral-developer fantasy. See CLAUDE.md
Known Gotchas (2026-06-17 terminology, 2026-06-18 art/assets).

## 1. What the live renderer actually is

The live game (`src/`, the actively-played Vite/TS web build — **not** the legacy
subtrees) renders with **pure Canvas2D and zero image assets**. All ~450 tiles are
painted per-pixel at startup in `src/ui/renderer.ts` (`buildAtlas()` → `paintForKey()`),
keyed by `src/ui/renderKey.ts`. Cars / peds / birds / cruisers are colored rectangles.

- Base tile: **16×16 px** (`BASE_TILE`, `src/ui/camera.ts`). Integer zoom 1–4×.
- `imageSmoothingEnabled = false` — crisp pixels at every zoom.
- Multi-tile **footprints** already exist in the parcel store (`src/engine/fabric.ts`),
  so a building can legitimately occupy and be drawn across N×M tiles.
- The tile vocabulary is the `BuiltKind` enum in `src/engine/fabric.ts`.

## 2. The procedural / identity split

Diffusion cannot produce seamless, connection-mask-aware, 16×16 tiles. So:

- **Stays procedural** (the *systemic / tiling* layer): terrain dithering, road &
  rail connection masks, power-line decoration. The mask logic *is* the right
  abstraction — generated art would wreck it.
- **Generated** (the *identity* layer): the ~35 building / landmark / tech-tree
  `BuiltKind`s — houses, apartments, projects, the power plants, civic, the
  rezoning greens, the tech-tree commons. These are standalone, identity-bearing,
  and the highest visual payoff.

## 3. Pipeline (ComfyUI)

- Server: remote, `https://comfyui.tailea7e08.ts.net` (configured via `COMFYUI_URL`
  in the comfyui-mcp plugin config; see CLAUDE.md for the active-config caveat).
- Approach: generate at a workable diffusion resolution → pixel-quantize / downscale
  to crisp pixel art at the target tile/footprint size → export PNG.
- Output spec: sRGB 8-bit PNG, transparent alpha where the building doesn't fill its
  footprint, exact target dimensions (16×16 per tile, or N×M for footprints).
- Assets are **committed** (not generated live) so determinism holds.

## 4. Integration

New asset-load path in the renderer: building keys load a committed PNG into the
atlas (`atlas[key]`) instead of being painted by `paintForKey()`, with **fallback to
the procedural painter** when an asset is missing. Everything downstream
(`ctx.drawImage`) is already source-agnostic. Landing dir: a Vite-served static dir
(create `public/` or equivalent).

## 5. Open decisions (to pin with Maddy)

1. **Scope of first slice** — recommend *buildings-first* (the identity layer above),
   not all ~450 tiles. Proves the pipeline end-to-end at highest visual impact.
2. **Style direction** — hers to set, and it's thematically loaded. Palette may match
   the existing renderer palette (`PALETTE`/`BUILDING_STYLES` in `renderer.ts`) or
   intentionally depart. Needs a coherent look across all kinds.
3. **Footprint resolution** — generate at 16×16 per tile, or at full footprint size
   (e.g. a 2×2 building at 32×32, a power plant larger) for richer detail.

## 6. Status

- [x] Remote ComfyUI wired up and reachable.
- [ ] Confirm available pixel-art models / LoRAs on the remote.
- [ ] Pin scope + style + footprint resolution (§5).
- [ ] Build the generation workflow; generate the first kind as a vertical slice.
- [ ] Add the atlas asset-load path + procedural fallback.
