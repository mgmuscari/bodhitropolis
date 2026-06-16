# PRD: City Life

## Status: DRAFT
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-15
## Branch: feature/city-life

## 1. Problem Statement

The playtest's other half — after "the buttons don't work" (ui-revival) and
"zoning is very sparse" (urban-density) — was: **"the map is lifeless — would
be good to see animations of cars, flocks of birds, pedestrians, etc. these
things should all follow the impacts of the urban environment."** The city now
reads as a dense, blighted, healable place, but it is *static*: nothing moves.
A living city signals its state through motion — traffic clots the freeways,
people fill the calm streets, birds return to the healed edges. None of that is
visible.

This is the fourth and final playtest feature (ui-revival ✓ → urban-density ✓ →
rezoning ✓ → **city-life**). It is the payoff layer that makes the *other three*
legible at a glance: the wide stroads/freeways (urban-density) fill with cars,
the road diets and rezoned greens (rezoning) fill with pedestrians, and the
ecology the player heals (rezoning/ecology) brings back birds. Motion that
"follows the impacts of the urban environment" is exactly Maddy's ask.

The render loop today draws only on a dirty flag (`main.ts:413`, `if (dirty)
renderer.render(...)`), so the canvas is frozen between edits. Ambient animation
needs continuous per-frame motion without the cost of redrawing the whole map
every frame.

## 2. Proposed Solution

Ambient sprites — cars, pedestrians, bird flocks — that **read** the world and
animate over it, driven by a pure, deterministic stepper and drawn by a split
renderer that caches the static base. **Purely visual: it writes no world
state, touches no sim/worldgen rng streams, and changes no engine/worldgen/
ecology/civic/tech/tools logic.** `hashWorld(world)` is unchanged whether ambient
runs or not.

