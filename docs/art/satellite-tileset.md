# Satellite tileset — generation plan

The first generated **tileset** (an optional skin over the procedural atlas — see
`asset-generation.md` §0.5; procedural stays the permanent default). Art direction set by
Maddy, 2026-06-19.

## 1. Art direction

> "Inspired by Google Maps. A top-down, patchwork view that almost resembles satellite
> photography. For legibility, a slightly stylized / cartoonish style — black outlines, etc.
> Somewhere around SimCity 2000, but **not isometric — top-down**. Architectural cues based on
> **Oakland, California**."

Concretely:

- **Top-down orthographic** (true plan view, zero perspective / no isometric skew). The camera
  looks straight down; buildings are roofs + footprints, roads are ribbons, terrain is texture.
- **Patchwork / "satellite photo" gestalt** — the whole map should read like a stylized aerial:
  parcels abut, colors vary plot-to-plot, the grain is photographic-but-simplified.
- **Cartoonish legibility** — clean shapes, **black (or near-black) outlines** around buildings
  and edges, readable at a 16 px tile and at 1–4× zoom.
- **SimCity 2000-era richness** of color/detail, minus the isometric projection.
- **Oakland cues** — Victorian/craftsman bungalows, stucco apartment boxes, flatland industrial,
  the port, hill greenery. (Thematically loaded: this is an anti-Moses, environmental-justice
  game — the art serves "decay / repair / rewild", never the neutral-developer fantasy. See
  CLAUDE.md 2026-06-17.)

## 2. The asset taxonomy (drives generation strategy)

Maddy's three categories, mapped to the renderer seam:

| Category | What | Generation | Renderer addressing |
|---|---|---|---|
| **Tesselable** | terrain (grass/forest/meadow/bare/water…), roads | one tile that **tiles seamlessly** (4-way) | terrain `${kind}-${band}` (band fan-out via `terrainKeys`); roads `road-{k}-{mask}` |
| **Multi-tile plots** | apartments (2×2), projects (2×3), power plants, civic, big footprints | generate **ONE larger pixel-art image** with seam continuity, then **slice into 16×16 cells** | `footprintCellKey(kind,w,h,col,row,tier)` — `b-{kind}-{w}x{h}-c{col}-r{row}-{tier}` (renderer tries this first, falls back to the pos/tier key) |
| **Variety** | residential (single houses, small apartments) | **5–10 distinct versions** per kind | ⚠️ needs a variant-pick seam (see §6 — not built yet) |

Everything a tileset omits **falls back to the procedural painter** per key, so a partial bake is
always shippable. The manifest (`SATELLITE_ASSETS` in `src/ui/tileset.ts`) lists ONLY committed
files; it grows as art lands.

## 3. Technical contract (non-negotiable for the renderer)

- **16×16 px per tile** (`BASE_TILE`). Tesselable tiles are 16×16; a multi-tile plot is generated
  large, then sliced to a grid of 16×16 cells. The loader normalizes any source to 16×16 on
  decode, but author at 16×16 to avoid downscale softness.
- **sRGB 8-bit PNG**, transparent alpha where a building doesn't fill its footprint cell.
- **Committed**, not generated live (determinism holds — a tileset is a pure render-time choice).
- Land under `public/tilesets/satellite/` (Vite serves `public/` at the site root →
  `/tilesets/satellite/<file>.png`). Add each committed file to `SATELLITE_ASSETS` with the exact
  atlas keys it fills (`terrainKeys(...)`, `buildingKeys(...)`, or a `footprintCellKey` list).
- **Seam continuity**: tesselable tiles must tile 4-way (top edge ≡ bottom, left ≡ right). Sliced
  plots must be cut on exact 16 px boundaries so adjacent cells line up.

## 4. Rendering efficiency (Maddy's constraint, 2026-06-19)

> "Be careful about rendering efficiency — bouncing the base layer down to one texture, that kind
> of optimization."

The single-cached-base-texture optimization is preserved and is the load-bearing one. The model:

- The renderer bakes terrain + built + overlay into ONE offscreen base canvas **once per
  invalidation** (`drawBase`), then **1:1 identity-blits** that single texture each frame
  (`composite`). A tileset changes only *what is baked in*, not the bake/blit structure — so the
  **per-frame cost is identical** to procedural (one blit + the ambient sprites).
- **16×16 contract** keeps the base texture at the same resolution → blit cost unchanged. No
  larger source textures sampled per frame.
