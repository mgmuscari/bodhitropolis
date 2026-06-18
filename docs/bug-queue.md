# Bug queue & active direction

Maddy reports bugs as she playtests; Claude **records them here** (need not fix immediately) and
**checks this list when touching related code** — fix opportunistically since the code overlaps.

Status: 🔴 open · 🟡 in progress · ✅ fixed (note the PR)

## PLAYTEST ROADMAP (Maddy, 2026-06-17) — sequenced

The decline spiral "feels fairly accurate" (Detroit) — KEEP it; the game is decline ↔ **revival**.
Revival = make a pocket worth living in (greens + calm → land value → occupancy → spreads). Build order:

1. ✅ **Bigger generated city / fill the map** — (a) PR #52: ~2× the city (alive ~150→335) by scaling
   the GROWTH eras (era1 founding/site left UNCHANGED — its params drive site scoring, moving them
   clips the grid). (b) PR pending: **satellite exurbs/suburbs** — a new `eraSatellites` (between era4
   and era5) founds up to 4 outlying mini-grids (own arterials + houses), each FREEWAY-linked to the
   core by a BFS connector over open-land/road (paved before the exurb's houses so they can't block
   it). Alive ~335→488; the post-stage road network stays ONE connected component (exurbs are
   genuinely reachable). Could push count/size further; deterministic, N=120 gate intact.
   (c) PR pending: FILL the empty blocks — grid fabric budgets raised to pack the whole grid
   (era2Parcels/satelliteParcels), AND the fill order RANDOMIZED (seeded Fisher-Yates) instead of
   row-major, so any vacancy scatters organically rather than leaving a clean empty bottom band
   (Maddy: "the lower half of these 4x4 grids is always empty... row major is not right, needs
   randomization"). Alive ~488→~1054; the city reads as a real filled place. **Item 1 DONE.**
2. ✅ **Legibility quick-wins** — (a) PR #55: SNES-style plot GLYPHS (R1/R2/R3, C, I, civic letters)
   stamped per parcel (pure `glyphContent`, drawn in the cached base). (b) PR #56: inspect NAMES the
   tile + shows real info (kind name / zone / density / condition% + live pop / land value / health /
   traffic / smog) — `builtKindName` (engine) + `liveInspectLine`. (c) TOOLBAR fixed in item ✅-toolbar
   below. **Item 2 DONE.**
3. ✅ **Revival payoff (deterministic-growth seam)** — PR #61: new fail-closed `src/growth/revival.ts`.
   The LIVE occupancy is sampled into the HASHED stock on the slow civic cadence (never in stepAmbient
   / simTick → N=120 gate untouched): a thriving home heals + densifies (R1→R2→R3), a struggling one
   crumbles to a derelict ruin, REVERSIBLY. Live-verified both directions. The #51 occupancy floor was
   left as-is (revival keys on occ-vs-baseline signal, so the floor doesn't block decay-to-ruin). **DONE.**
4. ✅ **Classic construction tools** — PR #57: the original primitives are always buildable regardless
   of tech (Street/Avenue/Highway/Rail + R/C/I/Civic base zones); the tech tree LAYERS its kinds on top.
   R/C/I plop a density-1 base parcel the revival/growth seam (item 3) then grows.
5. ✅ **Power plants + a real power grid** (PRs #63-66) — SC2000 roster minus microwave (Coal/Gas/Hydro/
   Nuclear classic; Wind/Solar/Fusion up Solarpunk) + distributed EnergyNode. SC1989 conduction (any
   built tile conducts), per-component capacity-vs-demand with brownout (`src/growth/power.ts`, live
   derived field). Hard-gate: unpowered → no growth + slow decay, reversible (composes with revival).
   Dirty plants (Coal/Gas) emit smog → land value → occupancy → decay; renewables clean. Always-on red
   "unpowered" pips + inspect power status. OPEN: power overlay; balance tuning. (Legacy power seeding
   so the start isn't 100% dark is DONE by the redlining arc R1 below.) (Also fixed in #64: multi-tile glyph z-order — drawn in a 2nd pass.)

## REDLINING SYSTEM (arc, 2026-06-17) — produced-by-policy inequity

The worldgen damage now reads as PRODUCED BY POLICY, not nature: a hashed `redline`
grade (discrimination-first social geography + terrain as cover) is the single source
every burden keys off. Vocabulary: live result is "decay"; "redlining/urban renewal"
only critically, Moses-scoped; the player repairs/restores, never "redevelops".
Plan: `~/.claude/plans/love-this-so-far-silly-moonbeam.md`.

- ✅ **R1 — grade + all four worldgen burdens (hashed)** (PR pending) — `GameMap.redline`
  (folded into snapshot, N=120-gated) drawn FIRST in mosesCentury (`worldgen/redline.ts`,
  discrimination-first value noise + low-elevation/near-water cover). All four burdens key
  off it: (a) legacy Coal/Gas plants sited on the most redlined SURVIVING frontage in era3
  (after the highway carve, exempt from era5 abandonment via `isPowerPlant`) — seeds the grid
  so the city is no longer 100% dark (live-verified: 4 plants, 136 powered anchors); (b) era2
  industry sorted grade-first; (c) era5 decay scaled by grade (maxDecay·grade/255), not highway
  distance — near-highway gradient re-emerges as a CONSEQUENCE since (d) era3 highways routed
  through redlined corridors (grade-weighted score). Determinism gate green.
  - ✅ **TUNING accepted (Maddy playtest):** grade-driven decay at `maxDecay 340` + near-zero
    industry reads as RIGHT ("real" — whole redlined neighborhoods to parking). Keep the magnitude.
- ✅ **R2 — legibility (the indictment)** (PR #71) — HOLC overlay (`redlineOverlayContent.ts`, R key
  / dock button) + inspect grade line + opening-briefing `RedlineReport`. Plus PR #72: name redlining
  PRECISELY (housing denial + segregation, cause→consequence), not "disinvestment".
- 🔴 **R3 — live service coverage (fire/health):** `growth/services.ts` BFS coverage (mirrors
  power), redlined zones under-served, feeds land value/occupancy; player extends = repair. ONLY UNBUILT ITEM.
- ✅ **R4 — police-oppression civic dynamic** (PR #75) — worldgen `Precinct` concentrated in redlined
  zones (persists through era5); `civicTick` over-policing penalty (voice/trust down, grade-scaled),
  countered by community alternatives. Player defunds (bulldoze → Healing Commons); never builds police.
- ✅ **R5 — infra quality (live):** water (PR #73 — redlined-industry/ground runoff, downstream flow,
  bankside land-value drag, WastewaterWorks heal) + crumbling roads (PR #74 — redlined roads crumble,
  cared-for recover, land-value drag). Both feed the decay loop.
- ✅ **Police live layer** (PR #76) — patrol cruisers from precincts (flashing lights), grade-scaled
  arrests that drain occupancy AND crater household wellbeing, deliberate patrol (hunt citizens / seek
  redlined streets). 🟡 IN PROGRESS (this branch): Police Violence overlay + ghost AI (scatter/chase
  phases, distinct chase personalities, community safe-zones that repel cruisers).

## TOOLBAR + TECH TREE OVERHAUL (overnight 2026-06-17)

- ✅ **Categorized pictorial dock** (PR #58): the flat 20-wide strip → top-level modes (Inspect/
  Bulldoze) + category tiles (Transit/Residential/Commercial/Industrial/Civic/Green/Energy), each a
  pictorial icon, with the picked category's tools in a flyout. Pure `toolMenuContent`; categories
  surface only when they hold a tool, so tech grows the menu.
- ✅ **Relocatable dock** (PR #59): a drag grip moves the dock off the lower map (it blocked the map
  after techs unlocked); clamped to the viewport (`dockLayout`), persisted to localStorage.
- ✅ **Civ-style tech tree** (PR #60): the 7 flat branch columns → a left→right dependency TREE — nodes
  in depth columns (roots left), SVG connector lines per prereq, edges light gold when satisfied.
  Pure `techLayout` (depth + edges); panel is a large 2D-scroll overlay. Click-to-unlock + edge recolor.

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
  weighted, MINUS the worst nearby pollution/traffic/decay). Steers citizen destinations
  (`nearestOfCategory` pulled toward value) and renders as a slate→gold overlay. Live-verified range
  0–96 in the decayed start (slate near arterials/freeway); climbs as the player heals. Non-hashed.
- ✅ **Population is now agent-emergent** (PR #50): a LIVE per-home `state.occupancy`, seeded from the
  census baseline, drifting on a slow cadence toward its building capacity (`capacityOf`) where the
  land is prized/clean/healthy and toward empty where it's decayed/smoggy (`occupancySignal` +
  `occupancyStep`). Total occupancy drives the spawn target (`spawnTargetFor`) and home weighting.
  Live-verified: the decayed car-city net-declines under its own traffic/pollution (465→350 over 25s,
  homes emptying near the worst decay) — metastable, reversible by healing. Non-hashed; the seeded
  building stock is untouched (buildings appearing/disappearing = the deferred deterministic-growth
  seam). **Arc complete: traffic → pollution → land value → population are all agent-emergent.**
  Tuning (OCC_RATE / OCC_LV_NEUTRAL / OCC_OUT_FRACTION) is provisional — dial during playtest.

## Open

- ✅ **Ghost town: population spiralled to empty** (PR pending) — occupancy declined monotonically to
  ~0 (no populated equilibrium). Root cause (diagnosed live): building-HEALTH dominated the occupancy
  signal (≈half the homes negative, ~none positive in the decayed car-city → bad trips → negative
  health → decline → fewer trips that stay bad → spiral), overwhelming the self-correcting land-value
  term. Fix (architectural): land value is the ANCHOR, building-health a minor bounded nudge; add a
  per-home population FLOOR (a city thins but never fully empties); re-anchor OCC_LV_NEUTRAL at the
  live equilibrium so the start is metastable, not free-falling.
- 🟡 **Driving-ped substrate exemption is implicit** — a hidden `'driving'` ped survives the
  substrate-despawn (ambientContent substep step 1) only because boarding leaves a stale `walkTo` set.
  Make it explicit (`p.phase === 'driving'` in the exemption) so it can't break if `walkTo` is cleared.
  Surfaced while testing pollution; low priority, no live symptom.
- 🔴 **Tech tree can't be closed when it covers the menu bar** (Maddy 2026-06-17) — the tech panel
  overlaps the dock (incl. the Tech toggle), so there's no way to dismiss it. Needs a close affordance
  that's always reachable (an X on the panel itself, and/or Esc-to-close, and/or keep the dock above it).
- 🔴 **Overlay maps need legends** (Maddy 2026-06-17) — the **eco** map colors (soil/flora/fauna/
  biodiversity) are "fairly inscrutable"; **civic** maps (belonging/voice/trust) same. They each have a
  one-line legend string (`legendLine`/`civicLegendLine`) but it's not enough — want a visible color
  KEY (the ramp endpoints labeled) on screen while an overlay is up. (Redline already reads via the A–D
  bands; apply the same clarity to eco/civic.)

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
