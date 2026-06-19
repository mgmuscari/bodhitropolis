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
   "unpowered" pips + inspect power status. Power OVERLAY (U) added (PR pending). Balance tuning is a
   PLAYTEST-FEEL knob, not an open bug — verified live the grid is non-pathological (city stays alive,
   cars/peds circulate); dial the magnitudes by playing. (Legacy power seeding
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
- ✅ **R3 — live service coverage (fire/health)** (PR merged) — FireStation kind provided to greenlined
  zones (withheld from redlined); live `computeCoverage` (ambient); under-served plots lose land value;
  player extends coverage to repair. Inspect served/under-served + a Coverage overlay (V).
- ✅ **R4 — police-oppression civic dynamic** (PR #75) — worldgen `Precinct` concentrated in redlined
  zones (persists through era5); `civicTick` over-policing penalty (voice/trust down, grade-scaled),
  countered by community alternatives. Player defunds (bulldoze → Healing Commons); never builds police.
- ✅ **R5 — infra quality (live):** water (PR #73 — redlined-industry/ground runoff, downstream flow,
  bankside land-value drag, WastewaterWorks heal) + crumbling roads (PR #74 — redlined roads crumble,
  cared-for recover, land-value drag). Both feed the decay loop.
- ✅ **Police live layer** (PR #76) — patrol cruisers from precincts (flashing lights), grade-scaled
  arrests that drain occupancy AND crater household wellbeing, deliberate patrol (hunt citizens / seek
  redlined streets).
- ✅ **Police Violence overlay** (PR #77) — the inverse of a crime map: where the STATE does harm.
- ✅ **Ghost AI** (PR merged) — scatter/chase phases, distinct chase personalities (Blinky/Pinky/Clyde),
  and community safe-zones that REPEL cruisers (the player builds refuge by building community power).

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
  Tuning (OCC_RATE / OCC_LV_NEUTRAL / OCC_OUT_FRACTION) is a PLAYTEST-FEEL knob, not an open bug —
  verified live the loop is metastable (a controlled ~19%/25s decline, the intended decline spiral,
  reversible by healing; NOT the old monotonic spiral-to-zero, which is fixed). Dial by playing.

## Open

- ✅ **Ghost town: population spiralled to empty** (PR pending) — occupancy declined monotonically to
  ~0 (no populated equilibrium). Root cause (diagnosed live): building-HEALTH dominated the occupancy
  signal (≈half the homes negative, ~none positive in the decayed car-city → bad trips → negative
  health → decline → fewer trips that stay bad → spiral), overwhelming the self-correcting land-value
  term. Fix (architectural): land value is the ANCHOR, building-health a minor bounded nudge; add a
  per-home population FLOOR (a city thins but never fully empties); re-anchor OCC_LV_NEUTRAL at the
  live equilibrium so the start is metastable, not free-falling.
- ✅ **Driving-ped substrate exemption is implicit** (PR pending) — extracted `pedDespawns(map, p)`,
  which exempts a driving ped EXPLICITLY by `phase === 'driving'` (no longer relying on a stale
  `walkTo`). Unit-tested: driving ped on a freeway survives; idle one despawns.
- ✅ **Tech tree can't be closed when it covers the menu bar** (Maddy 2026-06-17; PR pending) — added an
  always-visible ✕ in the panel header (the panel top never scrolls, so it's reachable even over the
  dock) + Escape-to-close. Live-verified both.
- ✅ **Biodiversity overlay reads inverted** (Maddy 2026-06-17; PR merged) — was Simpson's index over
  habitat CLASSES (rewarded urban/edge heterogeneity). Redesigned `biodiversityField` to ecological
  RICHNESS (flora × fauna, smoothed): high in thriving wilds, low in the sealed city.
- ✅ **Parking display caps at 4** (Maddy 2026-06-17; PR pending) — the cap was the stall count
  (STALLS_PER_AXIS=2 → 4/tile); bumped to 3 (→ a 3×3 = 9-car grid per tile). The renderer already
  draws every parked car, so a single-tile lot now holds + shows up to 9.
- ✅ **Parking lots only ever held ONE car** (Maddy 2026-06-17; PR merged) — owned cars curb-parked and
  never used lot stalls; now they route to the nearest lot and claim a free stall (parkOwnedCarSomewhere
  → findLotStall), filling to capacity. (Display cap is the separate open bug above.)
- ✅ **Overlay maps need legends** (Maddy 2026-06-17; PR pending) — a visible colour KEY now shows while
  any overlay is up: a swatch per ramp endpoint / HOLC band with its label (top-left). Unified across
  eco/civic/redline/police via `OverlayLegend` + per-module `*Legend()`. Live-verified.

### Travelers / trips batch (Maddy 2026-06-19)

- ✅ **Traveler fuel +250% + more people on the street** (PR #114) — `FUEL_TANK` 600→2100 (travelers
  reach farther); citizen spawn target was flat-capped at 120 so a populous city looked empty →
  replaced with a SCALING cap = total occupancy / 3 (Maddy), `PED_CAP` 160→1200 (perf ceiling only),
  `CITIZEN_SPAWN_PER_SUBSTEP` 2→4. Live: ~671 out (occ/3) vs 120, 61 FPS at 643 peds + 431 cars.
- ✅ **Trip generation row-major upper-left bias** (PR pending) — `nearestOfCategory`/`nearestDemandTile`
  scanned row-major with strict `<`, so score TIES (rampant early when uniform LV → score=distance)
  always resolved to the first-scanned (upper-left) tile, clustering trips top-left. Fix: a direction-
  neutral `tieHash` breaks ties (deterministic, no rng). Live: destination centroid now tracks the plot
  centroid (no up-left pull). 
- ✅ **NE region spawns + immediately despawns travelers** (PR pending) — diagnosed live: that cluster
  is an ISOLATED landmass (~30-tile road component, walled by water) whose residents can reach no
  mainland stop, but `nearestOfCategory` picks stops by RADIUS not reachability → citizens committed to
  mainland stops, failed to route, gave up (`respawnAtHome` clears the itinerary → wander → despawn),
  and re-spawned → churn. Fix: `stopReachable` (walkPath OR roadPath-to-parking-near-plot); `advance
  Itinerary` only commits to reachable stops, returns false (→ dropped at spawn, stays home) when none.
  Live: NE→mainland reachable=false (gated), core→shop=true, citizensOut 652≈occ/3, 61 FPS. NOTE:
  isolated-exurb residents now stay home (no trips) — connecting those masses for CARS (ramps on the
  satellite/bridge freeways so `canDrive` lets them on) is a separate worldgen follow-up.
- ✅ **Cars arriving at FULL parking re-route; (57,103) "infinite cars"; curb cars now visible** (PR
  pending) — a full nearest lot made cars curb-DUMP on the spot (often invisibly) and the lot search
  capped at PARK_RADIUS couldn't re-route → unbounded pile at popular lots (near (57,103) grew 32→64).
  Fix = one parking-seek: `nearestParkSpot` (nearby lot stall → visible side-street curb (curbDir set) →
  farther lot); `routeToParking` DRIVES to a far spot and re-checks on arrival, circling up to
  MAX_PARK_SEEKS ("drive to the new spot; if same condition, try again"); `parkOwnedCarSomewhere`/
  `tryPark` claim via it. `findLotStall` gained a radius param. Live: near (57,103) 64→~34 stable (max
  9/tile, no infinite stack); 64/65 curb cars visible at kerbs; 61 FPS.
- ✅ **Power distributes from the source OUTWARD** (PR pending) — `computePowerGrid`'s brownout shed
  consumers in ascending-ANCHOR (tile-index) order, so capacity-short grids powered the top-left plots
  regardless of the plant's location. Fix: a multi-source BFS from every plant's footprint gives each
  consumer its network distance to the nearest source; the brownout now powers NEAREST-first (ties by
  anchor). Pure/deterministic, live-derived. Unit-verified: plant on the right of an industry row →
  the two NEAREST are powered (not the two lowest-index).
- ✅ **Overlay legibility: civic/eco/redline dim-base + higher opacity** (PR pending; "fix overlays") —
  civic/eco/redline tinted at a faint 0.55 with no `dimBase` → washed out (civic, sparse per-
  neighborhood, was nearly invisible). Now use the power/coverage treatment: alpha 0.55→0.92 +
  `dimBase: true` on every direct-tint overlay (redline, civic, all eco views). Live: civic reads as
  dimmed map + glowing neighborhoods; eco soil a vivid brown→green heatmap.
- ✅ **Looping cyclists** (PR pending) — PR #111 gave WALK legs a committed `walkPath` but left
  bike/transit on the greedy `nextStepToward`, so cyclists still dithered/looped in local minima at
  barriers. Fix: `usesCommittedPath(mode)` = Walk||Bike → bike legs now follow committed routes (bike
  rides the same walkable set; pedCost already favors bike paths). Transit/Drive keep their own movement.
- ✅ **Citizens not commuting home; peds roam parks/rewilded, may never go home** (Maddy 2026-06-19;
  PR pending) — ROOT CAUSE (read live + traced): a citizen whose trip FAILS (boxed in / no foot route
  / fuel out heading home / snapped off-substrate) runs `respawnAtHome`, which repositions it beside
  home but **clears its itinerary/phase/walkTo and KEEPS it** (intentionally — the household persists;
  two tests assert length===1 + beside-home). With no phase/walkTo it then fell to the catch-all
  WANDER branch (`nextPedStep`, which favours green/park substrate) → it loitered in the parks/rewilded
  indefinitely instead of going home. Fix: the catch-all now routes an IDLE ped that HAS a home → home
  (phase `to-home`; at the door it goes inside = despawns into the household), while a HOMELESS ped
  (ambient street life, no `homeTile`) still wanders. Surgical — `respawnAtHome` is untouched, so the
  reposition-and-keep tests still hold; the change only redirects the very next step. RED gate: a
  give-up citizen on a park-substrate neighbourhood is gone within a few steps (was a persistent
  loiterer). Live-verify in the morning (don't reload Maddy's Chrome overnight). Owned-car-on-finish is
  already handled (`sendOwnedCarHome`/`retireOwnedCar`).
- ✅ **Satellite/bridged exurbs are car-ISOLATED — residents can't commute** (audit 2026-06-19; PR
  pending) — `eraSatellites` links exurbs to the core by a 1-wide freeway. A 1-wide highway IS freely
  drivable, but where the connector CROSSES (or runs alongside) the core's 3-wide era3 expressways,
  those tiles read as one-way `outer`/`through` lanes and `canDrive` forbids the perpendicular crossing
  BOTH ways → the exurb is 4-connected (the old `roadNetwork` one-component test passes) yet NOT
  car-reachable. **Root cause was sharper than "no ramps on the connector": the barriers are the wide
  EXPRESSWAY tiles the connector traverses, not the connector itself.** Fix: `rampConnectorCrossings`
  (the path-aware generalization of `placeCorridorRamps`) walks each connector's full corridor and
  converts to `RoadRamp` any tile inside a multi-lane band — detected geometrically as a RoadHighway
  with highway neighbours on BOTH axes (a crossing or parallel-adjacency); pure 1-wide straight tiles
  stay highway. **Ramping is DEFERRED to the end of `eraSatellites`** so it doesn't perturb `isRoadKind`
  mid-founding (which would change later masses' siting / the bridge distance field) — founding stays
  byte-identical, ramps are a pure overlay. New RED gate: a `canDrive`-respecting reachability BFS
  (`carReachFrom`) — every satellite drivable from the core across 3 seeds (was 6/12 isolated → 12/12).
  Worldgen (hashed), deterministic. Unblocks #116's exurb residents (they can now commute by car).
- ✅ **Restoration-progress / city-health readout** (audit 2026-06-19; from "is my renewal helping?";
  PR pending) — a togglable HUD panel (**G** key) surveying the live metrics with IMPROVEMENT-oriented
  trend arrows: mean land value, total population, mean building health, ecology richness (flora×fauna
  via `richnessOf`), and total air/ground/water pollution. The arrow flips for pollution (less = better)
  so **every ↗ means "your renewal is helping"** regardless of whether the raw number rose or fell. Pure
  `restorationContent.ts` (`sampleRestoration` aggregates the AmbientState maps + map ecology;
  `restorationReadout`/`restorationLines` format the trend vs the previous sample) — fully unit-tested,
  on the pure-ui allowlist. Thin `restorationPanel.ts` DOM shell (mirrors `pulseDock`); main.ts samples
  on the civic cadence only while shown, flat on open. No sim change. Live-verify the panel/key in the
  morning.

### Pedestrian / vehicle agents (Maddy 2026-06-19)

- 🔵 **DEFERRED feature: unhoused residents** (Maddy 2026-06-19) — model residents without housing: a
  population that has no home plot (or has been displaced — abandonment/demolition/arrest-drain/eviction
  by decay), living in the live agent layer outside the household census. Surface them as agents +
  presumably a count/indicator, and tie into the existing systems (occupancy, wellbeing, civic voice,
  redline/police harm, the revival↔decline loop — housing as the counter-move). Not started; record
  only. Design Qs for when it's picked up: where they shelter (parks/streets/encampments), how
  housing/displacement moves people in/out of the unhoused state, and the player's restorative levers
  (build housing / commons / defund). Live layer (composes with [[live-layer-architecture]]).
- ✅ **Owned car despawns when its citizen disappears** (PR pending) — a car is the citizen's
  possession; it should stay parked while the ped is active and FOLLOW it home when sent home, not
  vanish on the spot. While active it already persisted (the car filter never despawns an owned car);
  the gap was the departure paths — `respawnAtHome` retired it to a short linger that vanished, and an
  ARREST orphaned it. Fix: `sendOwnedCarHome` warps a SENT-HOME citizen's owned car to park near its
  home (unowned, clears on its dwell), or removes it only if home has no parking. Wired into
  respawnAtHome. Pure (no rng); determinism untouched. Live-verified: a car 39 tiles from home warped
  to 4 tiles from home instead of despawning where the ped disappeared.
- ✅ **Arrested citizens' cars → abandoned derelicts that rust into ground pollution** (PR pending) —
  an ARRESTED citizen is removed from the game, so (revising the warp-home above for the arrest case —
  no one drives it back) their car is ABANDONED: `abandonOwnedCar` dumps it on the nearest EMPTY tile
  (open land, `isWearable`), marks it a derelict (abandoned/unowned/parked; `carOffNetwork` exempts
  it), and the car filter's `degradeAbandonedCar` leaks ground pollution into its tile each substep
  until it has rusted away (`ABANDONED_DEGRADE_TIME` ~2 min), then despawns — leaving the contaminated
  patch (lingering, reparable). Pure; determinism untouched. Live-verified: a citizen's car was
  abandoned onto an empty tile and its ground pollution rose to 255 (max) before the wreck rusted away.
- ✅ **Traffic pileups (cars sharing a tile slow down)** (Maddy 2026-06-19; PR pending) — congestion
  made PHYSICAL: a per-substep snapshot counts MOVING cars per tile (`carDensity`; free + owned-being-
  driven, parked/abandoned excluded), and `congestionSpeedMult(count)` scales every car's speed on that
  tile — `1/(1 + PILEUP_K·(count−1))`, floored at `PILEUP_MIN`. Applied at BOTH car movers (the free/
  trip-car filter and the citizen-driven `driving` branch) via a shared `speedAt(base,x,y)`. Cars bunch
  and crawl through bottlenecks; the existing live `traffic` field + A\* congestion routing already make
  the rest of the loop respond. **Tuning is deliberately GENTLE** (`K=0.3`, floor `0.5` = worst jam at
  half speed) so it never deadlocks or starves the flow that must keep cars reaching lots/homes — a
  playtest-feel knob (like OCC_RATE), dial up by playing. Pure `congestionSpeedMult` unit-tested +
  a behavioral test (a lone car outruns a 6-car pack). Live layer, non-hashed.

### Pedestrian pathing (Maddy 2026-06-19)

- ✅ **Peds parking + heading north to nowhere from (52,101)** (PR pending) — diagnosed live: the
  greedy `nextStepToward` last-mile router stalls in a LOCAL MINIMUM at a wall — a destination behind
  buildings/a freeway leaves every non-recent neighbour tied on Manhattan distance, so peds dither in
  place (full fuel, not moving) until they burn out and drift home north. Cars already follow a
  committed A\* route (`roadPath`); peds didn't. Fix (one abstraction, mirroring cars): `walkPath` —
  A\* over the WALKABLE set with `pedCost`, ending at the door (≤1 from target); Walk-mode legs follow
  the COMMITTED route via `pathStep` (recompute on destination change via `Mover.pathGoal`, clear at
  leg end / respawn), routing AROUND barriers or giving up cleanly if there's no foot route. Bike/
  transit legs keep the mode-cost step (pedCost doesn't know a tram line). Pure (no rng) — ambient
  determinism + N=120 untouched. Live-verified at (52,101): peds stuck at the freeway wall 21→0; peds
  reaching buildings EAST of the freeway ~0→12; pile-up + northward give-up stream gone.

### Overlay / eco-layer batch (Maddy 2026-06-18)

- ✅ **Power (U) + Coverage (V) overlays wash out** (PR pending) — they tint only sparse BUILDING
  tiles, so translucent green/red vanished against the green terrain (legend/dock toggled, the map
  didn't). Fix = ONE abstraction: `OverlaySource.dimBase` — the renderer scrims (OVERLAY_DIM, near-
  black 0.66) every un-highlighted tile, and the highlights paint at a strong 0.92 alpha, so the
  powered/dark + served/under-served plots GLOW against a darkened city. Live-verified: pressing U/V
  now dims the map and the buildings pop green/red. (Redline/eco/civic fill the map already → no dim.)
- ✅ **Eco overlay should include water + ground + air pollution** (Maddy 2026-06-18) — the E cycle
  is now soil→flora→fauna→biodiversity→air→ground→water.
  - ✅ **Air + water** (PR #92) — `airPollution` (live `ambient.pollution`, traffic smog, over land)
    + `waterPollution` (live `ambient.waterPollution`, runoff, over water — the dingy creeks). Also
    fixed the stale "Simpson index" biodiversity legend copy → "richness".
  - ✅ **Ground pollution = a NEW live land-contamination field** (PR pending) — `accumulateGround
    Pollution`: industry + dirty power + demand-path litter/wear poison the ground they sit on and
    the land around them (grade-scaled, seeps a tile), lingering (GROUND_DECAY 0.8) but reparable —
    it clears once the source is gone. The land analogue of water runoff (the source the creeks run
    off from). Live-verified: 1214 contaminated tiles, max 254, litter feeding in from 1271 worn
    tiles; the `groundPollution` eco view (clean land → toxic ground). Non-hashed; N=120 gate intact.

### Agent-movement substrate cluster (Maddy 2026-06-18) — likely ONE missing abstraction

The live agents are violating substrate constraints. Probable single fix: an authoritative
"valid surface per agent" predicate (peds: walkable land/roads, NEVER water or freeway; cars: park
only on non-freeway surfaces).

- ✅ **Pedestrians cross water** (PR pending) — peds were being PLACED on water (degenerate spawn/
  retire), not stepping there (nextStepToward already rejects water). Fix: a self-heal guard in the
  ped loop snaps any walker off a non-walkable tile via `nearestWalkable`, or respawns it home.
- ✅ **Pedestrians cross freeways** (PR pending) — same root: peds inheriting a freeway-parked car's
  tile. Cleared by the parking fix below + the self-heal snap. Live-verified 0.
- ✅ **Cars park on freeways** (PR pending) — THREE sources, all now funnel through one predicate
  `isParkable` (carTraversable && not freeway && not over-water): (a) `parkOwnedCarSomewhere`
  fallback dumped the car on its current (freeway) tile when no kerb was free → now it leaves;
  (b) `retireOwnedCar` left a lost owner's car lingering mid-freeway → now it drives off;
  (c) `nearestDriveStart` spawned an owned car parked on a freeway beside its home → now non-freeway
  only. Live-verified: 19 → 0, holds at steady state (~90s, 82 cars parking normally).
- ✅ **Big parking-lot blocks hold one car per lot** (PR pending) — lot selection keyed off the lot
  CENTRE within PARK_RADIUS, so a big lot (centre far from its edges) was never picked from where
  cars arrive, and stalls filled row-major from a far corner. Fix: select by clamped-BBOX distance
  and take the free stall NEAREST the arrival, so blocks fill tile-by-tile from the destination side.
  Live-verified: curb-parks 29->3, a 234-stall lot 0->15 cars, lots now hold up to 31 (was ~1).
### Divided-road / lane redesign (Maddy 2026-06-18, spec'd) — needs edge-aware passability

Both are in `freewayLane` / `carPassable` / `nextRoadStep` (oscillation-prone — TDD carefully). The two
road types want OPPOSITE crossing rules, which is the missing abstraction: limited-access freeways vs
at-grade avenues. Diagnosed but DEFERRED — a focused redesign, not a patch.

- ✅ **Freeway lanes + limited access + ramps** (PR pending) — DONE (Maddy's spec): a 3-wide freeway
  is south→east, north→west, **middle a two-way `through` lane** (the dead `median` role reserved for
  the future road-diet planted median); freeways are **LIMITED-ACCESS** via an edge-aware
  `canDrive(from→to)` (enter/move only along the freeway; cross/turn only at ramps/interchanges/ends),
  rewired into `roadPath` + `nextRoadStep`. Connectivity is kept by **worldgen ramps**: a `RoadRamp`
  kind (a drivable freeway-AND-street tile) dropped as cross-sections through each corridor every
  `era3RampSpacing` (8) tiles where the grid flanks it — an on/off + at-grade crossing (Maddy: ramps =
  a street overlaid on a freeway). Live A/B (default seed, 150s): without ramps it doubled the decline
  (−48% vs main −26%); **with ramps it's −22% — connectivity fully restored**. 1226 tests green.
  - ✅ **Planted no-traffic median** (PR pending) — `BuiltKind.PlantedMedian` (11): a road-DIET
    upgrade (gated by the `road-diets` capability) converting a 3-wide highway's interior `through`
    lane into a planted, no-traffic green median. Removes a traffic lane (calmer corridor) + a green
    amenity (lifts land value); cars never drive on/across it (green barrier). `freewayLane` counts the
    median in the road's width band so the flanking carriageways stay one-way; engine-pure
    `isInteriorRoadLane` gates `convert-11` to interior lanes only; reversible. Live-verified: medians
    inert (0 traffic), carriageways still flow (92 cars), renders as a green center strip.
  (Ramps generalize to overpasses — ✅ DONE via the `map.deck` elevation layer; see the overpass entry
  under the freeway-bridge item below.)
- ✅ **Avenues block cross traffic at intersections (the "streetcar" bug)** (PR pending) — the blocker
  was the tram tile: a `Streetcar` (transit) tile isn't `carTraversable`, so the A* router couldn't
  take a cross street through it. Fix: a LEVEL-CROSSING rule in `canDrive` — a car may CROSS an
  at-grade tram/rail line (`isLevelCrossable`: Streetcar/Rail) straight through to the drivable tile
  beyond, but never drive ALONG it; `carOffNetwork` no longer despawns a car mid-crossing. Unit-tested
  (cross a tram, can't drive along it, the avenue/streetcar/avenue median crosses). At-grade avenues
  themselves already allow committed cross-routes (canDrive returns true for non-freeway tiles).

### Freeway/build follow-ups (Maddy 2026-06-18)

- ✅ **Avenues had the same lane-math problem as freeways** (PR pending) — committed routes (A*/
  `roadPath`) used `canDrive`, which returned true for at-grade avenues regardless of direction, so
  cars drove the WRONG WAY on the one-way avenue lanes (free-driving already respected one-way via
  freewayStep; committed routes didn't). Fix: `canDrive` enforces a divided avenue's outer-lane
  one-way (can't enter against `dir`), but UNLIKE a freeway keeps it crossable (a cross street may
  cross perpendicular to a road beyond). Unit-tested + live-verified: 0 wrong-way avenue cars,
  occupancy decline normal (−24%/120s, no stranding).
- ✅ **Ramp in the middle of the freeway cross** (PR pending) — `placeCorridorRamps`' `sideRoad` check
  accepted ANY `isRoadKind` (incl. the perpendicular freeway) as a "flanking road," so a ramp landed
  at the freeway×freeway interchange. Fix: a ramp must connect to a SURFACE road (street/avenue) —
  `surfaceRoad` excludes highway/ramp — so no ramp drops at the interchange (already a free crossing).
  Unit-tested (ramp at a grid-flanked column; interchange stays highway) + live-verified.
- ✅ **Cannot build a nuclear plant anywhere** (PR pending) — `canPlaceParcel` clamped footprints to
  `MAX_FOOTPRINT = 3`, but Nuclear (and Fusion) plants are 4×4, so every placement was rejected.
  Bumped MAX_FOOTPRINT to 4 (the largest plant). Unit-tested: a 4×4 footprint places on clear land.
- ✅ **More early-game civic services concentrated in greenlined areas** (PR pending; Maddy feat) —
  added Clinic/Library/School BuiltKinds (33/34/35) — civic SERVICE stations like the fire station.
  era3 concentrates them on greenlined frontage (withheld from redlined; `era3CivicServices`=3 each),
  they extend the live service-coverage field (coverage overlay retitled "Civic services"), render
  (CL/LB/SK glyphs + distinct styles), and are player-buildable (repair the redlined zones). Live-
  verified: 3 of each placed at mean grade 66 (greenlined); unit-tested (greener than precincts).
- ✅ **Prevailing wind carries smog** (PR pending) — air pollution now DRIFTS one tile downwind along
  a seeded per-world prevailing wind (`prevailingWind`: 8-dir integer unit vector from the ambient
  rng, never the sim streams) each WIND_CADENCE pass via `driftPollution` (conservative transfer;
  off-map smog leaves the system), so plumes streak from their sources instead of diffusing in place.
  Live layer, non-hashed; no transcendental Math (stays on the pure-ui allowlist). Live-verified: a
  steady source yields a clean downwind plume (250→189 over 6 tiles), zero upwind leakage; wind
  varies by seed.
- ✅ **Block-by-block organic growth** (PR pending) — new `eraOrganicGrowth` (the newest layer, after
  era5): settlement ACCRETES outward from the ENDS of transport lines (freeway ends, bridge landings,
  arterial tips) into the open land beyond — `terminusOutward` finds termini facing open land + pointing
  away from the core, each seeds a small organic cluster (stub + rungs + houses via fillFrontage),
  spaced + capped. Composes with the satellite/bridge masses; stays one connected network; deterministic,
  N=120-gated. The BlightReport tracks it as its own term (`organicAdded`) and excludes it from the
  historical core/periphery disinvestment gradient (the report measures the inherited wound, not new
  growth). Live-verified: 8 clusters / +305 parcels on the default seed. NOTE: this is the accretion-
  from-termini half; "central districts densify/expand outward" is already served by the live
  occupancy/revival densification loop. Tunables: organicSeeds/organicReach/organicBlocks/organicParcels.
- ✅ **Freeway skipped a tile for water (gap at 85,86)** (PR pending) — the era3 highway carve called
  `placeTransport`, which refuses water, so a corridor crossing an inlet left a gap in the deck. Added
  a `placeBridge` engine primitive (decks transport OVER water, keeping the water layer underneath — a
  bridge, not a causeway; never decks a building); `carveCorridor` uses it. Live-verified: (85,86)/
  (86,86) now RoadHighway-over-water, the freeway continuous. Non-golden N=120 gate intact (bridging
  only adds highway tiles).
  - ✅ **Overpasses (the per-tile elevation model)** (PR pending) — a second HASHED `map.deck` layer
    holds ELEVATED transit (ElevatedRail/Promenade) over the road below — the generalization of
    `placeBridge` (a transport deck over another). Cars/peds pass UNDER unaffected (grade-separated).
    `canPlaceOverpass`/`placeOverpass`/`removeOverpassAt`/`overpassAt`/`deckMask`; building an elevated
    kind OVER a road decks an overpass (over land it's at-grade); bulldoze removes the deck first.
    An elevated promenade deck is ped substrate — a promenade overpass carries peds ACROSS a freeway
    they can't cross at grade (live-verified: contiguous substrate across, bare freeway not walkable;
    renders lifted w/ a drop shadow). Worldgen leaves the deck 0, so N=120 stays byte-identical.
    🔮 FOLLOW-ONS (need playtest judgment): elevated-rail train sim on the deck; car-under-deck z-order;
    worldgen-placed overpasses; an explicit ramp/incline model.
- ✅ **Worldgen bridges expand the city to other land masses** (PR pending; Maddy feat) — eraSatellites
  now, after the land exurbs, detects the biggest OTHER land masses (`otherMassEntries`) and, for each
  within reach (`satelliteMaxBridge`=30, `satelliteBridgeCount`=2, `satelliteMinMassSize`=250), decks
  a freeway BRIDGE to its nearest-road bridgehead (`layBridgeToRoad`: gradient descent on the
  distance-to-road field, `placeBridge` per step) and founds an exurb there. Live-verified on the
  default seed: 1 bridged exurb across open water on a 743-tile mass; road network stays one connected
  component; N=120 gate intact.

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
