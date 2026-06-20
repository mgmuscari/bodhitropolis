# Playtest log (satellite tileset / live dynamics)

Running capture of Maddy's playtest reports so they're absorbed without thrashing. Newest at top.
`[ ]` open · `[~]` in progress · `[x]` done · `(feat)` = feature request (log, don't build until prioritized).

## 2026-06-20 — satellite look pass

- [~] **Water system redesign.** The baked water tiles are bad (esp. rivers); the de-cyan grade + subtle
  flipbook overlay reads as "bad base showing through, twinkle pops every ~2s." Target: GOOD static water
  tile as the base (kills the bad tile — "killed with fire"), plus a **subtle 10–20% alpha** animated
  twinkle that is present **100% of the time**, drawn with a **non-row-major** strategy.
- [ ] **ANTIPATTERN: per-tile row-major drawing every frame.** The water overlay fills top→bottom row-major
  and doesn't complete in a frame → animation only shows in a horizontal bar at the top. Recurring project
  problem. Needs a better strategy (tileable pattern + cached water clip, O(1) draws/frame).
- [ ] **White/silver cars floodfilled → "camouflage cars"** (white→alpha ate the body). Recolor white/silver
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

- (feat) **Pedestrians + cyclists as sprites** (like the cars, which look GREAT). Sprites BAKED
  (`public/sprites/ambient/peds`, `/cyclists`); wiring into the ped draw loop is NOT done — awaiting priority.
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

- [~] **Wavy grass / canopy gone** — removed with the row-major loop; restoring via the non-row-major
  technique (tileable wind-streak sheen scrolled over a cached grass mask, wind-aligned, subtle).
- [ ] **Multitile commercial blocks render as repeated single tiles.** Commercial (19/20) grown/large
  blocks aren't using a W×H multitile bake. Investigate: do C parcels grow to multi-tile footprints?
  If so they need multitile cells (like civic/plants); if they're adjacent 1×1s, the building-variant
  pick should differ them. Check footprint sizes + the cellKey path.

- [ ] **Blue step van sprite is a SIDE view, rotated 90° while driving** — kills vibes. The van bake
  isn't top-down. Re-bake top-down; if diffusion won't reliably give top-down vans, the validator below
  is the real fix. (Buses likely same risk.)
- (feat) **Bake VALIDATORS via LMStudio vision (gemma)** — https://lmstudio.tailea7e08.ts.net/v1/models —
  check each baked tile/sprite for correct geometry (e.g. "is this top-down?", "is the building intact
  not floodfilled?") and flag/reject failures. Would've caught the side-van, the floodfilled clinic/cars.