- The **procedural atlas is painted once and cached** process-wide; a tileset swap is a shallow
  `Map` clone + `O(overrides)` set (NOT an all-keys repaint) + one base invalidation.
- Tileset PNGs are **decoded once into a canvas at load** (uniform fast `drawImage` source, no
  first-frame decode hitch).
- A tileset swap triggers exactly **one** base rebuild; thereafter it's the same cached blit.

Future scaling headroom (only if needed): pack the atlas into one sprite sheet (matters for a WebGL
path, not Canvas2D — the base bake already collapses per-tile cost to once-per-invalidation).

## 5. ComfyUI pipeline

Remote ComfyUI (MPS, healthy, big VRAM headroom). Proven fast pixel-art path (2026-06-17 logs):

- **Model**: `z_image_turbo_bf16` (Z-Image turbo, Lumina2 arch) + LoRA
  `pixel_art_style_z_image_turbo.safetensors` @ ~0.85–1.0, ~8 steps → **~2–3 s/image**.
- **Downscale**: `PixelOE` node (pixel-quantize; `pixel_size` ≤ 32) → crisp pixel art, then resize
  to the target tile/footprint size.
- Alt model: SDXL base + `pixel-art-xl` LoRA (slower, also available).

**Prompt recipe** (style suffix, every asset): `top-down orthographic view, flat overhead, no
perspective, satellite map tile, slightly cartoonish, bold black outline, clean flat shading,
16-bit era city-builder, Oakland California` + a negative of `isometric, 3/4 view, perspective,
drop shadow, blurry`.

**Runnable workflow**: the saved ComfyUI workflow **`z_image_pixelart_tile.json`** is exactly this
recipe (Z-Image turbo + `pixel_art_style` LoRA + `SeamlessTile` + `PixelOE`). Node 7 = positive
prompt; `SeamlessTile.tiling` = `enable` for tesselable terrain/roads, `disable` for buildings;
`pixel_size` ≤ 32 (true tile 32×32 → loader normalizes to 16×16 on decode).

**How to drive it (the working path, 2026-06-19)** — the MCP `enqueue_workflow` tool returns non-OK
for *any* arbitrary graph (a serialization bug — even a minimal standard SDXL graph fails), while
`generate_image` works. So POST the API-format graph to ComfyUI directly:
`curl -sX POST $COMFYUI_URL/prompt -H 'Content-Type: application/json' -d '{"client_id":"…","prompt":{…graph…}}'`
→ poll `$COMFYUI_URL/history/<prompt_id>` for the SaveImage filename → GET
`$COMFYUI_URL/view?filename=<f>&type=output`. `COMFYUI_URL=https://comfyui.tailea7e08.ts.net`. This
is fully scriptable (no UI needed); the first probe batch was generated this way.

**Probe learnings (2026-06-19, v1+v2):**
1. **Edge-to-edge is explicit.** "road reaches all four edges / fills the frame edge to edge, no
   margins, no sidewalk" gives tile-connecting roads; a scene prompt ("intersection, crosswalks")
   gives a centered traffic-circle *picture* that can't tile (Maddy's v1 note). v2 roads ran
   edge-to-edge correctly.