1. **Pure ambient model — `src/ui/ambientContent.ts`** (allowlisted): a typed
   sprite state + `stepAmbient(state, map, rng, dtMs)` advancing at **fixed
   50ms substeps** (frame-rate-independent). Seeded from a **new
   `fork('ambient')` stream** — consistent per world seed, isolated from the sim.
   The three kinds each *follow the urban/ecological impacts*:
   - **Cars** — spawn density by road **class**: highway 3× / avenue 2× /
     street 1×, **zero on quiet streets** (the road diet's calm made visible).
     Cars travel the road grid; traffic follows the infrastructure.
   - **Pedestrians** — on **calm/green/walkable** substrates: quiet streets,
     promenades, parklets, near community gardens/parks. The places the player
     heals fill with people; busy stroads/freeways do not.
   - **Bird flocks** — 3–7 dot flocks where `faunaPresence` is **high**,
     avoiding dead zones. The ecology layer made visible; birds return as the
     land heals.
   - Sprites **despawn** when their substrate is gone (a car on a bulldozed/
     converted road; birds where fauna collapses).

2. **Split renderer — `src/ui/renderer.ts`** : the existing full draw
   (terrain + built + overlay + preview) becomes a **base pass cached to an
   offscreen canvas**, rebuilt only when the view is dirty (map edit / pan /
   zoom / overlay / resize). A per-frame **composite** blits the cached base
   (one `drawImage`) and draws the ambient sprites on top — O(visible sprites)
   per frame, not O(visible tiles). **When ambient is off, the render path is
   exactly today's** dirty-driven full draw (no regression).

3. **Continuous loop + toggle — `src/main.ts` + `src/ui/dockContent.ts`** : when
   ambient is enabled, the rAF frame steps the ambient stepper and composites
   **every frame**; it **pauses on `document.hidden`** (visibilitychange) to
   avoid background CPU. A persistent dock **[Life]** meta-button (and a key)
   toggles it, routed through the same pure `dockContent`/`metaButtons` seam as
   ui-revival's [Tech]/[Eco]/[Civic].

## 3. Architecture Impact

**New pure module — `src/ui/ambientContent.ts`** (added to `PURE_UI_ALLOWLIST`
in `tests/architecture.test.ts` → guarded **DOM-free + transcendental-Math-free**):
- `AmbientState` (typed: cars/peds/birds with integer-ish positions + velocity,
  a dt accumulator) and `createAmbientState()`.
- `stepAmbient(state, map, rng, dtMs)`: accumulate `dtMs`, run fixed 50ms
  substeps; each substep spawns (to per-kind caps, density by the rules above),
  moves (grid-following cars/peds; sqrt-normalized boids for bird flocks — **no
  trig**, `Math.sqrt` is allowed), and despawns (substrate check). Pure in
  `(state, map read-only, rng)`. Reads `map.built` (road class via
  `isRoadKind`/`transportCategory` + the kind), `map.faunaPresence`, bounds.
- Decision helpers exported for unit tests: car-density-by-road-class, the
  pedestrian-substrate predicate, the bird-spawn-by-fauna predicate, despawn.

**Modified `src/ui/renderer.ts`**: an internal offscreen `base` canvas + a
`baseDirty` flag; `render(world, camera)` (legacy path) rebuilds the base and
blits it (today's behavior). A new `renderFrame(world, camera, ambient)`:
rebuild the base offscreen iff `baseDirty`, blit it, then draw the sprites; an
`invalidateBase()` the host calls on every dirty trigger. Sprite draw is small
`ctx` rects/dots (the thin untested shell). DPR/resize handled by reallocating
the offscreen to match.

**Modified `src/main.ts`**: `ambientOn` flag + `ambientState` +
`const ambientRng = createRng(seed).fork('ambient')` (isolated stream, mirroring
`fork('city-name')` at `:104`); the frame loop runs `renderFrame` continuously
when on (stepping the ambient stepper with real dt), else today's
`if (dirty) render()`; every existing dirty trigger also calls
`renderer.invalidateBase()`; a `visibilitychange` listener pauses/resumes the
loop; the [Life] toggle (a key + the dock button) flips `ambientOn`.

**Modified `src/ui/dockContent.ts`**: `metaButtons(...)` gains a `[Life]`
button + active flag; `main.ts` `getMetaButtons`/`onMeta` wire it to the toggle.

**Data model:** none in the engine. `AmbientState` is **renderer-side only** —
never serialized, never part of `hashWorld`. No new tile layers, no
`ParcelStore`/`BuiltKind` changes. **No new dependencies.**

## 4. Acceptance Criteria

1. **Gates green:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`;
   `src/ui/ambientContent.ts` is on `PURE_UI_ALLOWLIST` and passes the
   DOM-free + transcendental-Math-free guard (it uses only the seeded rng,
   rational/integer math, and `Math.sqrt`).
2. **Deterministic stepper (tested):** `stepAmbient` is a pure function — the
   same `(seed→fork('ambient'), map, dt sequence)` produces **identical**
   sprite state; **fixed 50ms substeps** are asserted frame-rate-independent
   (e.g. one 100ms step ≡ two 50ms steps; a 30ms then 70ms step ≡ two 50ms
   substeps at the boundary). Determinism holds headlessly (Node) and therefore
   across engines.
3. **Cars follow road class (tested):** spawn density scales **highway 3× /
   avenue 2× / street 1× / quiet-street 0** — a pure ratio assertion over a
   fixture map (and zero cars ever spawn on quiet streets/non-roads).
4. **Pedestrians follow calm/green (tested):** peds appear on quiet streets,
   promenades, parklets, and near community gardens/parks, and **not** on
   busy streets/avenues/highways — a pure predicate test.
5. **Birds follow fauna (tested):** flocks of size **3–7** spawn where
   `faunaPresence` is high and avoid dead zones (low-fauna/busy-corridor tiles)
   — a pure test over a fauna fixture.
6. **Despawn (tested):** a sprite whose substrate is removed is gone next step —
   e.g. a car on a tile that becomes non-road (bulldozed/converted) is removed;
   a bird flock over a tile whose fauna drops below the threshold thins out.
7. **Read-only + stream isolation (tested — the load-bearing safety pins):**
   `hashWorld(world)` is **byte-identical** before and after N `stepAmbient`
   calls; and the sim/worldgen output is **identical with vs without** ambient
   (ambient forks its own `'ambient'` stream and never advances a sim stream —
   a worldgen/sim determinism run is unchanged by ambient existing).
8. **Renderer split (tested where headless-possible):** the base is rebuilt only
   when invalidated; `invalidateBase()` is called by **every** existing dirty
   trigger (pan/zoom/resize/tool-apply/overlay-cycle/preview/opening-dismiss/
   overlay-tick) — enumerated and pinned at the seam level; with ambient **off**,
   the render output equals today's (regression). (The pixel composite itself is
   the live-pass gate.)
9. **Toggle + pause:** the [Life] dock button (and its key) flips ambient on/off
   through the same pure `metaButtons`/`onMeta` seam as [Tech]/[Eco]/[Civic];
   the loop pauses on `document.hidden`.
10. **Live pass (human gate), Chromium AND WebKit:** cars thick on
    freeways/avenues and absent from quiet streets; pedestrians on the
    calm/green streets; bird flocks over the wild/healed edges; smooth ~60fps
    with the base-cache composite at zoom 1; [Life] toggles motion; tab-hidden
    pauses it; no stale base under the sprites.

## 5. Risk Assessment

- **Base-cache invalidation misses (highest risk).** A dirty source that
  doesn't `invalidateBase()` shows a **stale map** under moving sprites.
  Mitigation: enumerate every `dirty = true`/`markDirty()` site in `main.ts`
  (pan/zoom via `onChange`, opening dismiss, `onSelect`, `applyAt`,
  `cycleOverlay`, hover preview, `clearHover`, resize, the eco/civic overlay
  re-push in the sim tick) and route each through one helper that sets both
  `dirty` and `renderer.invalidateBase()`; a seam test pins the set.
- **No-transcendental-Math on the allowlisted module.** The guard bans
  sin/cos/exp/pow/log, so motion must be rng + rational + `Math.sqrt`.
  Mitigation: cars/peds follow the road grid (linear, integer steps); bird
  flocks use boids (separation/cohesion/alignment as vector adds + a
  sqrt-normalize) — no trig needed. **Confirmed expressible before allowlisting.**
  Fallback (only if a motion genuinely needs trig): keep the *decisions* in the
  allowlisted module and move that one motion's math to the renderer shell —
  but the plan is a fully-pure module.
- **Performance.** The per-frame composite must stay O(visible sprites).
  Mitigation: per-kind sprite caps; the base is a single `drawImage`; the live
  pass confirms zoom-1 framerate; ambient is one-flag-revertible.
- **Determinism / read-only leakage.** If ambient accidentally read or advanced
  a sim rng stream, or wrote any world field, it would desync the sim.
  Mitigation: `stepAmbient` takes `map` as read-only and writes only its own
  `AmbientState`; the `fork('ambient')` stream is constructed from a fresh
  `createRng(seed)` instance; AC #7 pins both (hashWorld-unchanged + sim
  identical with/without ambient).
- **Regression when ambient is off.** Mitigation: the off path is the existing
  `if (dirty) render()`; the split keeps `render()` behaviorally identical (it
  just also fills the offscreen base); AC #8 asserts parity.

## 6. Open Questions

1. **Sprite caps / spawn rates?** Assume modest per-kind caps tuned in the live
   pass (e.g. cars proportional to visible busy-road tiles up to a cap; a
   handful of bird flocks). Magnitudes are placeholder; the *ratios* (car class,
   ped substrate, bird fauna) are the tested contract.
2. **Default on or off?** Assume ambient **on** by default (it's the payoff),
   with the [Life] toggle to disable; revisit in the live pass if it's
   distracting.
3. **Bird-flock motion model?** Assume lightweight boids (sqrt-normalized
   vectors) rather than scripted paths; tunable.
4. **Pause granularity?** Assume the whole rAF loop pauses on `document.hidden`
   (sim already advances on accumulated dt, so it resumes cleanly).

## 7. Out of Scope

- Real sprite **art** / animation frames (simple rects/dots now — a future art
  pass); sound.
- Any engine/worldgen/ecology/civic/tech/tools **logic** change — ambient is
  strictly read-only and visual; no new game mechanics.
- The deferred Feature-C follow-ups (Park-vs-Parklet render nudge; build-on-empty
  Park/RewildedLand); touch/mobile/accessibility/localization.
- Ambient affecting the sim (e.g. traffic feeding congestion/pollution) — a
  possible *future* coupling, explicitly not now (read-only is the invariant).
