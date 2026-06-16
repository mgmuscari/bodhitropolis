# ADR: Live agent layer over the deterministic core

## Status: ACCEPTED
## Date: 2026-06-16
## Author: claude (with Maddy)

## Context

Bodhitropolis's simulation core is **deterministic**: `engine`, `worldgen`, `tech`, `tools`,
`ecology`, `civic`, and `traffic` are pure (no DOM, no transcendental `Math`, seeded
`rng.fork(label)` only), and "same seed → same world" is enforced by the architecture guard plus
an **N=120 double-run byte-identical** gate over `hashWorld(world)` (`tests/civic/compose.test.ts`).
The cars/pedestrians/bird flocks rendered over the map were originally treated as **cosmetic and
strictly read-only**, with a pinned invariant that the simulation is byte-identical whether or not
the ambient animation runs.

That stance blocked the game's actual core mechanic. The design crystallized as: **transportation
is the engine of the game** — cars cause pollution, walkability and pedestrian access decide whether
a building thrives, and a building's health emerges from where its citizens go and how hard the trip
is. The "ambient never touches the sim" pin had to go. But the deterministic core, the hash gate,
and cross-engine reproducibility are load-bearing (shared-seed worlds, replayable scripted builds,
the test suite) and must not be sacrificed.

## Decision

Split the simulation into **two tiers**:

- **Deterministic core (hashed, gated):** the existing pure layers. `hashWorld` =
  `map.snapshot()` (all typed-array layers, incl `traffic`) + `parcels.snapshotBytes()`. The N=120
  gate guards it.
- **Live agent layer (renderer-side, NOT hashed):** `src/ui/ambientContent.ts` + `src/citizens/`.
  It owns `AmbientState` — persistent citizens, cars, pedestrians, bird flocks, and live `Map`s for
  **building health**, **desire-path wear**, and **water-runoff pollution**. It **reads** the
  deterministic world, writes **only its own** state, is stepped on a wall-clock and drawn per
  frame, and **never writes the hashed world**. (The pure parts stay allowlisted/headless-tested —
  DOM-free, no transcendental Math — they are wall-clock-*paced*, not impure.)

`seedBlight(state, map)` bridges the two at startup: it derives the city's starting blight (wear on
hemmed-in urban ground, runoff on urban shores, home wellbeing precomputed from the nearby plot mix)
**from** the deterministic worldgen world **into** the live layer — so the city begins blighted
without any of that entering the hash.

**The placement rule for any new mechanic:** deterministic / must be saved / replayable → the core
(it writes the hash, gated by N=120). Live / visual / wall-clock-paced → the ambient layer (read the
core, own live state, render per frame). If a live signal must later drive a deterministic mechanic
(e.g. building health → growth/decline), **sample it into the sim deterministically** rather than
letting the renderer write the hash.

## Consequences

### Positive
- Rich, live transportation/health mechanics **and** reproducible worlds + a green test gate — the
  "sim identical with/without ambient" invariant actually still holds, because the sprites remain
  pure rendering and the deterministic core is what writes the world.
- New mechanics have an obvious home (the placement rule), so the core stays small and pure.
- The frame-rate-dependent animation can never corrupt the hash.

### Negative
- Live state (citizens, building health, wear, pollution) is **not part of the saved/hashed world**
  — it is recomputed each session via `seedBlight`. A future save/load must serialize it separately
  or re-derive it.
- Two places to reason about state (core vs live), and the same concept (e.g. "pollution") may exist
  deterministically *and* live until unified.
- Building health does not yet feed back into deterministic growth — the **player** currently closes
  the loop by reacting to the visible signal.

### Neutral
- A future "sample the live signal into the sim deterministically" path is available if a live signal
  needs to drive the hashed simulation.

See `README.md` → "The living city" for the player-facing description.