2. **"Bold black outline" is for BUILDINGS only.** On tesselable terrain it makes the model draw a
   border AROUND the tile (v2 grass got framed → won't tile). For terrain/roads: "no border,
   seamless, fills edge to edge" and DROP outline language.
3. **Top-down needs reinforcing.** Single-building prompts drift to 3/4 facade view (v1 houses).
   Prompt "roof seen from directly above" and/or generate the building as part of an aerial block.
4. **The dense-block tile is the strongest unit** (v1 patch, v2 block): aerial Oakland block with
   edge-to-edge streets — tiles as texture and matches the segmented-multi-tile path. Roads as their
   own art need the full 16 autotile-mask variants (heavy) — the procedural autotiler may stay, just
   restyled to the satellite palette.
5. **Roads came out drab grey-on-grey** and lost the center line — needs more color/contrast.

Per-category subject prompts:
- **Terrain (grass)**: "seamless tileable grass / lawn texture, parks green, …"
- **Terrain (water)**: "seamless tileable water, bay blue-green, gentle ripples, …"
- **Residential (Oakland)**: "single Victorian / craftsman bungalow, gabled roof seen from above,
  small yard, picket fence, …" (× 5–10 seeds for variety)
- **Apartments**: "stucco apartment block roof, flat roof with vents, … 2×2 footprint"
- **Industrial / port**: "warehouse roof, container yard, …"

## 5.5 Road structure — the next pass (Maddy, 2026-06-19)

A bare asphalt surface (even with variant cycling) reads as a "field of asphalt" on wide roads,
where there should be visible STRUCTURE: **sidewalks, setbacks, gutters, curbs, jersey barriers /
medians.** The architecturally-right way to add these (not ad-hoc painting) is a **border mask** —
the *dual* of the connection mask the autotiler already computes:

- **Connection mask** (have): which 4-neighbours ARE the same road → drives lane markings + how the
  road connects.
- **Border mask** (add): which 4-neighbours are NON-road (parcel / building / open land) → drives
  the EDGE treatment: a curb + gutter line + sidewalk strip on each bordering edge. This is where a
  road meets the city, so it's exactly where sidewalks/gutters belong. Deterministic from the map
  neighbourhood, same machinery as the connection mask.
- **Setbacks** are the parcel-side dual: a parcel draws a setback/frontage strip on edges facing a
  road (a worldgen gap or a render treatment on the building-side border).
- **Wide-corridor interior**: lane lines along the through-axis + a median/jersey-barrier between
  opposing carriageways (the un-greened sibling of `PlantedMedian`). Needs the corridor axis, which
  the wide-road model already knows.

Diffusion supplies the *surface* ingredients (asphalt ✓, a concrete/sidewalk texture, a gutter/curb
strip); the border-mask painter composites them at the edges — same split as roads (texture from
diffusion, structure procedural). This replaces "field of asphalt" with legible streetscape.

## 6. Open work / decisions (for Maddy)

1. **Variety-pick seam (not yet built)** — multi-version residential needs the renderer to pick
   variant N per parcel deterministically (a `tieHash`-style hash of the parcel anchor → variant
   index), keyed e.g. `b-{kind}-{pos}-{tier}-v{n}`. Orthogonal to the segmented-cell path; add it
   when the first residential variant set lands. Until then a single residential image per kind
   works via `buildingKeys`.
2. **Palette** — match the existing `PALETTE` / `BUILDING_STYLES` (warm dharmapunk) or depart for a
   truer "satellite" look? (Hers to set.)
3. **First slice** — recommend terrain (the patchwork ground) + Oakland residential (highest
   identity payoff) to prove the end-to-end pipeline, then expand by `BuiltKind`.
4. **Footprint resolutions** — confirm per-kind footprint sizes for the segmented plots (apartments
   2×2, projects 2×3, power plants larger) so the big-image slices map to real parcels.

## 7. Status

- [x] Renderer **tileset seam** — atlas overrides, per-key fallback, hot-swap, segmented cell keys.
- [x] Async **loader** (404→skip, decode-once-to-canvas).
- [x] **Settings** dropdown wired (live hot-swap).
- [x] Pure **registry/manifest** (`tileset.ts`) + key fan-out helpers.
- [x] Style **probes** — first batch generated 2026-06-19 (direct `curl` to `/prompt`, see §5) under
  `docs/art/probes/satellite/`: `patch` (nails the satellite-grid gestalt), `street` (clean tileable
  top-down intersection), `grass` (coarse terrain), `houses` (6-up variant sheet but 3/4 view, not
  top-down). Read: aerial/block prompts hold top-down; single-building prompts drift to facade view →
  prompt buildings as "roof from directly above" or generate as part of a block. 32-px PixelOE is
  coarse; outline/detail is weak — push LoRA weight + an outline pass + finer pixel size.
- [x] **Road surfaces via diffusion** (Maddy's call) — a tileable asphalt SURFACE is generated and
  committed (`public/tilesets/satellite/surfaces/asphalt.png`); the renderer paints the connection-
  mask lane markings over it (`@surface/road` ingredient namespace → `makeRoadTile` surface base).
  Selecting `satellite` now skins roads with asphalt + procedural lines; everything else falls back
  to the painter. First visible slice. (Asphalt is medium-grey; markings should read — verify in the
  browser, palette is a 1-line tweak if not.)
- [ ] Pin style/palette/remaining-slice (§6) with Maddy.
- [ ] Bake terrain + buildings → commit PNGs → grow `SATELLITE_ASSETS`.
- [ ] Variety-pick seam (§6.1) when residential variants land.
