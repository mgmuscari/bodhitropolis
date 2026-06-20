# Satellite tileset generator

Build-time pipeline that skins the procedural atlas with the Oakland-satellite style by running each
procedural tile through a Z-Image **Tile-ControlNet** diffusion workflow on the remote ComfyUI.
Procedural owns STRUCTURE + game semantics; diffusion owns STYLE. Output is committed PNGs (no
dynamic diffusion in the browser — determinism intact). See `docs/art/satellite-tileset.md` §5.6.

## The loop

```
proceduralAtlas()  ──export──▶  control/<key>.png  ──ControlNet+img2img──▶  public/tilesets/satellite/<cat>/<key>.png
   (renderer)         (16×16)        (ComfyUI)                                  (16×16, committed)
```

1. **Export** the procedural control tiles (needs the dev server running + a scratch browser):
   - In a browser on `http://localhost:5173/?nointro=1`, call `window.bodhitropolis.exportTiles()`
     and save the JSON (Playwright: `browser_evaluate(..., filename: 'tileset-control-dump.json')`).
   - `node tools/tileset/split-control.mjs [dump.json]` → writes `control/<key>.png` + `control/manifest.json`.

2. **Bake** the styled tiles:
   - `node tools/tileset/generate.mjs --cat terrain,building` (resumable — skips existing outputs).
   - Writes `public/tilesets/satellite/{terrain,buildings}/<key>.png`.

3. **Manifest** — wire the baked PNGs into the renderer registry:
   - `node tools/tileset/manifest.mjs` → regenerates `src/ui/satelliteManifest.ts` (per-key
     `TilesetAsset` list, spread into `SATELLITE_ASSETS`). Select "Satellite (Oakland)" in-game.

## Modes (`TS_MODE`)

| mode | latent | structure source | use |
|---|---|---|---|
| `hybrid` *(default)* | procedural tile @ `TS_DENOISE` (0.7) | ControlNet model-patch **+** init latent | best — anchors color/footprint, adds texture, no runaway |
| `controlnet` | empty (denoise 1) | ControlNet model-patch only | over-frees on coarse 16px controls (characters appear) |
| `img2img` | procedural tile @ `TS_DENOISE` | init latent only | no controlnet; structurally safe but stylistically timid |

Knobs (env): `TS_GEN` (512), `TS_PIXEL` (32 → 16px out), `TS_LORA` (1.0), `TS_CN` (0.9 controlnet
strength), `TS_DENOISE` (0.7), `COMFYUI_URL`.

## Categories

- **terrain** (`${kind}-${band}`) and **building** (`b-{kind}-{pos}-{tier}`) are diffused per-key.
- **road** / **transport** are NOT diffused per-mask — roads use a tileable asphalt SURFACE
  (`surfaces/asphalt-*.png`) with procedural lane markings painted over (docs §5.5).

## Server requirement

The Tile-ControlNet (`Z-Image-Turbo-Fun-Controlnet-Tile-*.safetensors`) is a **model-patch**: it
must live in `ComfyUI/models/model_patches/` (loaded via `ModelPatchLoader` → `ZImageFunControlnet`),
NOT `models/controlnet/` (which `ControlNetLoader` can't parse). The MCP `enqueue_workflow` tool is
broken for arbitrary graphs, so the driver POSTs API-format graphs straight to `/prompt`.
