# Settings menu — design (feature request, Maddy 2026-06-19)

A configuration menu so players tune the game to their machine and taste. "things like map size,
caps, etc should become configurable for different systems. i might be able to handle a larger map
with more agents than somebody on a slower pc."

## What's configurable

Two classes of setting, because they differ in cost and determinism:

### A. World settings (apply on new game / regenerate — they change the seeded world)
- **Map size** — `width`/`height` fed to `runPipeline({ seed, width, height })`. A different size is a
  different (still deterministic) world, so changing it **regenerates** (apply-on-restart, with a clear
  "new world" warning). Presets: Small / Medium (current 128²) / Large / Huge.
- (Maybe later) other worldgen budgets (city density, satellite count) — same regenerate semantics.

### B. Live performance/presentation settings (apply immediately — pure live layer, no regen)
- **Agent caps** — `PED_CAP`, the citizen spawn target divisor (`spawnTargetFor`, currently total
  occupancy ÷ 3), a car cap, `FLOCK_CAP`. These are the perf ceilings; a fast PC raises them.
- **Tileset** — `procedural` (default) vs a generated pixel-art skin. See
  `docs/art/asset-generation.md` §0.5 (tilesets are an optional skin; procedural is permanent).
- (Maybe) ambient toggles already keyed today (the `L` life toggle), overlay defaults.

## Architecture

- A typed **settings store** module (`src/ui/settings.ts` or `src/settings/…`): the schema, defaults,
  load/save to `localStorage`, and presets (Low / Medium / High for slower→faster machines). Pure-ish
  (the store value is plain data; persistence is the only DOM/`localStorage` touch — keep it out of the
  pure-ui allowlist or isolate the IO).
- A **settings panel** (DOM shell like `techPanel`/`restorationPanel`), toggled by a key + a dock
  button.
- **Consumers read the store, not hardcoded constants.** Today `PED_CAP`, `CAR_SPEED`, the spawn
  divisor, etc. are module consts in `ambientContent.ts`; migrate the *tunable* ones to read from the
  store (or accept an injected config) so a setting actually moves them. Map size feeds `main.ts`'s
  `runPipeline` at world creation.

## Determinism

- World settings change the **seeded world** → a different but still byte-reproducible world (the
  determinism gate holds per (seed, size, params)). They are NOT live-mutable.
- Live caps/tileset are the **live agent/render layer** — non-hashed, freely mutable at runtime.
- Keep the split clean: nothing in the live-settings path may perturb the worldgen hash.

## Open questions (for Maddy)
- Preset tiers + their default cap values (needs a perf pass on a slow machine to calibrate).
- Does map-size change offer to keep the same seed (same world, bigger frame) or reroll? (Same seed +
  bigger size = the world extends/regenerates around the same seed — clarify the intended semantics.)
- Which existing consts become user-facing vs internal.
