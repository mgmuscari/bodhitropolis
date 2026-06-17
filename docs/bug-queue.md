# Bug queue & active direction

Maddy reports bugs as she playtests; Claude **records them here** (need not fix immediately) and
**checks this list when touching related code** — fix opportunistically since the code overlaps.

Status: 🔴 open · 🟡 in progress · ✅ fixed (note the PR)

## PLAYTEST ROADMAP (Maddy, 2026-06-17) — sequenced

The decline spiral "feels fairly accurate" (Detroit) — KEEP it; the game is decline ↔ **revival**.
Revival = make a pocket worth living in (greens + calm → land value → occupancy → spreads). Build order:

1. 🟡 **Bigger generated city / fill the map** — first increment SHIPPED (PR pending): ~2× the city
   (alive parcels ~150→335) by scaling the GROWTH eras (era2 rings 2→6 + era2Parcels 90→200, era4
   spurs 10→24 + houses 55→140), leaving era1 founding/site UNCHANGED (its params drive site scoring →
   moving them clips the grid; learned the hard way). Core density left original so era4 offices keep
   their room. Still ~half the map is green — can push rings/spurs further. Stretch (not done):
   **satellite grids / density pockets connected by freeways**.
2. 🔴 **Legibility quick-wins** (cheap, high value — she's flying blind): plot LETTERS SNES-style
   (R1/R2/R3, C, I, civic glyphs) on each parcel; inspect tool NAMES the thing + gives real info
   (currently just an id number); fix the TOOLBAR — fixed bottom location blocks the lower map after
   techs unlock → categorize behind MENU TILES (transit / residential / civic / …) + make it not
   occlude the map.
3. 🔴 **Revival payoff (deterministic-growth seam)** — zero-occupancy homes decay to RUINS; sustained
   healing rebuilds/densifies them. Sample the live occupancy signal into the hashed stock. (Subsumes
   the old "building decay → ruins" item. May loosen the #51 occupancy floor so blocks can truly die.)
4. 🔴 **DESIGN (paradigm, not a quick fix): classic construction tools** — Maddy wants "original"
   tools: R/C/I zoning, plain streets, **power plants + a real power grid**. TODAY power is NOT
   simulated (EnergyNode is just a placeable building, no grid); the model is tech-tree placement, not
   zoning. Bringing back zoning + utilities is a paradigm decision — discuss scope before building.

## ACTIVE DIRECTION

**Agent-driven simulation.** Mutate from SimCity's 1989 aggregate/cellular-automata layers into an
AGENT-DRIVEN sim with the same kinds of layers (traffic, pollution, land value…), emergent from the
actual travelers. **Determinism: "seeded world, live dynamics"** — worldgen/ecology/civic stay seeded
+ reproducible (N=120 gate over the seeded starting world); dynamic layers live in the live agent
layer (non-deterministic).

- ✅ **Traffic is now agent-driven** (PR pending): the deterministic O-D generator (`generateTraffic`)
  is retired; cars lay a live `state.traffic` field as they drive, the A\* car pathfinder routes
  AROUND congestion, and peds shun it. `map.traffic` stays 0 (out of the dynamic loop; seeded-world
  determinism unaffected).
- ✅ **Pollution is now agent-driven** (PR #48): cars emit a live `state.pollution` field on the tiles
  they drive (heavier on freeways / in congestion, `pollutionEmit`), it lingers as smog and decays
  slowly, peds shun it (`pedCost`), and it renders as a grey haze. Built on the new `ScalarField`
  abstraction (PR #47). Live-verified: smog concentrates on the freeway interchange, clear over calm
  green blocks. Non-hashed — determinism gate intact.
- ✅ **`ScalarField` abstraction** (PR #47): `layField`/`decayField`/`sampleField` — the one shape
  behind wear / water-pollution / traffic / air-pollution, so each layer is a thin lay/decay/read.
- ✅ **Land value is now agent-emergent** (PR #49): a DERIVED live field `state.landValue` recomputed
  on a slow cadence over inhabited plots (`landValueAt`: healed land + amenity proximity, distance-
  weighted, MINUS the worst nearby pollution/traffic/blight). Steers citizen destinations
  (`nearestOfCategory` pulled toward value) and renders as a slate→gold overlay. Live-verified range
  0–96 in the blighted start (slate near arterials/freeway); climbs as the player heals. Non-hashed.
- ✅ **Population is now agent-emergent** (PR #50): a LIVE per-home `state.occupancy`, seeded from the
  census baseline, drifting on a slow cadence toward its building capacity (`capacityOf`) where the
  land is prized/clean/healthy and toward empty where it's blighted/smoggy (`occupancySignal` +
  `occupancyStep`). Total occupancy drives the spawn target (`spawnTargetFor`) and home weighting.
  Live-verified: the blighted car-city net-declines under its own traffic/pollution (465→350 over 25s,
  homes emptying near the worst blight) — metastable, reversible by healing. Non-hashed; the seeded
  building stock is untouched (buildings appearing/disappearing = the deferred deterministic-growth
  seam). **Arc complete: traffic → pollution → land value → population are all agent-emergent.**
  Tuning (OCC_RATE / OCC_LV_NEUTRAL / OCC_OUT_FRACTION) is provisional — dial during playtest.

## Open

- ✅ **Ghost town: population spiralled to empty** (PR pending) — occupancy declined monotonically to
  ~0 (no populated equilibrium). Root cause (diagnosed live): building-HEALTH dominated the occupancy
  signal (≈half the homes negative, ~none positive in the blighted car-city → bad trips → negative
  health → decline → fewer trips that stay bad → spiral), overwhelming the self-correcting land-value
  term. Fix (architectural): land value is the ANCHOR, building-health a minor bounded nudge; add a
  per-home population FLOOR (a city thins but never fully empties); re-anchor OCC_LV_NEUTRAL at the
  live equilibrium so the start is metastable, not free-falling.
- 🟡 **Driving-ped substrate exemption is implicit** — a hidden `'driving'` ped survives the
  substrate-despawn (ambientContent substep step 1) only because boarding leaves a stale `walkTo` set.
  Make it explicit (`p.phase === 'driving'` in the exemption) so it can't break if `walkTo` is cleared.
  Surfaced while testing pollution; low priority, no live symptom.

## Fixed

- ✅ **Owned cars: no freeway 2× speed / didn't prefer freeways** (PR pending) — cars now follow a
  committed A\* `roadPath` whose `driveTileCost` makes freeways cheap, and the `driving` handler runs
  2× on `RoadHighway`.
- ✅ **Owned cars parked on freeways** (PR pending) — they park at a free non-freeway spot
  (`findParkingNear`/`findCurbSpot` exclude `RoadHighway`).
- ✅ **Owned cars stacked in street parking** (PR pending) — `findCurbSpot` excludes occupied tiles,
  so a car parks at a free spot down the block instead of on top of another.
- ✅ **Owned cars drove in circles** (PR pending) — they follow a COMMITTED least-cost path, which
  cannot circle (replaced greedy step-by-step routing).
- ✅ **No cyclists** (PR pending) — a medium leg cycles again; bike-friendly infra now just lowers the
  routing cost rather than gating the mode.
- ✅ **Cars vanish at plots / when the rider gets out** (PR #44) — citizens own persistent cars that
  park and are walked to; sim-car visualization retired.

> **Root-cause theme (resolved):** PR #41–44 hardened the sim-car path; the v2 owned-car driving was
> a separate greedy reimplementation. Fix was architectural — make car-agents follow committed
> least-cost paths + park in real free spots (one abstraction, not per-symptom patches).
