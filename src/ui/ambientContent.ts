// Pure ambient-life model: the deterministic stepper behind the cars, pedestrians,
// and bird flocks that animate over a built city. It READS the world (road class,
// pedestrian substrate, fauna presence) and writes ONLY its own AmbientState — no
// map writes, no parcel writes, no engine/sim rng. The renderer culls the resulting
// sprites to the viewport at draw time.
//
// This module is in the architecture guard's PURE_UI_ALLOWLIST, so it is DOM-free
// and transcendental-free: only Math.min/max/abs/floor/sqrt (exactly-rounded /
// integer) appear — never sin/cos/exp/pow/log/random. Determinism is load-bearing:
// every random choice draws from the caller's `fork('ambient')` Rng, so a worldgen
// or sim run is byte-identical whether or not the stepper is interleaved.
//
// Motion model (CRITIC-YP6): a car/ped carries a heading (`dir`) and a committed
// target tile (`tx`,`ty`); each substep it advances toward the target, and on
// arrival it recommits to a connected traversable neighbour EXCLUDING the immediate
// U-turn (unless a dead-end forces it). So traffic flows along a road and turns at
// junctions instead of vibrating A→B→A. Cars traverse `isRoadKind` (1..3) only — so
// they neither spawn on NOR move onto quiet streets (QuietStreet reads as a road to
// `transportCategory`, which is therefore deliberately unused here, YP4).

import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind, isServiceStation } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { visitValue } from '../citizens/plots';
import { stopCategoryOf, DAILY_ITINERARY, type StopCategory } from '../citizens/itinerary';
import { TravelMode, modeSpec, modeRidesNetwork, modeSpeedMult, MODE_CHOICE_ORDER } from '../citizens/modes';
import type { Household } from '../citizens/census';
import { layField, decayField, sampleField } from '../citizens/field';
import type { Rng } from '../engine/rng';

/** Maximum elapsed time honoured in a single stepAmbient call, mirroring
 *  FixedTickLoop.maxFrameMs (loop.ts): a GC pause / debugger break / OS sleep /
 *  missed visibility reset can never spiral into a synchronous hang. */
export const AMBIENT_MAX_FRAME_MS = 1000;

/** Fixed substep size — the simulation cadence for ambient motion. */
const SUBSTEP_MS = 50;

// Global per-kind caps (bounded total ~hundreds). Placeholder magnitudes —
// live-pass tuned; the contract is "cap-bounded step + viewport cull at draw".
const CAR_CAP = 200;
const PED_CAP = 1200; // hard perf ceiling only; the citizen target (occ/3) is the operative cap below it
const FLOCK_CAP = 32;
// Police cruisers patrol the redlined districts from their precincts (the visible
// face of the over-policing the civic layer models). One per precinct, capped.
const CRUISER_CAP = 8;
const CRUISER_LIFE = 400; // substeps a patrol runs before recycling back to its precinct (~20s)
const HUNT_RADIUS = 8; // a cruiser homes in on an on-foot citizen within this Manhattan distance
const AMBUSH_LEAD = 4; // tiles AHEAD of a citizen's heading an ambush (Pinky) cruiser aims for
const SHY_RADIUS = 4; // a shy (Clyde) cruiser only pounces when the citizen is this close, else patrols
// Community safe-zones (the abolitionist "power pellet"): cruisers will not enter — and make no
// arrests in — the bubble around community power, so the player carves out refuge by BUILDING it.
const SAFE_RADIUS = 3;
const REFUGE_KINDS = new Set<number>([
  BuiltKind.HealingCommons,
  BuiltKind.CommunityGarden,
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.Civic,
  BuiltKind.Park,
]);

/**
 * The set of tiles within COVERAGE_RADIUS of a fire station / healing commons — the live fire/health
 * SERVICE COVERAGE. Worldgen provides stations to the greenlined districts and withholds them from
 * the redlined, so the redlined zones start UNDER-served (uncovered → a land-value drag); the player
 * extends coverage by building stations, which repairs it. Built fresh from the map (sparse stations).
 */
export function computeCoverage(map: GameMap): Set<number> {
  const covered = new Set<number>();
  for (let i = 0; i < map.built.length; i++) {
    if (!isServiceStation(map.built[i]!)) continue;
    const cx = i % map.width;
    const cy = (i - cx) / map.width;
    for (let dy = -COVERAGE_RADIUS; dy <= COVERAGE_RADIUS; dy++) {
      for (let dx = -COVERAGE_RADIUS; dx <= COVERAGE_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > COVERAGE_RADIUS) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (map.inBounds(nx, ny)) covered.add(map.idx(nx, ny));
      }
    }
  }
  return covered;
}

/** The set of tiles within SAFE_RADIUS of any community-power building — refuge the cruisers avoid
 *  and never sweep. Built fresh from the map (sparse refuges); the player grows it by building. */
export function buildSafeZones(map: GameMap): Set<number> {
  const safe = new Set<number>();
  for (let i = 0; i < map.built.length; i++) {
    if (!REFUGE_KINDS.has(map.built[i]!)) continue;
    const cx = i % map.width;
    const cy = (i - cx) / map.width;
    for (let dy = -SAFE_RADIUS; dy <= SAFE_RADIUS; dy++) {
      for (let dx = -SAFE_RADIUS; dx <= SAFE_RADIUS; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (map.inBounds(nx, ny)) safe.add(map.idx(nx, ny));
      }
    }
  }
  return safe;
}
// Scatter/chase cadence (the Pac-Man ghost rhythm): the fleet alternates between SCATTER (patrol the
// redlined streets, ignore people) and CHASE (hunt pedestrians + sweep arrests). Mostly chase, with
// a periodic scatter lull — so the redlined streets pulse between tense calm and active sweeps.
const SCATTER_LEN = 140; // substeps of scatter (~7s)
const CHASE_LEN = 400; // substeps of chase (~20s)

/** The fleet-wide police phase for a substep counter: 'scatter' (patrol, no hunting/arrests) or
 *  'chase' (hunt + arrest). Deterministic; the ghost cadence. */
export function policePhase(tick: number): 'scatter' | 'chase' {
  return tick % (SCATTER_LEN + CHASE_LEN) < SCATTER_LEN ? 'scatter' : 'chase';
}
// Arrests: a cruiser in a redlined zone takes a nearby citizen off the street FOR NOTHING and
// drains a person from their household — the violence of over-policing, made tangible. Only in
// redlined zones (the disparity); the player ends it by defunding (no precinct → no cruisers).
const ARREST_CADENCE = 40; // substeps between arrest sweeps (~2s)
const ARREST_CHANCE_MAX = 0.5; // per cruiser per sweep on FULLY redlined ground (grade 255)
const ARREST_RADIUS = 4; // a cruiser seizes an on-foot citizen within this Manhattan distance
const ARREST_DRAIN = 1; // people removed from the household per arrest
const ARREST_TRAUMA = 60; // wellbeing (buildingHealth) ripped from the household per arrest (heavy:
//                           half the ±HEALTH_MAX range — an arrest devastates a home, it doesn't nudge it)
// Police-violence record: each arrest stains its tile; it lingers and decays slowly (the memory of
// the harm). This is the data behind the Police Violence overlay — the inverse of a crime map.
const POLICE_VIOLENCE_MAX = 255;
const POLICE_VIOLENCE_LAY = 50; // stain laid at an arrest
const POLICE_VIOLENCE_DECAY = 0.05; // per substep (~1/s) — fades slowly, so a hot zone accumulates

/**
 * The per-sweep arrest probability for a cruiser standing on ground of this redline grade:
 * scales LINEARLY with the grade (0 at greenlined, ARREST_CHANCE_MAX at fully redlined), so the
 * over-policing pressure tracks the discrimination rather than switching on at a threshold.
 */
export function arrestChance(grade: number): number {
  const g = grade < 0 ? 0 : grade > 255 ? 255 : grade;
  return (g / 255) * ARREST_CHANCE_MAX;
}

// Rejection-sampling budget per substep per kind: sample K random tiles and test
// the spawn predicate, never an O(mapArea) full-map scan (CRITIC-YP1).
const SAMPLES_PER_SUBSTEP = 8;

// Float tiles travelled per 50ms substep. Cars are quicker than pedestrians.
const CAR_SPEED = 0.12;
const PED_SPEED = 0.05;

/** Chebyshev radius searched around a parked car for the building its pedestrian walks
 *  to/from. Lots/curbs sit next to the demand they serve, so this stays small. */
const LASTMILE_RADIUS = 4;

/** How close (tile radius) a parking lot's centre must be to a trip-car's destination for
 *  the car to pull in and park. Lots sit by the zones they serve, so this stays modest. */
const PARK_RADIUS = 6;

/** When no lot is free, a car parks at the nearest free curb (drivable tile) within this
 *  Chebyshev radius of its destination. Crowding (near curbs taken) pushes it farther out —
 *  a longer walk for its pedestrian. */
const CURB_RADIUS = 10;

/** Safety cap (substeps) on how long a parked car waits for its pedestrian before leaving
 *  anyway — normally the returning ped releases it sooner. ~30s at 50ms/substep. */
const PARK_MAX_WAIT = 600;

/** Bounds + decay for the live per-building HEALTH signal: each completed citizen visit
 *  deposits the destination plot's visitValue at the citizen's home, and health eases back
 *  toward neutral (0) so it reflects RECENT trips, not all-time. Live, not hashed. */
const HEALTH_MAX = 120;
// Slow decay so health ACCUMULATES across a home's repeated trips into a persistent,
// readable signal (a fast decay left most homes flickering back to neutral between visits).
const HEALTH_DECAY = 0.02;

/** Transport-MODE threshold: a citizen trip whose committed path is at most this many tiles
 *  is walked (a pedestrian routes the whole way); longer trips drive. So as destinations come
 *  closer / streets calm, citizens shift out of cars — the heart of the congestion→bloom loop. */
const WALK_RANGE = 10;

/** How far a citizen on a daily round will look for the next stop's plot (a workplace, shop, or
 *  third place). A citizen ranges across the city for a far stop (a commute) — wider than BIKE_RANGE
 *  so the longest legs genuinely warrant driving/transit, exercising the full mode spectrum. The
 *  FUEL economy still bounds reach: a stop too far to reach burns the citizen out. */
const CITIZEN_TRIP_RADIUS = 40;

/** Mode choice: a leg up to BIKE_RANGE tiles can be cycled (bikes need no special infra — bike
 *  paths just speed them); a transit/road mode is "available" only when its network is within
 *  MODE_INFRA_RADIUS of BOTH ends of the leg. So building a tram/rail line lets the citizens whose
 *  trips it serves ride it instead of driving — the road-diet → mode-shift → bloom loop. */
const BIKE_RANGE = 18;
const MODE_INFRA_RADIUS = 6;

/** How long a citizen's car lingers "parked at home" after the owner's round ends, before it clears
 *  — a brief visible beat, short enough that retired cars don't pile up into a backlog. */
const RETIRED_CAR_LINGER = 90;

/** Live, AGENT-DRIVEN traffic density (0..TRAFFIC_MAX), keyed by road tile: laid by cars as they
 *  actually drive, decayed when they don't. It IS the traffic — the macro pattern emerges from the
 *  agents, not from an aggregate field the sim paints. Cars route AROUND it (CONGESTION_WEIGHT in
 *  the pathfinder) and peds shun it; so building a bypass or calming a street shifts where cars go. */
const TRAFFIC_MAX = 255;
const TRAFFIC_LAY = 10; // a car adds this to its tile's live traffic per substep it drives there
const TRAFFIC_DECAY = 1; // live traffic eases back this much per substep when no car is passing
const CONGESTION_WEIGHT = 3; // how strongly the pathfinder/peds avoid a fully-congested tile
/** A* search bound — a car-agent's route is the committed least-cost path; abandon past this. */
const ROAD_PATH_MAX_ITERS = 4000;

/** Live, AGENT-DRIVEN air pollution (0..POLL_MAX), keyed by tile: cars EMIT it on the tiles they
 *  drive (heavier on freeways and where they idle in congestion), and it lingers as smog, decaying
 *  slower than traffic clears. Peds shun it (a term in pedCost); its human cost reaches the city
 *  through land value (it drags a tile down). Live layer, never hashed — the smog is emergent from
 *  the actual vehicles, not an aggregate field. */
const POLL_MAX = 255;
const POLL_LAY_BASE = 6; // a car emits this on a surface road per substep it drives there
const POLL_FREEWAY_MULT = 2; // a freeway carries faster, heavier traffic → twice the emission
const POLL_CONGEST = 8; // up to this much MORE on a fully-jammed tile (idling smog)
const POLL_DECAY = 0.4; // smog lingers — eases back slower than traffic (TRAFFIC_DECAY = 1) clears
const PED_POLL_WEIGHT = 2.5; // a fully-smoggy tile costs about as much as a stroad to walk

// Prevailing wind: the city has one dominant wind, so smog DRIFTS downwind into plumes instead of
// only diffusing/lingering in place — the haze streaks away from its source (the freeway, the coal
// plant) across the neighbourhoods downwind. The eight compass directions as integer (dx,dy) unit
// vectors (no transcendental Math — the field is on the pure-ui allowlist).
const WIND_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];
const WIND_CADENCE = 8; // substeps between drift passes (~0.4s) — the plume streaks, never teleports
const WIND_FRACTION = 0.34; // share of a tile's smog carried one tile downwind each drift pass

/** The world's prevailing wind as an integer unit vector, drawn from the (seeded) ambient rng so it
 *  is consistent per world seed and NEVER touches the sim/worldgen streams. Defaults to a westerly
 *  (blowing due east) when no rng is supplied, so the no-arg `createAmbientState()` stays usable. */
export function prevailingWind(rng?: Rng): { dx: number; dy: number } {
  const [dx, dy] = rng ? WIND_DIRS[rng.nextInt(WIND_DIRS.length)]! : WIND_DIRS[2]!;
  return { dx, dy };
}

/** Live DERIVED land value (0..LV_MAX), keyed by inhabited PLOT tile (zoneTypeOf !== None): a tile's
 *  desirability, recomputed on a slow cadence from the healed land + amenity neighbours MINUS the
 *  live nuisances (pollution, traffic, decay). Unlike traffic/pollution it isn't laid by agents —
 *  it's a readout over the other layers, so it follows the water-runoff cadence pattern, not layField.
 *  Steers where citizens go and (next) how households grow. Live layer, never hashed. */
const LV_MAX = 255;
const LV_BASE = 90; // a bare inhabited tile, before greenery / amenities / nuisances
const LV_FLORA = 50; // + full flora vitality on the tile (the healed land lifts value)
const LV_FAUNA = 35; // + full fauna presence on the tile
const LV_AMENITY = 25; // + per nearby amenity, weighted by a linear falloff over LV_RADIUS
const LV_RADIUS = 4; // how far amenities lift / nuisances drag a plot (Manhattan)
const LV_POLL_PEN = 70; // − the worst nearby smog (distance-weighted), the dominant nuisance
const LV_TRAFFIC_PEN = 50; // − the worst nearby congestion (noise / danger of a jammed road)
const LV_WEAR_PEN = 30; // − the worst nearby trampled, littered ground (decay)
const LV_WATER_PEN = 60; // − the worst nearby contaminated water (the poisoned creek on the banks)
const LV_ROAD_PEN = 25; // − the worst nearby crumbling road (disinvested infrastructure); bounded so
//                          the LV↔road feedback settles rather than death-spiralling
const LV_COVERAGE_PEN = 30; // − an inhabited plot with NO fire/health station in reach (under-served)
const COVERAGE_RADIUS = 6; // a fire station / healing commons covers tiles within this Manhattan radius
const LV_CADENCE = 20; // recompute every N substeps (~1s) — a slow, whole-map readout
const LV_PULL = 10; // tiles of extra distance a max-value destination can justify over a drab one

/** The green / healing / civic-green kinds that lift a neighbour's land value (the goods the player
 *  builds while healing the city). Amenity GREENS (park, garden, rewilded, parklet, promenade) are
 *  zoneTypeOf None so they don't get their own value — they raise the plots around them. */
const AMENITY_KINDS: ReadonlySet<number> = new Set([
  BuiltKind.Park,
  BuiltKind.CommunityGarden,
  BuiltKind.RewildedLand,
  BuiltKind.Parklet,
  BuiltKind.Promenade,
  BuiltKind.PlantedMedian, // the road-diet green strip lifts the corridor it calms
  BuiltKind.HealingCommons,
  BuiltKind.VerticalFarm,
  BuiltKind.Civic,
  BuiltKind.CompostHub,
]);

/** Hard CAP on itinerary citizens out at once (perf): the live spawn target tracks total occupancy
 *  but never exceeds this. Below the ped cap, so there's still room for ambient wanderers, last-mile
 *  walkers, and respawned citizens. CITIZEN_SPAWN_PER_SUBSTEP tops up gently rather than all at once. */
// The citizen target SCALES with the city: a THIRD of the live residents are out on a round at once
// (Maddy: "cap should be sum(citizens) / 3"). No flat ceiling — busier cities put proportionally more
// people on the street; a declining one empties. PED_CAP is the only hard ceiling (perf safety).
const CITIZEN_OUT_DIVISOR = 3;
const CITIZEN_SPAWN_PER_SUBSTEP = 4; // top up a bit faster too, so the streets refill promptly

/** AGENT-EMERGENT POPULATION (live, never hashed). Each residential home carries a live OCCUPANCY —
 *  how many people actually live there now — seeded from the deterministic census baseline, then
 *  drifting on a slow cadence: toward its building's capacity where the land is prized/clean/healthy,
 *  toward empty where it's decayed/smoggy. The seeded worldgen fixes the building STOCK (hashed);
 *  only how many inhabit it is live. Total occupancy drives the spawn target + home weighting, closing
 *  the loop: more people → more trips → more traffic/pollution → lower land value → decline; healing
 *  reverses it. (Buildings actually appearing/disappearing is the deferred deterministic-growth seam.) */
const OCC_CADENCE = 20; // re-evaluate occupancy every ~1s (a slow demographic drift)
const OCC_RATE = 0.25; // people/cadence occupancy moves toward the ceiling / floor at a full signal (gentle)
// LAND VALUE is the ANCHOR of occupancy (it self-corrects: fewer people → less traffic → higher value).
// Neutral sits at the decayed car-city's live equilibrium so the start is metastable, not free-falling.
const OCC_LV_NEUTRAL = 60;
const OCC_POLL_W = 0.5; // how strongly local smog pushes residents out
// Building health is a MINOR nudge, not the driver: in the decayed start most homes carry negative
// health (unpleasant trips), so an unbounded health term death-spirals the city to empty. Cap it small.
const OCC_HEALTH_SCALE = 120; // building-health magnitude mapped before the cap (HEALTH_MAX)
const OCC_HEALTH_CAP = 0.15; // max ± the health term can contribute to the signal (a nudge, not a collapse)
// A city loses people but never fully empties: occupancy floors at this fraction of its seeded baseline.
const OCC_FLOOR = 0.4;
/** Per-kind growth HEADROOM: how far above its seeded baseline a home's occupancy can climb when it
 *  thrives. A single house barely densifies; apartments / projects / co-ops / communes hold far more. */
const OCC_HEADROOM: ReadonlyMap<number, number> = new Map([
  [BuiltKind.HouseSingle, 1.5],
  [BuiltKind.ADU, 1.3],
  [BuiltKind.Apartments, 3],
  [BuiltKind.Projects, 3],
  [BuiltKind.CoopHousing, 2.5],
  [BuiltKind.Commune, 2.5],
]);

/** Wellbeing a walking citizen loses per substep spent trudging along a road/stroad — a long
 *  road walk brings home less (the unpleasant commute). Promenades/quiet streets/green cost
 *  nothing. Subtracted from the home deposit on arrival. */
const ROAD_WALK_PENALTY = 0.04;

/** Terrain-aware foot routing over WILD ground (empty land): lush growth is hard to push through
 *  (higher cost), a beaten desire path is easy going (lower cost) — so foot traffic self-reinforces
 *  desire paths over time. PED_GROUND_MIN floors the beaten cost just ABOVE a promenade (0.3) and a
 *  quiet street (0.5), so a promenade the player lays still wins the route and lures peds off the
 *  wild. Flora term adds with lushness; wear term subtracts with beaten-ness (both 0..1). */
const PED_GROUND_BASE = 0.9; // a bare empty tile (no flora, no wear)
const PED_LUSH = 0.8; // added to ground cost at full floraVitality
const PED_BEATEN = 0.7; // subtracted from ground cost at full wear
const PED_GROUND_MIN = 0.4; // floor: a fully-beaten path, still dearer than a promenade

/** A worn desire path is convenient underfoot but DEGRADED (brown, littered): a citizen walking it
 *  brings home less wellbeing. A wearable tile counts as wellbeing-degrading once its wear reaches
 *  WORN_DEGRADE_MIN; each such substep taxes the home deposit by WORN_WALK_PENALTY. */
const WORN_DEGRADE_MIN = 128; // half of WEAR_MAX — clearly a beaten path, not incidental trampling
const WORN_WALK_PENALTY = 0.04;

/** Wellbeing a home loses when one of its citizens can't reach its destination on foot — the
 *  pathing dead-ends (e.g. blocked by a freeway) and the citizen gives up: a lost resident. */
const FAILED_TRIP_PENALTY = 10;

/** A walking citizen's FUEL is a persistent ENERGY tank, not a per-leg budget: it is SPENT crossing
 *  terrain (a beaten path is cheap, lush wild ground dear — see `fuelBurn`) and REFILLED by visiting
 *  good plots (`refuelFor`, scaled by the plot's status/use). A citizen that chases an UNREACHABLE
 *  destination — looping without ever closing the distance — burns the tank down and gives out; this
 *  catches limit cycles LONGER than the `recent` window (RECENT_CAP), which `advanceMover`'s box-in
 *  check alone misses. On burnout mid-trip it turns back home on a small FUEL_LIMP_HOME reserve,
 *  losing GIVE_UP_PENALTY wellbeing; if even that runs out it respawns at home (FAILED_TRIP_PENALTY).
 *  Live-pass tunable. */
// A full tank — extended +250% (3.5x the old 600) so travelers reach far more of the city before
// burning out (Maddy): long multi-stop rounds and cross-town trips complete instead of giving up.
export const FUEL_TANK = 2100;
const FUEL_LIMP_HOME = 200; // the reserve granted on give-up, just enough to drag itself home
const FUEL_BURN_BASE = 1; // fuel spent per substep on a paved/built/bare tile
const FUEL_BURN_LUSH = 0.8; // extra burn at full floraVitality — lush ground is tiring
const FUEL_BURN_BEATEN = 0.7; // burn saved on a fully-beaten path — easy underfoot
const FUEL_BURN_MIN = 0.3; // floor on per-substep burn
const FUEL_REFUEL_BASE = 120; // base fuel a visit hands back
const FUEL_REFUEL_PER_VALUE = 30; // × the plot's visitValue (−4..+6): healing refuels lots, industry ~none
const GIVE_UP_PENALTY = 4;

/** Desire-path WEAR: pedestrians beat a path through WILD-GREEN ground (empty land whose flora
 *  is at least WEAR_FLORA_MIN). Each ped on such a tile adds WEAR_RATE per substep up to
 *  WEAR_MAX; unused wear decays by WEAR_DECAY so a path regrows once foot traffic reroutes
 *  (e.g. onto a promenade the player lays down). Live/cosmetic — the deterministic ecology
 *  layers are read, never written. */
const WEAR_MAX = 255;
const WEAR_RATE = 1.5;
// Slow decay so repeated crossings ACCUMULATE into a bold, persistent desire line instead of
// a single faint crossing fading at once; the path still regrows over minutes if foot traffic
// reroutes (e.g. onto a promenade the player lays down).
const WEAR_DECAY = 0.02;

/** Water-runoff pollution: water tiles are impassable and instead collect runoff from the
 *  ground around them, growing heavily polluted over time. Computed every WATER_RUNOFF_CADENCE
 *  substeps; each ground 4-neighbour sheds RUNOFF_* into the water tile (paved/built/worn ground
 *  sheds most, wild ground least), accumulating toward WATER_POLL_MAX. Live/cosmetic. */
const WATER_POLL_MAX = 255;
const WATER_RUNOFF_CADENCE = 20;
const RUNOFF_URBAN = 2; // a paved/built ground neighbour
const RUNOFF_WILD = 0.4; // a wild/empty ground neighbour
const RUNOFF_WORN = 2; // extra when that ground is a beaten desire path
const RUNOFF_INDUSTRY = 4; // an industrial neighbour (the toxic source), grade-scaled up to 2x
const WATER_FLOW_FRACTION = 0.25; // share of a tile's pollution that flows downstream per cadence
const WATER_TREAT_RADIUS = 6; // a wastewater works cleans water within this Manhattan radius
const WATER_TREAT_AMOUNT = 30; // pollution removed at the works per cadence (falls off with distance)

/** Ground pollution: the LAND analogue of water runoff. Industry + dirty power + the litter/wear of
 *  demand paths poison the ground they sit on and the land around them, accumulating toward
 *  GROUND_POLL_MAX and clearing slowly once the source is gone (a lingering toxic legacy the player
 *  heals). The real source that then runs off into the creeks. Whole-map scan on a slow cadence;
 *  live/cosmetic, never hashed. */
const GROUND_POLL_MAX = 255;
const GROUND_RUNOFF_CADENCE = 20; // substeps between ground-contamination passes (matches water)
const GROUND_INDUSTRY = 5; // an industrial tile poisons its own ground, grade-scaled up to 2x
const GROUND_PLANT = 6; // a dirty power plant poisons the ground under it
const GROUND_SEEP = 1.5; // an industrial/plant NEIGHBOUR seeps into adjacent ground (the plume)
const GROUND_LITTER = 3; // demand-path litter/wear leaches in, scaled by the tile's wear
const GROUND_DECAY = 0.8; // lingers — contaminated land is slow to recover (but reparable)

// Abandoned cars: an arrested citizen is removed from the game, so their car is left a DERELICT —
// dumped on an empty tile (not driven home), where it slowly RUSTS into ground pollution and then
// disappears, leaving a contaminated patch the player must heal (the toxic legacy of the apparatus).
const ABANDONED_DEGRADE_TIME = 2400; // substeps a wreck sits before it has fully rusted away (~2 min)
const ABANDONED_GROUND_POLL = 0.35; // ground pollution it leaks per substep (outpaces GROUND_DECAY)

/** Road decay: redlined roads crumble (the city won't maintain the disinvested districts), while
 *  roads in a CARED-FOR neighborhood (land value at/above ROAD_CARED_LV) recover. Crumbling
 *  scales with the road tile's redline grade, so greenlined roads stay sound. Live/non-hashed. */
const ROAD_DECAY_MAX = 255;
const ROAD_CADENCE = 30; // recompute road decay every N substeps (a slow infrastructure clock)
const ROAD_CRUMBLE_RATE = 6; // decay added per cadence to a fully redlined, uncared road
const ROAD_RECOVER_RATE = 24; // decay removed per cadence where cared-for — recovery clearly
//                               outpaces crumbling so a healed district's roads visibly mend
const ROAD_CARED_LV = 100; // local land value at/above which roads get maintained (recover)

/** Substeps a pedestrian spends INSIDE its destination building before walking back to the
 *  car: a base plus a seeded spread so visitors don't all return together. ~3–13s. */
const INSIDE_DWELL_MIN = 60;
const INSIDE_DWELL_SPAN = 200;

/** How strongly a car prefers to continue straight through a junction vs. turn (the
 *  weight of the straight-ahead option against each side option). High enough that
 *  cars read as through-traffic running a vertical/horizontal road block, low enough
 *  that they still occasionally turn. With 4 ways open: straight ~8/10, each turn
 *  ~1/10. Live-pass tunable. Peds keep uniform choice (weight 1). */
const CAR_STRAIGHT_WEIGHT = 8;

/** How many recently-visited tiles a car remembers for loop avoidance. Big enough to
 *  span the perimeter of a small block (a 2x2 ring is 4, a 3x3 ring is 8), so a car
 *  that has been all the way round is boxed in and despawns rather than circling. */
const RECENT_CAP = 8;

/** Minimum faunaPresence (0..255) for a bird flock to consider a tile. */
const FAUNA_THRESHOLD = 96;

const FLOCK_MIN = 3;
const FLOCK_MAX = 7;

// Boids tuning (sqrt-normalized — no trig). Gentle so a flock stays cohesive.
const BIRD_MAX_SPEED = 0.08;
const BIRD_COHESION = 0.012;
const BIRD_ALIGN = 0.04;
const BIRD_SEPARATION = 0.02;
const BIRD_SEP_RADIUS2 = 1.0; // squared tile distance under which separation kicks in

// 4-neighbour directions, indexed 0=N, 1=E, 2=S, 3=W.
const DIR_DX = [0, 1, 0, -1] as const;
const DIR_DY = [-1, 0, 1, 0] as const;
const opposite = (d: number): number => (d + 2) % 4;

/** Lane half-width in tile units: how far a car is drawn off its tile centre, to the
 *  RIGHT of its heading, so opposing flows ride opposite sides of a road. Cosmetic —
 *  read only by the renderer's sprite draw; live-pass tuned. */
const LANE = 0.22;

/** The lane seam (pure, `dir`-only): a car's draw-time offset from its tile centre,
 *  perpendicular to and on the RIGHT of its heading (right-hand traffic). Screen
 *  coords are y-down, so "right" is the heading rotated 90° clockwise: (dx,dy) →
 *  (-dy, dx). On any vertical/horizontal road the two travel directions are therefore
 *  drawn on opposite sides — bidirectional flow, visibly separated (Maddy playtest).
 *  0=N→east side, 1=E→south side, 2=S→west side, 3=W→north side. */
export function laneOffset(dir: number): { dx: number; dy: number } {
  return { dx: -DIR_DY[dir]! * LANE, dy: DIR_DX[dir]! * LANE };
}

/** How far a street-parked car is drawn toward its curb (the adjacent non-road tile). Larger
 *  than LANE so the car clears the lane centre and hugs the kerb instead of sitting in the
 *  middle of the road — but < 0.5 so it stays within its own tile. */
const CURB = 0.32;

/** A street-parked car's draw-time offset from its tile centre, straight toward its recorded
 *  curb side (curbDir, 0=N/1=E/2=S/3=W) so it parks against the building/grass edge rather
 *  than on the lane. Cosmetic — read only by the renderer. */
export function curbParkOffset(curbDir: number): { dx: number; dy: number } {
  return { dx: DIR_DX[curbDir]! * CURB, dy: DIR_DY[curbDir]! * CURB };
}

/** How far a pedestrian is drawn toward the kerb (perpendicular to its heading) when walking
 *  ALONG a street — bigger than the car LANE so it clears the traffic onto the sidewalk edge.
 *  Opposite-direction walkers ride opposite kerbs (right-hand), so both sides of the street
 *  are used. Through-the-middle is reserved for demand-path cut-throughs across open ground. */
const PED_CURB = 0.38;

/** A pedestrian's draw-time kerb offset (perpendicular-right of its heading), for when it is
 *  walking along a road. Cosmetic — read only by the renderer's sprite draw. */
export function pedCurbOffset(dir: number): { dx: number; dy: number } {
  return { dx: -DIR_DY[dir]! * PED_CURB, dy: DIR_DX[dir]! * PED_CURB };
}

/** A grid-following sprite: float world position + heading + committed target tile. */
export interface Mover {
  /** Float world position in tile units. */
  x: number;
  y: number;
  /** Current travel direction (0=N, 1=E, 2=S, 3=W). */
  dir: number;
  /** Committed target tile (integer tile coords) — the end of the current leg. */
  tx: number;
  ty: number;
  /** Recently-visited tile indices (bounded, oldest-first) for loop avoidance. A car
   *  prefers a neighbour NOT in this list; if boxed in (all options recent) it
   *  despawns instead of circling. Lazily created on first recommit. */
  recent?: number[];
  /** Committed trip path (tile indices, origin→destination) — set for cars that ARE the
   *  sim's planned O-D trips. A car with a `path` follows it leg by leg (see pathStep)
   *  and despawns on arrival, instead of wandering. */
  path?: readonly number[];
  /** Cursor into `path`: the index of the NEXT tile to commit to. */
  leg?: number;
  /** For a walking ped following a committed `walkPath`: the tile index of the path's GOAL, so the
   *  route is recomputed when the destination (`walkTo`) changes (a new itinerary stop / heading
   *  home) and reused otherwise. Undefined for cars (they recommit via their own leg machinery). */
  pathGoal?: number;
  /** Straight-line walk target (float world coords) — set for LAST-MILE pedestrians who
   *  walk between a parked car and a nearby building. A ped with `walkTo` lerps straight
   *  toward it (ignoring the road/ped grid, so it can cross a lot or road), despawns on
   *  arrival, and is exempt from the ped-substrate despawn. */
  walkTo?: { x: number; y: number };
  /** A car that has finished its trip and is PARKED — in a lot stall (lotIdx/stallIdx set)
   *  or at a street curb (lotIdx undefined). It waits for its bound pedestrian to return,
   *  then leaves; `dwell` is a safety countdown (the ped normally releases it by zeroing it). */
  parked?: boolean;
  dwell?: number;
  lotIdx?: number;
  stallIdx?: number;
  /** Stable id assigned when a car parks, so its pedestrian can find its way back to it. */
  id?: number;
  /** The citizen's HOME building tile (a residential neighbour of the trip origin), set when
   *  a trip leaves a residential plot. The destination's visit wellbeing is deposited here on
   *  return. Undefined ⇒ a non-residential (freight) trip — no home, no health deposit. */
  homeTile?: number;
  /** For a street-parked car: the direction (0=N/1=E/2=S/3=W) toward its curb (the adjacent
   *  non-road tile), so the renderer draws it hugging the kerb instead of in the lane. */
  curbDir?: number;
  /** A colour tag bound to the car at spawn (a non-negative int the renderer maps into its
   *  palette mod its length). Stays with the car for its whole life, so it shows the same
   *  colour moving on the road and parked in a lot. */
  tint?: number;
  /** A pedestrian on a citizen trip. A DRIVE trip's last-mile ped is bound to a parked car
   *  (`carId`) and returns to it ('to-car'); a WALK trip's ped has no car and returns home
   *  ('to-home'), depositing the visit at `homeTile` on arrival. `phase` tracks the leg;
   *  `building` is the destination plot (the wellbeing source); `dwellInside` times the visit. */
  carId?: number;
  phase?: 'to-building' | 'inside' | 'to-car' | 'to-home' | 'to-vehicle' | 'driving';
  building?: { x: number; y: number };
  dwellInside?: number;
  /** (Car) A citizen's OWNED vehicle — a persistent entity its owner walks to and drives. The car
   *  filter never auto-moves, dwells, or despawns an owned car; only its owner ped moves it (in the
   *  'driving' phase) and retires it when its round ends. So it never vanishes while its owner is
   *  away on foot, and is never the same entity as the rider. */
  owned?: boolean;
  /** (Car) An ABANDONED derelict — its citizen was arrested (removed from the game), so it sits on an
   *  empty tile rusting into ground pollution, then despawns. Exempt from the off-network despawn (it
   *  legitimately sits off the road) and from the owner-managed/parked-dwell branches. */
  abandoned?: boolean;
  /** (Ped, DRIVE leg) the available parking spot its owned car drives to, before the owner walks the
   *  last mile to the real destination. */
  parkAt?: { x: number; y: number };
  /** (Ped, DRIVE-HOME leg) where to walk after parking the car, then despawn (the home plot). */
  homeDest?: { x: number; y: number };
  /** Substeps a walking citizen has spent on a road/stroad this trip — taxes the home deposit. */
  roadSteps?: number;
  /** Substeps a walking citizen has spent on a heavily-WORN (degraded) desire path this trip —
   *  also taxes the home deposit: a beaten path is convenient underfoot but bleak. */
  wornSteps?: number;
  /** A citizen's daily round: the ordered stop CATEGORIES it visits (work, shop, lifestyle) before
   *  heading home. Undefined ⇒ a single-stop walk (a sim trip). `itinStep` is the index of the stop
   *  it is currently travelling to / visiting; on each `inside` it advances to the next reachable
   *  stop, banking that visit's wellbeing at home, and heads home once the round is done. */
  itinerary?: readonly StopCategory[];
  itinStep?: number;
  /** A walking citizen's remaining FUEL: a persistent energy tank (lazily FUEL_TANK), spent per
   *  substep by the terrain underfoot and refilled at plots. When it hits zero the citizen gives up
   *  — turns home on a limp reserve, or respawns at home if even that fails. Guards against
   *  oscillation toward an unreachable destination (a limit cycle the `recent` window can't catch). */
  fuel?: number;
  /** The travel MODE for the current leg (walk/bike/streetcar/rail/drive). Undefined ⇒ Walk (the
   *  default + back-compat). Chosen per leg by distance + nearby infra; sets which tiles the mover
   *  can enter, which it hugs (the mode's network), and how fast it goes. */
  mode?: TravelMode;
  /** (Cruiser) chase personality, ghost-style: 0 = direct (chase the citizen's tile, Blinky), 1 =
   *  ambush (target AHEAD of the citizen's heading, Pinky), 2 = shy (only pounce when close, else
   *  patrol, Clyde). Assigned at spawn; read by huntTarget. */
  personality?: number;
}

export type Car = Mover;
export type Ped = Mover;

/** One bird within a flock. */
export interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A bird flock: a cohesive cluster of 3..7 boids. */
export interface Flock {
  birds: Bird[];
}

/** A parking lot the ambient layer can store cars in: its centre, its bounding box (for the
 *  nearest-TILE search — a car parks in a big lot from the edge it arrives at, not only when near
 *  the far-off centre), and its stall centres (float world coords, capacity = stalls.length).
 *  Occupancy is dynamic — derived from the parked cars, not stored here. */
export interface ParkingLotInfo {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stalls: ReadonlyArray<{ x: number; y: number }>;
}

/** Squared distance from (x, y) to the nearest point of a lot's bounding box (0 inside it). Lets a
 *  car at a big lot's EDGE select it even when its centre is far out of PARK_RADIUS (Maddy: big
 *  lot blocks held one car each because selection keyed off the distant centre). */
function lotBboxDist2(lot: ParkingLotInfo, x: number, y: number): number {
  const cx = x < lot.x0 ? lot.x0 : x > lot.x1 ? lot.x1 : x;
  const cy = y < lot.y0 ? lot.y0 : y > lot.y1 ? lot.y1 : y;
  return (cx - x) * (cx - x) + (cy - y) * (cy - y);
}

/** The full ambient sprite state — renderer-side only, never part of the world. */
export interface AmbientState {
  cars: Car[];
  peds: Ped[];
  /** Police cruisers patrolling out of the precincts — the visible over-policing of the
   *  redlined districts. They wander the local roads (flashing lights, renderer-side) and
   *  make arrests that drain the community (see stepArrests). Live, never hashed. */
  cruisers: Mover[];
  /** Substep counter gating the arrest sweep to ARREST_CADENCE. */
  arrestTick: number;
  /** Substep counter driving the police scatter/chase phase (the ghost cadence). */
  policeTick: number;
  /** Live POLICE VIOLENCE (0..POLICE_VIOLENCE_MAX), keyed by tile: laid where arrests happen,
   *  lingering as a slow-decaying record. This is the anti-crime-map — it shows where the STATE
   *  inflicts harm, not where residents are blamed. Renderer-side, never hashed. */
  policeViolence: Map<number, number>;
  birds: Flock[];
  /** Leftover sub-substep time carried between stepAmbient calls. */
  accMs: number;
  /** The parking lots that STORE the moving cars: a trip-car parks in the nearest one on
   *  arrival (or at a street curb if none is free), waits for its pedestrian, then leaves.
   *  Renderer-side, set by the host via setParkingLots; never part of the world hash. */
  parkingLots?: ReadonlyArray<ParkingLotInfo>;
  /** Monotonic counter for parked-car ids (so a pedestrian can rebind to its own car). */
  nextCarId?: number;
  /** Live per-building HEALTH, keyed by home building tile index: the running sum of what
   *  its citizens bring home from their trips (decayed toward neutral). Renderer-side, never
   *  hashed — it reads the deterministic world but is a live overlay quantity. */
  buildingHealth: Map<number, number>;
  /** Live trample WEAR (0..WEAR_MAX), keyed by tile index: how hard pedestrians have beaten a
   *  desire path through a wild-green tile. Accumulates under foot traffic, decays when unused
   *  (the path regrows). Renderer-side, never hashed — the deterministic ecology is untouched;
   *  the renderer browns the ground + litters trash by this value. */
  wear: Map<number, number>;
  /** Live WATER POLLUTION (0..WATER_POLL_MAX), keyed by water tile index: runoff collected from
   *  the surrounding ground, growing heavily polluted over time. Renderer-side, never hashed. */
  waterPollution: Map<number, number>;
  /** Substep counter gating the (whole-map) water-runoff pass to WATER_RUNOFF_CADENCE. */
  waterTick: number;
  /** Live GROUND POLLUTION (0..GROUND_POLL_MAX), keyed by LAND tile: industry + dirty power + the
   *  litter/wear of demand paths poison the surrounding land, lingering and slow to clear (the land
   *  analogue of water runoff — the toxic legacy the player heals). Renderer-side, never hashed. */
  groundPollution: Map<number, number>;
  /** Substep counter gating the (whole-map) ground-contamination pass to GROUND_RUNOFF_CADENCE. */
  groundTick: number;
  /** Live AGENT-DRIVEN traffic density (0..TRAFFIC_MAX), keyed by road tile: laid by cars as they
   *  drive, decayed when they don't. THE traffic — emergent from the agents, not an aggregate field.
   *  Car pathfinding routes around it and peds shun it; renderer-side, never hashed. */
  traffic: Map<number, number>;
  /** Live AGENT-DRIVEN air pollution (0..POLL_MAX), keyed by tile: cars emit it on the tiles they
   *  drive (heavier on freeways / in congestion), lingering as smog that decays slowly. Peds shun it
   *  and it drags land value down. Renderer-side, never hashed — the smog emerges from the vehicles. */
  pollution: Map<number, number>;
  /** The world's prevailing wind (integer unit vector): air pollution drifts one tile along it each
   *  drift pass, so smog streaks downwind into plumes. Seeded per world from the ambient rng (never
   *  the sim streams); defaults to a westerly. Renderer-side, never hashed. */
  wind: { dx: number; dy: number };
  /** Substep counter gating the smog-drift pass to WIND_CADENCE. */
  windTick: number;
  /** Live DERIVED land value (0..LV_MAX), keyed by inhabited plot tile: desirability recomputed on a
   *  slow cadence from greenery + amenity neighbours minus pollution/traffic/decay. Steers citizen
   *  destinations (and, next, household growth). Renderer-side, never hashed. */
  landValue: Map<number, number>;
  /** Substep counter gating the (whole-map) land-value recompute to LV_CADENCE. */
  lvTick: number;
  /** Live fire/health SERVICE COVERAGE: tiles within reach of a station. Redlined zones start
   *  under-served (uncovered → a land-value drag); the player extends it. Recomputed on the LV
   *  cadence; never hashed. */
  coverage: Set<number>;
  /** Live AGENT-EMERGENT population, keyed by residential home tile: how many people actually live
   *  there now. Seeded from the census baseline, drifts toward capacity (prized/clean/healthy) or
   *  empty (decayed/smoggy) on a cadence. Drives the spawn target + home weighting. Never hashed. */
  occupancy: Map<number, number>;
  /** Substep counter gating the occupancy re-evaluation to OCC_CADENCE. */
  occTick: number;
  /** Live ROAD DECAY (0..ROAD_DECAY_MAX), keyed by road tile: how crumbled the pavement is.
   *  Redlined roads crumble (the city won't maintain the disinvested districts); roads recover
   *  where the neighborhood is cared-for (high land value). Drags land value, never hashed. */
  roadDecay: Map<number, number>;
  /** Substep counter gating the road-decay pass to ROAD_CADENCE. */
  roadTick: number;
  /** The residential homes citizens are spawned from (the census), published by the host via
   *  setHouseholds. Each spawn picks a home weighted by its citizen count (denser → more people
   *  out), so the daily-itinerary population reflects the built city. Renderer-side, never hashed. */
  households?: ReadonlyArray<Household>;
  /** Dirty power-plant emission sources: {tile, amount} laid into the air-pollution field every
   *  step (like a car's exhaust, but persistent). Published by the host via setPlantEmitters from
   *  the built layer, so a coal/gas plant smogs its district. Renderer-side, never hashed. */
  plantEmitters?: ReadonlyArray<{ tile: number; amount: number }>;
}

export function createAmbientState(rng?: Rng): AmbientState {
  return {
    wind: prevailingWind(rng),
    windTick: 0,
    cars: [],
    peds: [],
    cruisers: [],
    arrestTick: 0,
    policeTick: 0,
    policeViolence: new Map(),
    birds: [],
    accMs: 0,
    buildingHealth: new Map(),
    wear: new Map(),
    waterPollution: new Map(),
    waterTick: 0,
    groundPollution: new Map(),
    groundTick: 0,
    traffic: new Map(),
    pollution: new Map(),
    landValue: new Map(),
    lvTick: 0,
    coverage: new Set(),
    occupancy: new Map(),
    occTick: 0,
    roadDecay: new Map(),
    roadTick: 0,
  };
}

/** Publish the parking lots that store moving cars. The host (main.ts) computes these from
 *  the map's ParkingLot components (centre + stall grid) so parked cars land on the stalls. */
export function setParkingLots(state: AmbientState, lots: ReadonlyArray<ParkingLotInfo>): void {
  state.parkingLots = lots;
}

/** Publish the residential homes citizens spawn from (the host computes these from the parcel
 *  store via residentialCensus). Mirrors setParkingLots — structural, never part of the world. */
export function setHouseholds(state: AmbientState, households: ReadonlyArray<Household>): void {
  state.households = households;
}

/** Publish the dirty-plant emission sources (the host computes these from the built layer via
 *  power.plantPollution + each plant's footprint plume). Mirrors setHouseholds — structural,
 *  never part of the world; stepAmbient lays them into the live air-pollution field each pass. */
export function setPlantEmitters(
  state: AmbientState,
  emitters: ReadonlyArray<{ tile: number; amount: number }>,
): void {
  state.plantEmitters = emitters;
}

// --- Pure decision helpers (unit-test seams) -----------------------------

/**
 * Spawn WEIGHT for cars by road class: highway 3 / avenue 2 / street 1, and 0 for
 * quiet streets, rail, buildings and empty land. THE load-bearing ratio contract —
 * an exact, deterministic function with no tolerance.
 */
export function carWeightForRoad(kind: number): number {
  switch (kind) {
    case BuiltKind.RoadHighway:
      return 3;
    case BuiltKind.RoadAvenue:
      return 2;
    case BuiltKind.RoadStreet:
      return 1;
    default:
      return 0;
  }
}

/**
 * Car TRAVERSABILITY: kinds 1..3 (street/avenue/highway). Pinned to isRoadKind, NOT
 * transportCategory (which returns 1 for QuietStreet) — so a car neither spawns on
 * nor moves onto a quiet street. This is the seam that closes the spawn-vs-move gap.
 */
export function isCarRoad(kind: number): boolean {
  return isRoadKind(kind);
}

/** A lane within a divided multi-lane road (a widened avenue/freeway: parallel rows
 *  of the SAME road kind). An `outer` lane is one-way (right-hand traffic) with its
 *  `dir` heading and `outward` road edge; the `through` lane is the interior of a 3+-wide
 *  road and carries traffic BOTH ways along the road's axis (Maddy: middle goes both). The
 *  `median` role is reserved for the future planted no-traffic median (a road-diet upgrade). */
export type FreewayLane =
  | { role: 'outer'; dir: number; outward: number }
  | { role: 'through'; horizontal: boolean }
  | { role: 'median' };

/** Per-direction cap when measuring a same-kind run: widths are 2–3, so a short cap
 *  ranks the two axes (the shorter run is the road's width) without scanning a whole
 *  freeway's length, and classifies end tiles the same as mid tiles. */
const LANE_SCAN_CAP = 3;

/** Length of the same-kind run from (x, y) in direction (dx, dy), exclusive of the
 *  origin, capped at LANE_SCAN_CAP. */
function sameRun(map: GameMap, x: number, y: number, k: number, dx: number, dy: number): number {
  let n = 0;
  for (let i = 1; i <= LANE_SCAN_CAP; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (!map.inBounds(nx, ny) || !inLaneBand(k, map.built[map.idx(nx, ny)]!)) break;
    n++;
  }
  return n;
}

/**
 * Classify a road tile's place in a divided multi-lane road, or `null` if it is not a
 * clean multi-lane lane — a 1-wide road or a junction where the two same-kind bands are
 * equal (a square crossing). Those fall back to general straight-biased routing, so a
 * car CAN turn there: that is exactly "turns only at a true junction". Read purely from
 * same-kind neighbours (read-only, no rng):
 *   1. Measure the same-kind run length along each axis (capped). The shorter run is the
 *      road's WIDTH axis; the longer is its LENGTH. This ranks correctly at lane ends
 *      and mid-lane alike (an end tile still has the full width band).
 *   2. On the width axis: same-kind road on BOTH sides → `median` (interior of a 3+-wide
 *      road, no traffic). Same-kind on one side only → `outer`: the bare side is the road
 *      `outward` edge (kerb), and the one-way `dir` is the heading whose right-hand side
 *      is that edge (right-hand traffic). So a horizontal freeway's north lane runs west
 *      and its south lane runs east; `laneOffset(dir)` then nudges each carriageway to
 *      its own kerb. Neither side same → 1-wide road → `null`.
 */
export function freewayLane(map: GameMap, x: number, y: number): FreewayLane | null {
  const k = map.built[map.idx(x, y)]!;
  // A planted median is a no-traffic lane in its own right (the road-diet upgrade) — classify it
  // directly so canDrive treats it as a green barrier (no driving on or across it).
  if (k === BuiltKind.PlantedMedian) return { role: 'median' };
  // Only worldgen-WIDENED roads are divided: avenues are 2-wide, highways 3-wide.
  // Streets are 1-wide by construction, so a same-kind street neighbour is a junction
  // arm, never a parallel lane — classifying a street as a lane misreads a staggered
  // street junction as two OPPOSING one-way tiles that oscillate (Maddy degenerate).
  if (k !== BuiltKind.RoadAvenue && k !== BuiltKind.RoadHighway) return null;
  const same = (d: number): boolean => {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    return map.inBounds(nx, ny) && inLaneBand(k, map.built[map.idx(nx, ny)]!);
  };
  const vert = 1 + sameRun(map, x, y, k, 0, -1) + sameRun(map, x, y, k, 0, 1);
  const horiz = 1 + sameRun(map, x, y, k, -1, 0) + sameRun(map, x, y, k, 1, 0);
  if (horiz > vert) {
    // Horizontal road — width is the N–S axis. Outer lanes one-way (right-hand traffic); the
    // interior is a two-way `through` lane (Maddy: south goes east, north goes west, middle both).
    const n = same(0); // North neighbour same-kind?
    const s = same(2); // South neighbour same-kind?
    if (n && s) return { role: 'through', horizontal: true };
    if (s && !n) return { role: 'outer', dir: 3, outward: 0 }; // north lane → West
    if (n && !s) return { role: 'outer', dir: 1, outward: 2 }; // south lane → East
    return null;
  }
  if (vert > horiz) {
    // Vertical road — width is the E–W axis. Interior is a two-way `through` lane (see above).
    const e = same(1); // East neighbour same-kind?
    const w = same(3); // West neighbour same-kind?
    if (e && w) return { role: 'through', horizontal: false };
    if (e && !w) return { role: 'outer', dir: 2, outward: 3 }; // west lane → South
    if (w && !e) return { role: 'outer', dir: 0, outward: 1 }; // east lane → North
    return null;
  }
  return null; // equal bands — a square crossing → general routing (a true junction)
}

/**
 * Pedestrian SUBSTRATE at (x, y): a quiet street, promenade, or parklet tile, OR any
 * tile orthogonally adjacent to a community garden, park, or rewilded land. Peds
 * favour the calm/green city, never the road network.
 */
export function isPedSubstrate(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  // An elevated PROMENADE deck (an overpass) is walkable regardless of what's below — so a promenade
  // overpass carries pedestrians ACROSS a freeway they could never cross at grade.
  if (map.deck[map.idx(x, y)] === BuiltKind.Promenade) return true;
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.QuietStreet || k === BuiltKind.Promenade || k === BuiltKind.Parklet) {
    return true;
  }
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const nk = map.built[map.idx(nx, ny)]!;
    if (nk === BuiltKind.CommunityGarden || nk === BuiltKind.Park || nk === BuiltKind.RewildedLand) {
      return true;
    }
  }
  return false;
}

/**
 * Bird-flock spawn predicate: faunaPresence at (x, y) is at or above the threshold
 * (a dead zone — fauna below threshold, including 0 — is excluded).
 */
export function birdSpawnAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return map.faunaPresence[map.idx(x, y)]! >= FAUNA_THRESHOLD;
}

/** Generic junction step: pick a connected passable neighbour direction, excluding
 *  the U-turn `fromDir` unless it is the only option (dead-end). -1 if isolated.
 *
 *  `straightWeight` (default 1 = uniform) biases the choice toward continuing in the
 *  current heading (the direction opposite the U-turn): with N ways open, the
 *  straight option weighs `straightWeight` against 1 for each turn. Cars pass a high
 *  weight so they run a road block and cross junctions instead of looping small
 *  blocks (Maddy playtest); peds keep the uniform default.
 *
 *  `recent` (tile indices recently occupied) drives loop avoidance: options leading to
 *  a recently-visited tile are dropped UNLESS that would leave nothing, in which case
 *  the mover is boxed in by its own path and the step returns -1 (the caller despawns
 *  it rather than letting it circle). A dead-end U-turn is still taken (it is the
 *  `options.length === 0` path, before avoidance). Determinism note: the dead-end and
 *  single-fresh-option paths consume the rng exactly as before, so junction-free maps
 *  are byte-identical when `recent` never prunes. */
function pickStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  passable: (nx: number, ny: number) => boolean,
  straightWeight = 1,
  recent?: readonly number[],
): number {
  const options: number[] = [];
  let uTurn = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    if (!passable(nx, ny)) continue;
    if (d === fromDir) {
      uTurn = d;
      continue;
    }
    options.push(d);
  }
  if (options.length === 0) return uTurn; // dead-end (or -1 if truly isolated)
  // Loop avoidance: prefer options that do not revisit a recent tile. If every option
  // is recent, the mover is boxed in by its own path → -1 (caller despawns it).
  let pool = options;
  if (recent && recent.length > 0) {
    const fresh = options.filter((d) => !recent.includes(map.idx(x + DIR_DX[d]!, y + DIR_DY[d]!)));
    if (fresh.length === 0) return -1;
    pool = fresh;
  }
  // Uniform choice when there's nothing to bias toward: a single option, no weight,
  // or no incoming heading (fromDir < 0, i.e. spawn) — at spawn there is no "straight"
  // to prefer, and keeping the uniform draw makes spawn rng-identical to before.
  if (pool.length === 1 || straightWeight <= 1 || fromDir < 0) {
    return pool[rng.nextInt(pool.length)]!;
  }
  // Weighted junction choice: the straight-ahead direction (opposite the U-turn)
  // outweighs each turn by `straightWeight`, so traffic flows through the corridor.
  const straight = opposite(fromDir);
  let total = 0;
  for (const d of pool) total += d === straight ? straightWeight : 1;
  let r = rng.nextInt(total);
  for (const d of pool) {
    r -= d === straight ? straightWeight : 1;
    if (r < 0) return d;
  }
  return pool[pool.length - 1]!; // unreachable: r < total
}

/** Routing on a divided multi-lane road's outer lane: travel the one-way `dir`; turn
 *  off ONLY where a cross-road meets the outward edge (a true junction); never weave
 *  across to the median/opposite carriageway and never reverse. */
function freewayStep(
  map: GameMap,
  x: number,
  y: number,
  lane: { dir: number; outward: number },
  rng: Rng,
): number {
  const ax = x + DIR_DX[lane.dir]!;
  const ay = y + DIR_DY[lane.dir]!;
  const aheadRoad = map.inBounds(ax, ay) && isCarRoad(map.built[map.idx(ax, ay)]!);
  const ox = x + DIR_DX[lane.outward]!;
  const oy = y + DIR_DY[lane.outward]!;
  const exitRoad = map.inBounds(ox, oy) && isCarRoad(map.built[map.idx(ox, oy)]!);
  if (aheadRoad && exitRoad) {
    // True junction: mostly stay on the freeway, occasionally take the ramp.
    return rng.nextInt(CAR_STRAIGHT_WEIGHT + 1) === 0 ? lane.outward : lane.dir;
  }
  if (aheadRoad) return lane.dir; // open freeway — straight, no turns, no weaving
  if (exitRoad) return lane.outward; // freeway ended at a ramp — exit
  return lane.dir; // ran out of road — continue off-network, despawn next step
}

/** A car may occupy a road (1..3) or a parking lot — cars cut THROUGH parking (the
 *  accumulated concrete of the over-paved city) rather than routing around it. */
function carTraversable(kind: number): boolean {
  return isCarRoad(kind) || kind === BuiltKind.ParkingLot || kind === BuiltKind.RoadRamp;
}

/** A freeway-family tile for LANE GEOMETRY: a highway or a ramp. A ramp is a freeway tile that also
 *  meets the surface, so for run-length classification it counts as freeway (it must not break the
 *  lane runs around it), even though canDrive treats the ramp itself as a free interchange. */
function isFreewayKind(kind: number): boolean {
  return kind === BuiltKind.RoadHighway || kind === BuiltKind.RoadRamp;
}

/** Same lane material for run measurement: identical kinds, or both freeway-family (highway/ramp). */
function sameLaneKind(a: number, b: number): boolean {
  return a === b || (isFreewayKind(a) && isFreewayKind(b));
}

/** Whether neighbour kind `b` belongs to road `a`'s WIDTH BAND for lane classification: the same
 *  lane material, OR a PlantedMedian. A planted median is a no-traffic lane WITHIN the road, so it
 *  must count toward the road's width — otherwise a road-diet median between two carriageways would
 *  make each carriageway read as a 1-wide road and lose its one-way direction. */
function inLaneBand(a: number, b: number): boolean {
  return sameLaneKind(a, b) || b === BuiltKind.PlantedMedian;
}

/** An at-grade rail/tram LINE a car may CROSS at a level crossing (it can never drive ALONG it): a
 *  streetcar or a rail line. Lets a cross street cross a tram median at an intersection without the
 *  transit tile blocking it (Maddy: a streetcar in flanking avenues must not block cross traffic). */
function isLevelCrossable(kind: number): boolean {
  return kind === BuiltKind.Streetcar || kind === BuiltKind.Rail;
}

/** Car traversability for general (non-lane) routing: a road or parking tile that is
 *  NOT a divided road's median. Cars neither spawn on, weave onto, nor turn (at a
 *  junction) onto a median — so the median stays a true no-traffic gap. */
function carPassable(map: GameMap, x: number, y: number): boolean {
  if (!carTraversable(map.built[map.idx(x, y)]!)) return false;
  const lane = freewayLane(map, x, y);
  return lane === null || lane.role !== 'median';
}

/** A tile a car may come to REST on: a non-freeway street/avenue/parking surface on dry land.
 *  Freeways carry no parking and a road over water is a bridge, not a kerb — both are excluded, so
 *  a car never freezes on a freeway or over water (Maddy: cars parking on freeways). The single
 *  authoritative parking predicate, shared by the kerb search and the owned-car park fallback. */
export function isParkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.built[map.idx(x, y)]!;
  if (!carTraversable(k) || k === BuiltKind.RoadHighway) return false;
  return map.water[map.idx(x, y)] === 0;
}

/** The grid direction (0..3) of the step from (fx,fy) to an orthogonally-adjacent (tx,ty). */
function moveDir(fx: number, fy: number, tx: number, ty: number): number {
  if (tx > fx) return 1; // East
  if (tx < fx) return 3; // West
  if (ty > fy) return 2; // South
  return 0; // North
}

/** True iff direction `d` runs along a `through` lane's road axis (so a car may travel it). */
function alongThrough(lane: { horizontal: boolean }, d: number): boolean {
  return lane.horizontal ? d === 1 || d === 3 : d === 0 || d === 2;
}

/**
 * EDGE-aware car passability: may a car move from (fx,fy) to adjacent (tx,ty)? This is what makes a
 * freeway LIMITED-ACCESS (Maddy): you can only move ALONG a freeway (an outer lane in its one-way
 * `dir`, or the two-way `through` middle along the axis), and you can only enter/leave it where it is
 * NOT a clean lane — at a `null` tile, which is exactly a freeway interchange (freeway crosses
 * freeway) or an end. So cross traffic never cuts across a freeway mid-span, but does at interchanges
 * and ends. Off the freeway (at-grade streets/avenues) it is the plain `carPassable` test — those
 * stay permissive (cross traffic / the divided-avenue crossing is handled separately). Direction is
 * only meaningful for adjacent tiles; callers pass 4-neighbours.
 */
export function canDrive(map: GameMap, fx: number, fy: number, tx: number, ty: number): boolean {
  if (!map.inBounds(tx, ty)) return false;
  const toKind = map.built[map.idx(tx, ty)]!;
  if (!carTraversable(toKind)) {
    // Level crossing: a car may CROSS an at-grade tram/rail line STRAIGHT through to the drivable
    // tile beyond (a cross street crossing an avenue's streetcar median), but never drive along it.
    if (isLevelCrossable(toKind)) {
      const d = moveDir(fx, fy, tx, ty);
      const bx = tx + DIR_DX[d]!;
      const by = ty + DIR_DY[d]!;
      return map.inBounds(bx, by) && carTraversable(map.built[map.idx(bx, by)]!);
    }
    return false;
  }
  const fromHwy = map.built[map.idx(fx, fy)] === BuiltKind.RoadHighway;
  const toHwy = map.built[map.idx(tx, ty)] === BuiltKind.RoadHighway;
  if (!fromHwy && !toHwy) {
    // At-grade. A divided AVENUE's outer lane is one-way (like a freeway lane) so committed routes
    // can't drive the wrong way — but UNLIKE a freeway it stays crossable: a cross street may cross
    // it perpendicular (a road continues straight beyond). Non-lane at-grade tiles are free.
    const L = freewayLane(map, tx, ty);
    if (L && L.role === 'outer') {
      const d = moveDir(fx, fy, tx, ty);
      if (d === L.dir) return true; // along the one-way lane
      if (d === opposite(L.dir)) return false; // wrong-way along the avenue
      const bx = tx + DIR_DX[d]!; // perpendicular → only as a straight crossing to a road beyond
      const by = ty + DIR_DY[d]!;
      return map.inBounds(bx, by) && carTraversable(map.built[map.idx(bx, by)]!);
    }
    return true;
  }
  const d = moveDir(fx, fy, tx, ty);
  if (fromHwy) {
    const L = freewayLane(map, fx, fy); // EXIT: leave a freeway only along it (or an outer ramp)
    if (L && L.role === 'outer' && d !== L.dir && d !== L.outward) return false;
    if (L && L.role === 'through' && !alongThrough(L, d)) return false;
  }
  if (toHwy) {
    const L = freewayLane(map, tx, ty); // ENTER: join a freeway only along it (never perpendicular)
    if (L && L.role === 'outer' && d !== L.dir) return false;
    if (L && L.role === 'through' && !alongThrough(L, d)) return false;
  }
  return true; // null freeway tiles (interchange / end) impose no direction → cross/turn freely
}

/**
 * The car motion seam: from road tile (x, y), the chosen connected isRoadKind
 * neighbour direction (0..3). On a divided multi-lane road's outer lane the choice is
 * the one-way `freewayStep` (independent of `fromDir`, including spawn); otherwise it
 * is the general straight-biased junction pick over `carPassable` neighbours (never a
 * median), excluding the U-turn `fromDir` unless it is the only connected road
 * (dead-end), and avoiding tiles in `recent` (loop avoidance — returns -1 if boxed in
 * by its own path). -1 if (x, y) has no road neighbour at all. Deterministic given `rng`.
 */
export function nextRoadStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  recent?: readonly number[],
): number {
  const lane = freewayLane(map, x, y);
  if (lane && lane.role === 'outer') {
    return freewayStep(map, x, y, lane, rng); // one-way: cannot loop, no avoidance needed
  }
  // Everything else (the two-way `through` middle, an interchange/end, an at-grade junction) is the
  // straight-biased pick — but over canDrive edges, so a `through` car stays on-axis and a car can
  // only cross/turn onto a freeway where it's an interchange/end (limited access).
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => canDrive(map, x, y, nx, ny), CAR_STRAIGHT_WEIGHT, recent);
}

/** The pedestrian motion seam: the same junction rule over ped substrate. */
function nextPedStep(map: GameMap, x: number, y: number, fromDir: number, rng: Rng): number {
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => isPedSubstrate(map, nx, ny));
}

// --- Despawn predicates --------------------------------------------------

/** A car is gone once the tile under it is no longer traversable — a road or parking
 *  lot (e.g. bulldozed/converted, or driven off the far side of the lot it cut through). */
export function carOffNetwork(map: GameMap, c: Car): boolean {
  if (c.abandoned) return false; // a derelict legitimately sits off the road on an empty tile
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  if (!map.inBounds(x, y)) return true;
  const k = map.built[map.idx(x, y)]!;
  return !carTraversable(k) && !isLevelCrossable(k); // a car mid-crossing a tram/rail line is fine
}

/** A ped is gone once the tile under it is no longer pedestrian substrate. */
function pedOffNetwork(map: GameMap, p: Ped): boolean {
  return !isPedSubstrate(map, Math.round(p.x), Math.round(p.y));
}

/** A flock's representative tile = its (in-bounds-clamped) centre of mass. */
function flockTile(map: GameMap, f: Flock): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
  }
  const n = f.birds.length;
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(cx / n)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(cy / n)));
  return { x, y };
}

// --- Motion --------------------------------------------------------------

/** Advance one grid-following mover by `speed`, recommitting at the target tile.
 *  `map`/`rng` are captured by `pickNext` (the per-kind junction seam); the mover's
 *  bounded `recent` history is updated on arrival and passed to `pickNext` for loop
 *  avoidance. Returns false when the mover is boxed in / isolated (pickNext < 0) so the
 *  caller despawns it instead of leaving it frozen or circling; true otherwise. */
function advanceMover(
  m: Mover,
  speed: number,
  map: GameMap,
  pickNext: (x: number, y: number, fromDir: number, recent: readonly number[]) => number,
): boolean {
  const dist = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y);
  if (dist <= speed) {
    // Arrive at the target tile centre, record it, and recommit to the next leg.
    m.x = m.tx;
    m.y = m.ty;
    const recent = (m.recent ??= []);
    recent.push(map.idx(m.tx, m.ty));
    if (recent.length > RECENT_CAP) recent.shift();
    const fromDir = opposite(m.dir);
    const nd = pickNext(m.tx, m.ty, fromDir, recent);
    if (nd < 0) return false; // isolated, or boxed in by its own path → despawn
    m.dir = nd;
    m.tx = m.x + DIR_DX[nd]!;
    m.ty = m.y + DIR_DY[nd]!;
  } else {
    m.x += DIR_DX[m.dir]! * speed;
    m.y += DIR_DY[m.dir]! * speed;
  }
  return true;
}

/** Ped-walkable: any in-bounds, non-water tile that is NOT an occupied R/C/I/Civic plot and NOT
 *  a FREEWAY (RoadHighway) — local streets, stroads, transit, PARKING, parks, rewilded greens,
 *  empty land all walk; building footprints + freeways block. Routed pedestrians step across
 *  the walkable set (around plots), so they no longer cut diagonally through buildings. */
function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  if (map.water[map.idx(x, y)] !== 0) return false; // Water.None === 0
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.RoadHighway || k === BuiltKind.RoadRamp) return false; // no walking a freeway/ramp
  return zoneTypeOf(k) === ZoneType.None;
}

/** The nearest pedestrian-walkable tile to (x, y) within `maxR` (ring search, the tile itself
 *  first), or null if none is in reach. Rescues a ped that was placed OFF the walkable set — on
 *  water, a freeway, or a plot — back onto solid ground rather than leaving it stranded mid-water
 *  (Maddy: pedestrians crossing water / freeways). The self-heal seam for ped placement. */
export function nearestWalkable(
  map: GameMap,
  x: number,
  y: number,
  maxR = 8,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev distance r
        if (isWalkable(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/** A pedestrian's PREFERENCE cost for a walkable tile (lower = nicer): promenades best, then
 *  calm streets, then a LOCAL street by inverse traffic density, then open ground, with stroads
 *  (avenues) worst. So peds drift onto promenades and shun busy stroads where the route allows.
 *  WILD ground (empty land) is terrain-aware via `wear`: lush is dear, a beaten desire path cheap
 *  (foot traffic self-reinforces paths). */
export function pedCost(
  map: GameMap,
  x: number,
  y: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  const i = map.idx(x, y);
  const k = map.built[i]!;
  // Smog drifts over every tile — a polluted block is unpleasant on foot whatever its surface.
  const smog = ((pollution?.get(i) ?? 0) / POLL_MAX) * PED_POLL_WEIGHT;
  let base: number;
  if (k === BuiltKind.Promenade) base = 0.3;
  else if (k === BuiltKind.QuietStreet || k === BuiltKind.BikePath) base = 0.5;
  else if (k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue) {
    const trafficLoad = ((traffic?.get(i) ?? 0) / TRAFFIC_MAX) * 2; // LIVE agent traffic: busier → costlier on foot
    base = (k === BuiltKind.RoadStreet ? 0.55 : 2.0) + trafficLoad; // a local street vs a stroad
  } else if (k === BuiltKind.None) {
    // wild ground: lush growth (high flora) is hard going; a beaten path (high wear) is easy.
    const flora = map.floraVitality[i]! / 255;
    const worn = (wear?.get(i) ?? 0) / WEAR_MAX;
    base = Math.max(PED_GROUND_MIN, PED_GROUND_BASE + flora * PED_LUSH - worn * PED_BEATEN);
  } else base = 0.9; // parking / transit / built greens
  return base + smog;
}

/** Fuel a citizen spends on one substep at (x,y) — the SPEND side of the fuel economy, twinned with
 *  `pedCost`'s routing: a beaten desire path is cheap, lush wild ground dear, pavement/built nominal.
 *  So citizens go further on worn paths (and the network of paths reinforces itself). */
function fuelBurn(map: GameMap, wear: ReadonlyMap<number, number>, x: number, y: number): number {
  const i = map.idx(x, y);
  if (map.built[i] !== BuiltKind.None || map.water[i] !== 0) return FUEL_BURN_BASE; // paved/built/edge
  const flora = map.floraVitality[i]! / 255;
  const worn = (wear.get(i) ?? 0) / WEAR_MAX;
  return Math.max(FUEL_BURN_MIN, FUEL_BURN_BASE + flora * FUEL_BURN_LUSH - worn * FUEL_BURN_BEATEN);
}

/** Fuel a successful visit to a plot of `kind` hands back — the REFILL side: scaled by the plot's
 *  status/use (`visitValue`), floored at 0 so a grim industrial visit refuels ~nothing while a
 *  healing commons tops the tank right up. */
function refuelFor(kind: number): number {
  return Math.max(0, FUEL_REFUEL_BASE + visitValue(kind) * FUEL_REFUEL_PER_VALUE);
}

/** Wild-green ground a desire path forms through: ANY empty land (no road/building) that isn't
 *  water. Empty ground IS the wild green — even bare patches wear and litter under foot traffic
 *  (water is impassable and pollutes instead). Pedestrians crossing these trample them brown. */
export function isWearable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.built[i] === BuiltKind.None && map.water[i] === 0;
}

/** Can a citizen on `mode` occupy the tile at (x,y)? A driver is PAVEMENT-ONLY (roads + parking,
 *  no median) — it can't cross wild ground or a promenade; every other mode travels over the
 *  pedestrian-walkable set, which already includes transit tiles (a rider boards by walking onto
 *  the line, then rides it fast). */
function modeCanEnter(mode: TravelMode, map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return modeSpec(mode).pavementOnly ? carPassable(map, x, y) : isWalkable(map, x, y);
}

/** A mode's routing COST for a tile (lower = preferred): cheap ON the mode's network so the mover
 *  hugs the bike path / tram line / rail / road; off-network it pays the pedestrian preference
 *  cost (a driver, being pavement-only, is always on its road network). */
function modeCost(
  mode: TravelMode,
  map: GameMap,
  x: number,
  y: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  const k = map.built[map.idx(x, y)]!;
  if (modeRidesNetwork(mode, k)) return modeSpec(mode).networkCost;
  return modeSpec(mode).pavementOnly
    ? modeSpec(mode).networkCost
    : pedCost(map, x, y, wear, traffic, pollution);
}

/** A routed citizen's next grid step toward (tgtx, tgty) for travel `mode` (default Walk): the
 *  mode-enterable, non-recent 4-neighbour that most reduces Manhattan distance, broken by the
 *  mode's routing cost (so a rider hugs its line, a driver its roads). Returns -1 when within one
 *  tile of the target (arrived) OR when boxed in. Axis-aligned → no diagonals. */
function nextStepToward(
  map: GameMap,
  x: number,
  y: number,
  tgtx: number,
  tgty: number,
  recent?: readonly number[],
  wear?: ReadonlyMap<number, number>,
  mode: TravelMode = TravelMode.Walk,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  if (Math.abs(x - tgtx) + Math.abs(y - tgty) <= 1) return -1; // at / adjacent to the target
  let best = -1;
  let bestScore = 1e9;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!modeCanEnter(mode, map, nx, ny)) continue;
    if (recent && recent.includes(map.idx(nx, ny))) continue;
    // Distance dominates (still reaches the target); the mode cost hugs lines / shuns stroads + jams + smog.
    const score =
      Math.abs(nx - tgtx) + Math.abs(ny - tgty) + modeCost(mode, map, nx, ny, wear, traffic, pollution);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** A driving tile's PATHFINDING cost (lower = preferred): freeways are cheap (fast through-routes),
 *  avenues a bit cheaper than streets, and LIVE congestion (the traffic the agents themselves lay)
 *  adds cost so cars route AROUND jams. This is what makes a car-agent prefer the freeway and avoid
 *  a clogged street — the macro traffic pattern emerges from the agents, not an aggregate field. */
function driveTileCost(map: GameMap, x: number, y: number, traffic?: ReadonlyMap<number, number>): number {
  const i = map.idx(x, y);
  const k = map.built[i]!;
  let c = k === BuiltKind.RoadHighway ? 0.5 : k === BuiltKind.RoadAvenue ? 0.8 : 1; // freeways fast
  if (traffic) c += ((traffic.get(i) ?? 0) / TRAFFIC_MAX) * CONGESTION_WEIGHT; // shun jams
  return c;
}

/** A* over the drivable road network from (sx,sy) to (gx,gy): the committed least-cost route a
 *  car-agent follows (so it never circles), preferring freeways and avoiding congestion via
 *  driveTileCost. Returns tile indices start-first (inclusive of both ends), or null if no route /
 *  the search bound is hit. Pure: array open-list + Maps + abs heuristic (allowlist-safe). */
export function roadPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  traffic?: ReadonlyMap<number, number>,
): number[] | null {
  if (!carPassable(map, sx, sy) || !carPassable(map, gx, gy)) return null;
  const start = map.idx(sx, sy);
  const goal = map.idx(gx, gy);
  if (start === goal) return [start];
  const gScore = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: Array<{ i: number; x: number; y: number; f: number }> = [
    { i: start, x: sx, y: sy, f: Math.abs(sx - gx) + Math.abs(sy - gy) },
  ];
  let iters = 0;
  while (open.length > 0 && iters++ < ROAD_PATH_MAX_ITERS) {
    let bi = 0; // pop lowest f (linear scan — road frontiers stay small)
    for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
    const cur = open.splice(bi, 1)[0]!;
    if (cur.i === goal) {
      const path = [goal];
      let p = goal;
      while (came.has(p)) {
        p = came.get(p)!;
        path.push(p);
      }
      return path.reverse();
    }
    const baseG = gScore.get(cur.i)!;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DIR_DX[d]!;
      const ny = cur.y + DIR_DY[d]!;
      if (!canDrive(map, cur.x, cur.y, nx, ny)) continue; // directed edges: one-way + limited-access
      const ni = map.idx(nx, ny);
      const ng = baseG + driveTileCost(map, nx, ny, traffic);
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, x: nx, y: ny, f: ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5 });
      }
    }
  }
  return null;
}

/**
 * A* over the WALKABLE set from (sx,sy) toward (gx,gy), ending at the nearest walkable tile within
 * one of the target (the DOOR — building tiles aren't walkable, peds stop adjacent). The committed
 * least-cost FOOT route — the pedestrian twin of {@link roadPath} — so a citizen routes AROUND
 * buildings and freeways instead of dithering in a greedy local minimum at a wall (the bug Maddy
 * saw: peds piling up + heading home "to nowhere" when a destination sat behind a barrier). Cost via
 * {@link pedCost} (promenades cheap, stroads/smog dear → the route still prefers the calm/green
 * city). Returns tile indices start-first, or null if no foot route / the search bound is hit. Pure
 * (allowlist-safe): array open-list + Maps + abs heuristic, no rng.
 */
export function walkPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number[] | null {
  if (!isWalkable(map, sx, sy)) return null;
  const start = map.idx(sx, sy);
  const atDoor = (x: number, y: number): boolean => Math.abs(x - gx) + Math.abs(y - gy) <= 1;
  if (atDoor(sx, sy)) return [start];
  const gScore = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: Array<{ i: number; x: number; y: number; f: number }> = [
    { i: start, x: sx, y: sy, f: Math.abs(sx - gx) + Math.abs(sy - gy) },
  ];
  let iters = 0;
  while (open.length > 0 && iters++ < ROAD_PATH_MAX_ITERS) {
    let bi = 0; // pop lowest f (linear scan — foot frontiers stay small)
    for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
    const cur = open.splice(bi, 1)[0]!;
    if (atDoor(cur.x, cur.y)) {
      const path = [cur.i];
      let p = cur.i;
      while (came.has(p)) {
        p = came.get(p)!;
        path.push(p);
      }
      return path.reverse();
    }
    const baseG = gScore.get(cur.i)!;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DIR_DX[d]!;
      const ny = cur.y + DIR_DY[d]!;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = map.idx(nx, ny);
      const ng = baseG + pedCost(map, nx, ny, wear, traffic, pollution);
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, x: nx, y: ny, f: ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5 });
      }
    }
  }
  return null;
}

/** A direction-NEUTRAL spread hash of a tile index, for breaking distance/score TIES without the
 *  upper-left bias a row-major scan + strict `<` produces (adjacent tiles hash far apart). Keeps
 *  destination choice deterministic (no rng) — just unbiased across the map. Integer ops only
 *  (allowlist-safe). */
function tieHash(i: number): number {
  return Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
}

/** The nearest demand tile (R/C/I/Civic via zoneTypeOf — a place a person walks to/from)
 *  within LASTMILE_RADIUS of (cx, cy), by Manhattan distance; null if none. Ties broken by tieHash
 *  (not scan order) so equidistant choices don't all skew upper-left. */
function nearestDemandTile(map: GameMap, cx: number, cy: number): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  let bestHash = 0;
  for (let y = cy - LASTMILE_RADIUS; y <= cy + LASTMILE_RADIUS; y++) {
    for (let x = cx - LASTMILE_RADIUS; x <= cx + LASTMILE_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (zoneTypeOf(map.built[map.idx(x, y)]!) === ZoneType.None) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      const h = tieHash(map.idx(x, y));
      if (d < bestD || (d === bestD && h < bestHash)) {
        bestD = d;
        bestHash = h;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** The nearest plot serving stop `category` (work/shop/lifestyle via stopCategoryOf) within
 *  CITIZEN_TRIP_RADIUS of (cx, cy), by Manhattan distance; null if the district has none. */
export function nearestOfCategory(
  map: GameMap,
  cx: number,
  cy: number,
  category: StopCategory,
  landValue?: ReadonlyMap<number, number>,
): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestScore = 1e9;
  let bestHash = 0;
  for (let y = cy - CITIZEN_TRIP_RADIUS; y <= cy + CITIZEN_TRIP_RADIUS; y++) {
    for (let x = cx - CITIZEN_TRIP_RADIUS; x <= cx + CITIZEN_TRIP_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (stopCategoryOf(map.built[map.idx(x, y)]!) !== category) continue;
      // Distance, pulled DOWN by the plot's land value: a prized destination justifies up to LV_PULL
      // extra tiles of travel over a drab nearer one — citizens flow toward the nice parts of town.
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      const lv = landValue ? sampleField(landValue, map.idx(x, y)) : 0;
      const score = d - (lv / LV_MAX) * LV_PULL;
      // Ties broken by tieHash, NOT scan order — else every equidistant choice skews upper-left
      // (row-major + strict `<`), which clustered trips toward the map's top-left (Maddy).
      const h = tieHash(map.idx(x, y));
      const better = score < bestScore - 1e-9;
      if (better || (score < bestScore + 1e-9 && h < bestHash)) {
        if (better) bestScore = score;
        bestHash = h;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** Advance a citizen to the NEXT reachable stop on its daily round: from its current position,
 *  aim it at the nearest plot of the next itinerary category (skipping categories the district
 *  lacks). Sets it walking ('to-building') toward that plot and resets the leg's walk tolls.
 *  Returns false when no stops remain — the caller then sends it home. */
function advanceItinerary(state: AmbientState, p: Ped, map: GameMap): boolean {
  const itin = p.itinerary!;
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let step = (p.itinStep ?? 0) + 1; step < itin.length; step++) {
    const plot = nearestOfCategory(map, cx, cy, itin[step]!, state.landValue);
    if (plot) {
      p.itinStep = step;
      const mode = chooseMode(map, cx, cy, plot.x, plot.y);
      // DRIVE: walk to the owned car, drive it to a parking spot, then walk to the plot. If no car
      // can be had (land-locked), fall through and walk the leg.
      if (mode === TravelMode.Drive && setDriveLeg(state, p, map, plot, 'to-building')) return true;
      p.phase = 'to-building';
      p.walkTo = { x: plot.x, y: plot.y };
      p.building = { x: plot.x, y: plot.y };
      p.mode = mode === TravelMode.Drive ? TravelMode.Walk : mode; // drive unavailable → walk
      p.roadSteps = undefined; // a fresh leg — its tolls accrue anew
      p.wornSteps = undefined;
      return true;
    }
  }
  p.itinStep = itin.length; // round exhausted
  return false;
}

/** Is a tile of `mode`'s network within MODE_INFRA_RADIUS of (cx, cy)? (Is this mode served here?) */
function infraNear(map: GameMap, cx: number, cy: number, mode: TravelMode): boolean {
  for (let y = cy - MODE_INFRA_RADIUS; y <= cy + MODE_INFRA_RADIUS; y++) {
    for (let x = cx - MODE_INFRA_RADIUS; x <= cx + MODE_INFRA_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (modeRidesNetwork(mode, map.built[map.idx(x, y)]!)) return true;
    }
  }
  return false;
}

/** Choose a citizen's travel MODE for a leg origin→dest, after Maddy's rule — drive only when it
 *  is far AND no transit/bike/ped infrastructure serves it. WALK if close; else the best available
 *  active/transit mode whose network serves BOTH ends — rail, then streetcar, then a BIKE for a
 *  medium leg with calm/bike infra at both ends — and DRIVE as the fallback when only car infra
 *  exists. So the car-dependent decayed start (stroads) shifts to bikes/transit as the player
 *  builds them: the congestion → mode-shift → bloom loop. Walks if nothing else fits. */
export function chooseMode(map: GameMap, ox: number, oy: number, dx: number, dy: number): TravelMode {
  const d = Math.abs(ox - dx) + Math.abs(oy - dy);
  if (d <= WALK_RANGE) return TravelMode.Walk;
  for (const mode of MODE_CHOICE_ORDER) {
    if (mode === TravelMode.Bike) {
      // A medium leg cycles (you can bike a street); bike-friendly infra just makes it faster/nicer
      // via the routing cost. So cyclists appear from the start and grow as the player calms streets.
      if (d <= BIKE_RANGE) return TravelMode.Bike;
      continue;
    }
    // rail / streetcar / drive: available when their network serves BOTH ends of the leg.
    if (infraNear(map, ox, oy, mode) && infraNear(map, dx, dy, mode)) return mode;
  }
  return TravelMode.Walk;
}

/** A citizen's OWNED vehicle: the persistent parked Car it walks to and drives. Returns the existing
 *  one (by carId), or lazily spawns one parked on a road by the citizen's current spot. Null if there
 *  is no drivable tile nearby (land-locked) → the caller walks the leg instead. The car is `owned`
 *  (the car filter never auto-moves or despawns it — its owner manages it), so it never vanishes
 *  while its owner is away on foot. */
function ensureOwnedCar(state: AmbientState, p: Ped, map: GameMap): Car | null {
  if (p.carId !== undefined) {
    const existing = findCar(state, p.carId);
    if (existing) return existing;
  }
  const start = nearestDriveStart(map, Math.round(p.x), Math.round(p.y));
  if (!start) return null;
  const id = (state.nextCarId = (state.nextCarId ?? 0) + 1);
  const car: Car = {
    x: start.x,
    y: start.y,
    dir: 0,
    tx: start.x,
    ty: start.y,
    parked: true,
    owned: true,
    id,
    dwell: PARK_MAX_WAIT,
    tint: (Math.imul((map.idx(start.x, start.y) + 1) ^ id, 0x9e3779b1) >>> 0) % 0x10000,
  };
  for (let d = 0; d < 4; d++) {
    const nx = start.x + DIR_DX[d]!;
    const ny = start.y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny) || !carTraversable(map.built[map.idx(nx, ny)]!)) {
      car.curbDir = d;
      break;
    }
  }
  state.cars.push(car);
  p.carId = id;
  return car;
}

/** A free, available parking spot (a drivable tile not already holding a parked car) near (x, y) —
 *  where a citizen-car drives to and parks before its owner walks the last mile. Null if none. */
/** The nearest TILE of the nearest parking lot within PARK_RADIUS of (x, y), or null. The route
 *  target for a parking citizen — so owned cars head to the lot EDGE nearest their destination (and
 *  then fill the nearest stalls) rather than driving to a distant centre or skipping big lots whose
 *  centre is out of range. */
function nearestLotCenter(state: AmbientState, x: number, y: number): { x: number; y: number } | null {
  const lots = state.parkingLots;
  if (!lots || lots.length === 0) return null;
  let best = -1;
  let bestD = PARK_RADIUS * PARK_RADIUS;
  for (let i = 0; i < lots.length; i++) {
    const d = lotBboxDist2(lots[i]!, x, y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const lot = lots[best]!;
  return {
    x: Math.round(x < lot.x0 ? lot.x0 : x > lot.x1 ? lot.x1 : x),
    y: Math.round(y < lot.y0 ? lot.y0 : y > lot.y1 ? lot.y1 : y),
  };
}

function findParkingNear(state: AmbientState, map: GameMap, x: number, y: number): { x: number; y: number } | null {
  // Head for a lot if one is near (cars fill the stalls); otherwise a street curb.
  return nearestLotCenter(state, x, y) ?? findCurbSpot(state, map, x, y);
}

/**
 * Park an owned car when its drive ends: pull into a FREE lot stall if a lot is in reach (so lots
 * fill to capacity, not one car each), else a street curb. Stays OWNED so it persists until its
 * owner returns. The stall path mirrors the trip-car convention (x = stall.x - 0.5; renderer draws
 * the centre on the stall) and records lotIdx/stallIdx so findLotStall counts it.
 */
export function parkOwnedCarSomewhere(state: AmbientState, map: GameMap, car: Car): void {
  const stall = findLotStall(state, Math.round(car.x), Math.round(car.y));
  if (stall) {
    car.lotIdx = stall.lotIdx;
    car.stallIdx = stall.stallIdx;
    car.x = stall.x - 0.5;
    car.y = stall.y - 0.5;
    car.tx = car.x;
    car.ty = car.y;
    car.curbDir = undefined;
    car.parked = true;
    car.recent = undefined;
    return;
  }
  const spot = findCurbSpot(state, map, Math.round(car.x), Math.round(car.y));
  if (spot) {
    parkOwnedCar(car, map, spot);
    return;
  }
  // No free, non-freeway, dry kerb anywhere in reach → the car LEAVES rather than freezing on the
  // freeway tile its route ended on (Maddy: cars parking on freeways). Its owner finishes on foot.
  const i = state.cars.indexOf(car);
  if (i >= 0) state.cars.splice(i, 1);
}

/** Park an owned car at `spot` (a drivable tile), recording the kerb side, and keep it OWNED so it
 *  persists at rest until its owner returns to it. */
function parkOwnedCar(car: Car, map: GameMap, spot: { x: number; y: number }): void {
  car.x = spot.x;
  car.y = spot.y;
  car.tx = spot.x;
  car.ty = spot.y;
  car.lotIdx = undefined;
  car.stallIdx = undefined;
  car.curbDir = undefined;
  for (let d = 0; d < 4; d++) {
    const nx = spot.x + DIR_DX[d]!;
    const ny = spot.y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny) || !carTraversable(map.built[map.idx(nx, ny)]!)) {
      car.curbDir = d;
      break;
    }
  }
  car.parked = true;
  car.recent = undefined;
}

/** When a citizen's round ends (it gets home, gives up, or is lost), retire its owned car: demote
 *  it to a plain lingering parked car (no longer owned) so it sits a moment then leaves on its dwell
 *  — "the car is put away" — rather than vanishing the instant its owner does. */
function retireOwnedCar(state: AmbientState, p: Ped, map: GameMap): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  if (car && car.owned) {
    if (isParkable(map, Math.round(car.x), Math.round(car.y))) {
      car.owned = false;
      car.parked = true; // on a valid kerb → it lingers a beat ("put away"), then clears on its dwell
      car.dwell = RETIRED_CAR_LINGER;
    } else {
      // Mid-drive on a freeway / over water when its owner is lost → it drives off rather than
      // freezing parked on the freeway (Maddy: cars parking on freeways), no lingering wreck.
      const i = state.cars.indexOf(car);
      if (i >= 0) state.cars.splice(i, 1);
    }
  }
  p.carId = undefined;
}

/**
 * Send a departed citizen's OWNED car HOME: warp it to a parking spot near `homeTile` and leave it
 * parked there (unowned, lingering on its dwell like any put-away car), rather than vanishing it on
 * the spot where the ped stood. So when a citizen is sent home (gives up / is taken off the street),
 * its car FOLLOWS it home instead of despawning where it disappeared (Maddy: "if the ped legitimately
 * gets sent home the car should warp to park near their home too"). Falls back to removing the car
 * only when home has no reachable parking, so it never strands a frozen wreck mid-map. Releases the
 * ped→car link. No-op if the ped owns no car. No rng (live layer; determinism untouched).
 */
export function sendOwnedCarHome(state: AmbientState, map: GameMap, p: Ped, homeTile: number): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  p.carId = undefined;
  if (!car || !car.owned) return;
  const hx = homeTile % map.width;
  const hy = (homeTile - hx) / map.width;
  const spot = findParkingNear(state, map, hx, hy);
  if (spot) {
    parkOwnedCar(car, map, spot); // warp it home and park
    car.owned = false; // a put-away car now — clears on its dwell, isn't kept alive as "owned"
    car.dwell = RETIRED_CAR_LINGER;
  } else {
    const i = state.cars.indexOf(car); // nowhere to park near home → remove rather than strand it
    if (i >= 0) state.cars.splice(i, 1);
  }
}

/** The nearest EMPTY tile (open land, unbuilt, non-water — {@link isWearable}) to (x, y) within
 *  `maxR`, by Chebyshev ring; null if none in reach. Where a derelict gets dumped. */
function nearestEmptyTile(map: GameMap, x: number, y: number, maxR = 10): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWearable(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/**
 * ABANDON an arrested citizen's owned car: the citizen is removed from the game, so the car is left a
 * DERELICT on a nearby EMPTY tile (Maddy: "their cars should become abandoned in an empty tile
 * somewhere") — NOT driven home (no one to drive it). It then rusts into ground pollution and
 * despawns ({@link degradeAbandonedCar}). Falls back to abandoning it in place if no empty tile is in
 * reach. Releases the ped→car link; no-op if the ped owns no car. No rng (live layer).
 */
export function abandonOwnedCar(state: AmbientState, map: GameMap, p: Ped): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  p.carId = undefined;
  if (!car || !car.owned) return;
  const spot = nearestEmptyTile(map, Math.round(car.x), Math.round(car.y));
  if (spot) {
    car.x = spot.x;
    car.y = spot.y;
    car.tx = spot.x;
    car.ty = spot.y;
  }
  car.lotIdx = undefined;
  car.stallIdx = undefined;
  car.curbDir = undefined;
  car.recent = undefined;
  car.path = undefined;
  car.leg = undefined;
  car.owned = false;
  car.parked = true;
  car.abandoned = true; // a derelict — degrades into ground pollution then rusts away
  car.dwell = ABANDONED_DEGRADE_TIME;
}

/** Advance one abandoned derelict: leak ground pollution into its tile (the wreck rusting into the
 *  land — a lingering, reparable contaminated patch) and tick its degrade clock. Returns false when
 *  it has fully rusted away (the caller despawns it; the contamination it laid remains). */
export function degradeAbandonedCar(state: AmbientState, map: GameMap, c: Car): boolean {
  layField(state.groundPollution, map.idx(Math.round(c.x), Math.round(c.y)), ABANDONED_GROUND_POLL, GROUND_POLL_MAX);
  c.dwell = (c.dwell ?? 0) - 1;
  return c.dwell > 0;
}

/** Set up a DRIVE leg toward `dest`: the citizen walks to its owned car ('to-vehicle'), drives it to
 *  an available parking spot near `dest` ('driving' → park), then walks the last mile to `dest`
 *  (`finalWalk`). Returns false if it can't get a car (land-locked) so the caller walks instead.
 *  The car is a distinct persistent entity — walked to, parked, never morphed into the rider. */
function setDriveLeg(
  state: AmbientState,
  p: Ped,
  map: GameMap,
  dest: { x: number; y: number },
  finalWalk: 'to-building' | 'to-home',
): boolean {
  const car = ensureOwnedCar(state, p, map);
  if (!car) return false;
  p.phase = 'to-vehicle';
  p.walkTo = { x: Math.round(car.x), y: Math.round(car.y) };
  p.parkAt = findParkingNear(state, map, dest.x, dest.y) ?? { x: dest.x, y: dest.y };
  p.mode = TravelMode.Walk; // walking to the car
  p.building = finalWalk === 'to-building' ? { x: dest.x, y: dest.y } : undefined;
  p.homeDest = finalWalk === 'to-home' ? { x: dest.x, y: dest.y } : undefined;
  p.roadSteps = undefined;
  p.wornSteps = undefined;
  return true;
}

/** The nearest tile a citizen's car can REST at + drive from near its home (a non-freeway, dry
 *  street/avenue/parking kerb), or null if the home has no such tile in reach. Uses isParkable so an
 *  owned car never spawns parked on the freeway a home happens to sit beside (Maddy: cars on freeways)
 *  — if only a freeway is near, the citizen walks instead. */
function nearestDriveStart(map: GameMap, hx: number, hy: number): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  for (let y = hy - 4; y <= hy + 4; y++) {
    for (let x = hx - 4; x <= hx + 4; x++) {
      if (!map.inBounds(x, y)) continue;
      if (!isParkable(map, x, y)) continue;
      const d = Math.abs(x - hx) + Math.abs(y - hy);
      if (d < bestD) {
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** Advance one flock by one boids substep (cohesion + alignment + separation). */
function advanceFlock(f: Flock): void {
  const n = f.birds.length;
  if (n === 0) return;
  let cx = 0;
  let cy = 0;
  let avx = 0;
  let avy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
    avx += b.vx;
    avy += b.vy;
  }
  cx /= n;
  cy /= n;
  avx /= n;
  avy /= n;
  for (const b of f.birds) {
    let ax = (cx - b.x) * BIRD_COHESION + (avx - b.vx) * BIRD_ALIGN;
    let ay = (cy - b.y) * BIRD_COHESION + (avy - b.vy) * BIRD_ALIGN;
    for (const o of f.birds) {
      if (o === b) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < BIRD_SEP_RADIUS2) {
        const d = Math.sqrt(d2);
        ax += (dx / d) * (BIRD_SEPARATION / d);
        ay += (dy / d) * (BIRD_SEPARATION / d);
      }
    }
    b.vx += ax;
    b.vy += ay;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > BIRD_MAX_SPEED) {
      b.vx = (b.vx / sp) * BIRD_MAX_SPEED;
      b.vy = (b.vy / sp) * BIRD_MAX_SPEED;
    }
    b.x += b.vx;
    b.y += b.vy;
  }
}

// --- Spawning ------------------------------------------------------------

/** A fresh random in-bounds tile (2 rng draws). */
function sampleTile(map: GameMap, rng: Rng): { x: number; y: number } {
  return { x: rng.nextInt(map.width), y: rng.nextInt(map.height) };
}

/**
 * Spawn trip-cars from the sim's published origin→destination trips: cars ARE trips. Each
 * car follows its committed `path` leg by leg and despawns on arrival. Called once per
 * traffic cadence with that cadence's found trips; capped at CAR_CAP. Renderer-side and
 * deterministic — the paths come from the (deterministic) sim; the animation draws no rng.
 * `trips` is structural ({ path }) so this module stays decoupled from the traffic layer.
 */
export function ingestTrips(
  state: AmbientState,
  trips: ReadonlyArray<{ path: readonly number[] }>,
  map: GameMap,
): void {
  let moving = 0; // parked cars are stored, not traffic — cap only the moving ones
  for (const c of state.cars) if (!c.parked) moving++;
  for (const trip of trips) {
    if (trip.path.length < 2) continue; // need at least one leg to travel
    const p0 = trip.path[0]!;
    const p1 = trip.path[1]!;
    const x0 = p0 % map.width;
    const y0 = (p0 - x0) / map.width;
    const x1 = p1 % map.width;
    const y1 = (p1 - x1) / map.width;
    const dir = x1 > x0 ? 1 : x1 < x0 ? 3 : y1 > y0 ? 2 : 0;
    // A trip that leaves a residential plot is a CITIZEN (others are freight). Tag its home so
    // the destination's wellbeing is deposited there.
    const home = residentialHome(map, p0);

    // MODE CHOICE: a citizen on a SHORT trip whose route doesn't need a FREEWAY walks the whole
    // way (a pedestrian routes it); longer trips, freeway trips, and all freight drive. (A
    // freeway is impassable on foot, so a cross-freeway trip must drive — otherwise its walker
    // would dead-end at the freeway edge and vanish.) As destinations come closer / streets
    // calm, more trips fall under WALK_RANGE → people shift out of cars.
    const usesFreeway = trip.path.some((t) => map.built[t]! === BuiltKind.RoadHighway);
    if (home >= 0 && trip.path.length <= WALK_RANGE && !usesFreeway) {
      if (state.peds.length >= PED_CAP) continue; // walkers are full this cadence
      const destPlot = zonedNeighbor(map, trip.path[trip.path.length - 1]!);
      if (destPlot >= 0) {
        const dpx = destPlot % map.width;
        const dpy = (destPlot - dpx) / map.width;
        state.peds.push({
          x: x0,
          y: y0,
          dir,
          tx: x0,
          ty: y0,
          walkTo: { x: dpx, y: dpy },
          phase: 'to-building',
          homeTile: home,
          building: { x: dpx, y: dpy },
        });
        continue; // walked — no car
      }
      // no destination plot to aim at → fall through and drive
    }

    if (moving >= CAR_CAP) continue;
    // Colour bound to the car: a spread hash of (origin, next) so neighbouring trips differ.
    // imul/xor are integer-exact (allowlist-safe); the renderer maps it mod its palette.
    const tint = (Math.imul(p0 ^ p1, 0x9e3779b1) >>> 0) % 0x10000;
    state.cars.push({
      x: x0,
      y: y0,
      dir,
      tx: x1,
      ty: y1,
      path: trip.path,
      leg: 2,
      tint,
      homeTile: home >= 0 ? home : undefined,
    });
    moving++;
  }
}

/** A trip-car's next-leg picker (the `pickNext` for advanceMover): head to the next tile
 *  on the committed path, advancing the leg cursor; -1 when the path is exhausted (the car
 *  has arrived → despawn). Path tiles are adjacent, so the heading is their delta. */
function pathStep(map: GameMap, car: Mover, x: number, y: number): number {
  const path = car.path!;
  const leg = car.leg!;
  if (leg >= path.length) return -1;
  const next = path[leg]!;
  const nx = next % map.width;
  const ny = (next - nx) / map.width;
  car.leg = leg + 1;
  if (nx > x) return 1;
  if (nx < x) return 3;
  if (ny > y) return 2;
  if (ny < y) return 0;
  return -1; // non-adjacent (shouldn't happen on a committed path) → despawn
}

function spawnPeds(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.peds.length >= PED_CAP) return;
    const { x, y } = sampleTile(map, rng);
    if (!isPedSubstrate(map, x, y)) continue;
    const dir = nextPedStep(map, x, y, -1, rng);
    if (dir < 0) continue;
    state.peds.push({ x, y, dir, tx: x + DIR_DX[dir]!, ty: y + DIR_DY[dir]! });
  }
}

/** How many daily-itinerary citizens are out right now — counting both active travellers (peds with
 *  an itinerary) and DRIVERS (citizen-cars with an itinerary), so the population cap covers both. */
function citizenCount(state: AmbientState): number {
  let n = 0;
  for (const p of state.peds) if (p.itinerary !== undefined) n++;
  return n;
}

/** A residential building's occupancy CEILING (pure decision seam): its seeded baseline lifted by a
 *  per-kind headroom — a single house barely densifies, an apartment block holds far more. So a
 *  thriving home fills up toward this without the building itself changing (the deterministic stock
 *  is fixed); a derelict (zero baseline) holds nobody. */
export function capacityOf(kind: number, baseCount: number): number {
  return baseCount * (OCC_HEADROOM.get(kind) ?? 1.5);
}

/** The pull on a home's population (pure): land value above OCC_LV_NEUTRAL attracts residents, below
 *  it sheds them; nearby smog repels; the wellbeing its citizens carry home (building health) tips it
 *  either way. Sign drives grow vs shrink, magnitude scales the rate. */
export function occupancySignal(landValue: number, pollution: number, health: number): number {
  let s = (landValue - OCC_LV_NEUTRAL) / 255; // land value is the anchor
  s -= (pollution / POLL_MAX) * OCC_POLL_W; // smog pushes out
  const h = health / OCC_HEALTH_SCALE; // building health is only a small bounded nudge
  s += h < -OCC_HEALTH_CAP ? -OCC_HEALTH_CAP : h > OCC_HEALTH_CAP ? OCC_HEALTH_CAP : h;
  return s;
}

/** One occupancy drift step (pure): nudge toward the ceiling on a positive signal, toward the floor on
 *  a negative one, clamped to [floor, capacity]. The floor keeps a struggling home populated — a city
 *  thins but never becomes a literal ghost town. */
export function occupancyStep(occ: number, floor: number, capacity: number, signal: number): number {
  const next = occ + signal * OCC_RATE;
  return next < floor ? floor : next > capacity ? capacity : next;
}

/** How many citizens to keep out on their round, from the live total occupancy: a THIRD of the
 *  residents (Maddy), scaling with the city — no flat ceiling, so a populous city fills the streets
 *  and a declining one visibly empties them. The hard perf ceiling is PED_CAP, applied where peds
 *  actually spawn (spawnCitizens), not here. */
export function spawnTargetFor(totalOccupancy: number): number {
  return Math.round(totalOccupancy / CITIZEN_OUT_DIVISOR);
}

/** The LIVE sample values the inspector appends to its readout — each undefined when the tile
 *  carries no such field (a road has traffic/smog but no population; a home the reverse). */
export interface LiveSamples {
  occupancy?: number;
  landValue?: number;
  health?: number;
  traffic?: number;
  pollution?: number;
  water?: number;
  road?: number;
  violence?: number;
  /** Fire/health service: true = covered, false = under-served. Omitted when not applicable. */
  served?: boolean;
}

/**
 * Format the live-layer samples for the inspect readout — `pop 12 · land value 64 · traffic 30 ·
 * smog 8`, in a fixed order, omitting any field the tile doesn't carry. Returns '' when nothing is
 * present (so the host appends nothing). Pure: rounds for display, reads only its argument.
 */
export function liveInspectLine(s: LiveSamples): string {
  const parts: string[] = [];
  if (s.occupancy !== undefined) parts.push(`pop ${Math.round(s.occupancy)}`);
  if (s.landValue !== undefined) parts.push(`land value ${Math.round(s.landValue)}`);
  if (s.health !== undefined) parts.push(`health ${Math.round(s.health)}`);
  if (s.traffic !== undefined) parts.push(`traffic ${Math.round(s.traffic)}`);
  if (s.pollution !== undefined) parts.push(`smog ${Math.round(s.pollution)}`);
  if (s.water !== undefined) parts.push(`water ${Math.round(s.water)} contaminated`);
  if (s.road !== undefined) parts.push(`road ${Math.round(s.road)} crumbling`);
  if (s.violence !== undefined) parts.push(`police violence ${Math.round(s.violence)}`);
  if (s.served !== undefined) parts.push(s.served ? 'served' : 'under-served');
  return parts.join(' · ');
}

/** Re-evaluate every home's occupancy from the live conditions at its tile (land value, smog, the
 *  wellbeing its citizens bring home), drifting it toward capacity or empty. Seeded lazily from the
 *  census baseline; rebuilt fresh over the current homes each pass so a demolished home drops out.
 *  Gated to OCC_CADENCE by the caller. Live layer — reads the other live fields, writes only occupancy. */
export function stepOccupancy(state: AmbientState, map: GameMap): void {
  const homes = state.households;
  if (!homes || homes.length === 0) {
    state.occupancy.clear();
    return;
  }
  const next = new Map<number, number>();
  for (const h of homes) {
    const t = map.idx(h.x, h.y);
    const cap = capacityOf(map.built[t]!, h.count);
    const floor = h.count * OCC_FLOOR; // a home never thins below this fraction of its seeded baseline
    const cur = state.occupancy.get(t) ?? h.count; // seed lazily at the census baseline
    const signal = occupancySignal(
      sampleField(state.landValue, t),
      sampleField(state.pollution, t),
      state.buildingHealth.get(t) ?? 0,
    );
    next.set(t, occupancyStep(cur, floor, cap, signal));
  }
  state.occupancy = next;
}

/** Top the daily-itinerary population up from the LIVE occupancy: the spawn target tracks total
 *  occupancy (a declining city empties its streets), and a home is picked weighted by its occupancy
 *  (a fuller home sends proportionally more people out, an emptied one none). Occupancy is seeded
 *  lazily from the census baseline, so before the first occupancy pass this matches the old
 *  density-weighting. Each leg the ped picks its own mode (walk/bike/transit/drive); a drive leg
 *  makes it walk to its OWNED car, drive, park, and walk on. Census citizens are PRIMARY. */
function spawnCitizens(state: AmbientState, map: GameMap, rng: Rng): void {
  const homes = state.households;
  if (!homes || homes.length === 0) return;
  const occAt = (h: Household): number => state.occupancy.get(map.idx(h.x, h.y)) ?? h.count;
  let total = 0;
  for (const h of homes) total += occAt(h);
  if (total <= 0) return;
  const target = spawnTargetFor(total);
  for (let s = 0; s < CITIZEN_SPAWN_PER_SUBSTEP; s++) {
    if (citizenCount(state) >= target) return;
    // Occupancy-weighted pick: a home with more residents is proportionally likelier to send one out.
    let r = rng.next() * total;
    let home = homes[0]!;
    for (const cand of homes) {
      r -= occAt(cand);
      if (r < 0) {
        home = cand;
        break;
      }
    }
    // Stand the citizen on a walkable tile beside its home plot (the plot itself isn't walkable).
    let sx = -1;
    let sy = -1;
    for (let d = 0; d < 4; d++) {
      const nx = home.x + DIR_DX[d]!;
      const ny = home.y + DIR_DY[d]!;
      if (isWalkable(map, nx, ny)) {
        sx = nx;
        sy = ny;
        break;
      }
    }
    if (sx < 0) continue; // a hemmed-in home, nowhere to step out
    const ped: Ped = {
      x: sx,
      y: sy,
      dir: 0,
      tx: sx,
      ty: sy,
      homeTile: map.idx(home.x, home.y),
      itinerary: DAILY_ITINERARY,
      itinStep: -1, // advanceItinerary sets the first stop (step 0 = Work)
    };
    if (advanceItinerary(state, ped, map)) state.peds.push(ped); // dropped if the district has no stops
  }
}

/** The free stall NEAREST (x, y) to park in: among lots whose bounding box is within PARK_RADIUS,
 *  the nearest free stall to (x, y) — so a big block fills tile-by-tile from the side a car arrives
 *  at (not row-major from a far corner), and a big lot is reachable from its EDGE, not only its
 *  centre (Maddy: big lot blocks held one car each). Null if no lot has a free stall in reach. */
function findLotStall(
  state: AmbientState,
  x: number,
  y: number,
): { lotIdx: number; stallIdx: number; x: number; y: number } | null {
  const lots = state.parkingLots;
  if (!lots || lots.length === 0) return null;
  // Stalls already taken, grouped by lot — one pass over the cars rather than a scan per stall.
  const taken = new Map<number, Set<number>>();
  for (const o of state.cars) {
    if (o.parked && o.lotIdx !== undefined) {
      let s = taken.get(o.lotIdx);
      if (!s) taken.set(o.lotIdx, (s = new Set<number>()));
      s.add(o.stallIdx!);
    }
  }
  let best: { lotIdx: number; stallIdx: number; x: number; y: number } | null = null;
  let bestD = PARK_RADIUS * PARK_RADIUS;
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i]!;
    if (lotBboxDist2(lot, x, y) > bestD) continue; // no stall here can beat the best found
    const t = taken.get(i);
    for (let s = 0; s < lot.stalls.length; s++) {
      if (t && t.has(s)) continue;
      const dx = lot.stalls[s]!.x - x;
      const dy = lot.stalls[s]!.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { lotIdx: i, stallIdx: s, x: lot.stalls[s]!.x, y: lot.stalls[s]!.y };
      }
    }
  }
  return best;
}

/** The nearest free curb (drivable tile NOT already holding a parked car) by ring search
 *  outward from (ax, ay), capped at CURB_RADIUS. Crowding (near curbs taken) pushes the
 *  result farther out, so the pedestrian walks farther. Returns tile coords, or null. */
function findCurbSpot(
  state: AmbientState,
  map: GameMap,
  ax: number,
  ay: number,
): { x: number; y: number } | null {
  const occupied = new Set<number>();
  for (const o of state.cars) if (o.parked) occupied.add(map.idx(Math.round(o.x), Math.round(o.y)));
  for (let r = 0; r <= CURB_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev distance r
        const x = ax + dx;
        const y = ay + dy;
        if (!isParkable(map, x, y)) continue; // no parking on a freeway or over water (a bridge)
        if (occupied.has(map.idx(x, y))) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** Park a trip-car that has reached the end of its path. It pulls into the nearest free lot
 *  stall, or — when none is free — to the nearest free street curb (so cars no longer vanish
 *  at their destination). Then it gets a bound pedestrian that walks to the building, dwells,
 *  and returns. Returns true if parked (always, unless truly nowhere to stop → despawn). */
function tryPark(state: AmbientState, c: Car, map: GameMap): boolean {
  const ax = Math.round(c.x);
  const ay = Math.round(c.y);
  // A citizen-car knows the exact plot it drove to; a sim/freight car deposits at the nearest one.
  const building = c.building ?? nearestDemandTile(map, ax, ay);
  const lot = findLotStall(state, c.x, c.y);
  if (lot) {
    c.lotIdx = lot.lotIdx;
    c.stallIdx = lot.stallIdx;
    c.x = lot.x - 0.5; // tile-corner; renderer draws the centre (+0.5) on the stall
    c.y = lot.y - 0.5;
  } else {
    const curb = findCurbSpot(state, map, ax, ay);
    if (!curb) return false; // nowhere at all (rare) → despawn
    c.lotIdx = undefined; // street-parked (drawn at the curb)
    c.stallIdx = undefined;
    c.x = curb.x;
    c.y = curb.y;
    // Record which side the kerb is on (first non-road neighbour) so the renderer draws the
    // car pulled over to it, not sitting on the lane centre of a 1-wide street.
    c.curbDir = undefined;
    for (let d = 0; d < 4; d++) {
      const nx = curb.x + DIR_DX[d]!;
      const ny = curb.y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny) || !carTraversable(map.built[map.idx(nx, ny)]!)) {
        c.curbDir = d;
        break;
      }
    }
  }
  c.parked = true;
  c.path = undefined;
  c.leg = undefined;
  c.dwell = PARK_MAX_WAIT;
  c.id = state.nextCarId = (state.nextCarId ?? 0) + 1;
  if (building) {
    // The citizen reached its destination plot → carry that plot's wellbeing home now. The
    // bound ped below is the VISIBLE visit; the deposit is not gated on it spawning (the ped
    // cap must never silently starve the health signal).
    if (c.homeTile !== undefined) depositVisit(state, c.homeTile, building, map);
    spawnBoundPed(state, c, building);
  }
  return true;
}

/** Spawn the pedestrian bound to a just-parked car: it starts at the car and walks to the
 *  destination building (the car→building leg). It later returns to the SAME car (by id) and
 *  releases it. No building nearby ⇒ no ped (the car will leave on its safety timeout). */
function spawnBoundPed(state: AmbientState, c: Car, building: { x: number; y: number }): void {
  if (state.peds.length >= PED_CAP) return;
  // Start on the car's TILE (rounded): a lot-parked car sits at a fractional stall position,
  // but the Manhattan router walks integer tiles, so the ped steps off from the tile centre.
  const sx = Math.round(c.x);
  const sy = Math.round(c.y);
  state.peds.push({
    x: sx,
    y: sy,
    dir: 0,
    tx: sx,
    ty: sy,
    walkTo: { x: building.x, y: building.y },
    carId: c.id,
    phase: 'to-building',
    building: { x: building.x, y: building.y },
  });
}

/** Find a (parked) car by its id, so a returning pedestrian can rebind to it. */
function findCar(state: AmbientState, id: number): Car | undefined {
  return state.cars.find((c) => c.id === id);
}

/** The residential building tile 4-adjacent to a trip's origin road (its home), or -1 if the
 *  origin doesn't front a home — i.e. a non-residential (freight) trip. */
function residentialHome(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) === ZoneType.Residential) return t;
  }
  return -1;
}

/** Any zoned (R/C/I/Civic) building tile 4-adjacent to a road — the destination PLOT a trip's
 *  end road fronts, or -1 if none. Used to aim a walking citizen at the plot it's visiting. */
function zonedNeighbor(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) !== ZoneType.None) return t;
  }
  return -1;
}

/** Add `value` (signed) to a home building's health, clamped. */
/** A driving car lays live traffic at the tile under it — the agent-driven traffic field (cars ARE
 *  the traffic). Other cars' pathfinding routes around it; pedestrians shun it. */
function layTraffic(state: AmbientState, map: GameMap, x: number, y: number): void {
  layField(state.traffic, map.idx(x, y), TRAFFIC_LAY, TRAFFIC_MAX);
}

/** How much air pollution a car emits at the tile under it this substep (pure decision seam): a base
 *  amount on a surface road, doubled on a freeway (faster, heavier flow), plus up to POLL_CONGEST
 *  more scaled by how jammed the tile is (`congestion` 0..1 = local traffic / TRAFFIC_MAX) — idling
 *  in a jam smogs the most. The car IS the source; the macro smog pattern emerges from the agents. */
export function pollutionEmit(onFreeway: boolean, congestion: number): number {
  return POLL_LAY_BASE * (onFreeway ? POLL_FREEWAY_MULT : 1) + congestion * POLL_CONGEST;
}

/** A driving car lays live air pollution at the tile under it, scaled by freeway/congestion via
 *  pollutionEmit. Peds shun it (pedCost) and it drags land value down — the agent-driven air layer. */
function layPollution(state: AmbientState, map: GameMap, x: number, y: number, onFreeway: boolean): void {
  const i = map.idx(x, y);
  const congestion = sampleField(state.traffic, i) / TRAFFIC_MAX;
  layField(state.pollution, i, pollutionEmit(onFreeway, congestion), POLL_MAX);
}

/** A plot tile's DERIVED land value (0..LV_MAX, pure decision seam): the healed land it sits on +
 *  a bonus per adjacent amenity green, MINUS the live nuisances under/over it (air pollution, traffic
 *  congestion, trampled-ground decay). The live fields are optional so the contract is unit-testable
 *  in isolation; absent ⇒ no nuisance. This is the readout the city's desirability emerges from. */
export function landValueAt(
  map: GameMap,
  x: number,
  y: number,
  pollution?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  wear?: ReadonlyMap<number, number>,
  water?: ReadonlyMap<number, number>,
  road?: ReadonlyMap<number, number>,
  coverage?: ReadonlySet<number>,
): number {
  const i = map.idx(x, y);
  let v = LV_BASE + (map.floraVitality[i]! / 255) * LV_FLORA + (map.faunaPresence[i]! / 255) * LV_FAUNA;
  // Under-served: an inhabited plot with no fire/health station in reach is a real drag.
  if (coverage && !coverage.has(i)) v -= LV_COVERAGE_PEN;
  // Amenities and nuisances are felt over a RADIUS, not just on the plot tile — a building's smog and
  // congestion come from the ROADS beside it, and a park lifts a whole block. Amenities sum (with a
  // linear falloff: more greens near = nicer); nuisances take the worst nearby (one jammed/smoggy road
  // is enough to drag a plot down).
  let amenity = 0;
  let pollNear = 0;
  let trafNear = 0;
  let wearNear = 0;
  let waterNear = 0;
  let roadNear = 0;
  for (let dy = -LV_RADIUS; dy <= LV_RADIUS; dy++) {
    for (let dx = -LV_RADIUS; dx <= LV_RADIUS; dx++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > LV_RADIUS) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      const falloff = 1 - dist / (LV_RADIUS + 1); // 1 on the tile → ~0 at the edge of the radius
      if (AMENITY_KINDS.has(map.built[ni]!)) amenity += falloff;
      // Nuisances felt by distance: the worst weighted road nearby sets the drag (one jam is enough).
      if (pollution) pollNear = Math.max(pollNear, sampleField(pollution, ni) * falloff);
      if (traffic) trafNear = Math.max(trafNear, sampleField(traffic, ni) * falloff);
      if (wear) wearNear = Math.max(wearNear, sampleField(wear, ni) * falloff);
      // The contaminated creek on the banks: the worst nearby water pollution drags the plot.
      if (water) waterNear = Math.max(waterNear, sampleField(water, ni) * falloff);
      // Crumbling road frontage drags the plot (disinvested infrastructure).
      if (road) roadNear = Math.max(roadNear, sampleField(road, ni) * falloff);
    }
  }
  v += amenity * LV_AMENITY;
  v -= (pollNear / POLL_MAX) * LV_POLL_PEN;
  v -= (trafNear / TRAFFIC_MAX) * LV_TRAFFIC_PEN;
  v -= (wearNear / WEAR_MAX) * LV_WEAR_PEN;
  v -= (waterNear / WATER_POLL_MAX) * LV_WATER_PEN;
  v -= (roadNear / ROAD_DECAY_MAX) * LV_ROAD_PEN;
  return v < 0 ? 0 : v > LV_MAX ? LV_MAX : v;
}

/** Recompute the land-value field over every inhabited PLOT tile (zoneTypeOf !== None), reading the
 *  current live nuisance fields. Rebuilt fresh each pass (cleared first) so a demolished plot drops
 *  out. Whole-map scan — gated to LV_CADENCE by the caller (a slow, cheap readout). */
export function recomputeLandValue(state: AmbientState, map: GameMap): void {
  state.landValue.clear();
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (zoneTypeOf(map.built[i]!) === ZoneType.None) continue; // only inhabited plots carry a value
      state.landValue.set(
        i,
        landValueAt(
          map, x, y, state.pollution, state.traffic, state.wear, state.waterPollution, state.roadDecay, state.coverage,
        ),
      );
    }
  }
}

function depositHealth(state: AmbientState, homeTile: number, value: number): void {
  if (value === 0) return;
  const cur = state.buildingHealth.get(homeTile) ?? 0;
  state.buildingHealth.set(homeTile, Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, cur + value)));
}

/** Deposit the wellbeing a citizen carries home from visiting `plot` into its home building's
 *  health, less any `penalty` (e.g. an unpleasant road walk). Called when a citizen completes
 *  its visit (a driver on park-arrival, a walker on getting home). */
function depositVisit(
  state: AmbientState,
  homeTile: number,
  plot: { x: number; y: number },
  map: GameMap,
  penalty = 0,
): void {
  depositHealth(state, homeTile, visitValue(map.built[map.idx(plot.x, plot.y)]!) - penalty);
}

/** A walk citizen whose trip can't complete (its destination is unreachable, OR the way home is
 *  blocked too) isn't annihilated in the field: the household persists, so the citizen RESPAWNS at
 *  home — snapped to a walkable spot beside its home plot, trip state cleared so it rejoins the
 *  neighbourhood — and the home takes the FAILED_TRIP_PENALTY for the wasted trip. A bound or
 *  homeless ped (no `homeTile`) has nowhere to respawn, so it despawns (its car releases on its own
 *  timeout). Returns true if it respawned (keep the sprite), false if it should despawn. */
function respawnAtHome(state: AmbientState, p: Ped, map: GameMap): boolean {
  if (p.homeTile === undefined) {
    retireOwnedCar(state, p, map); // even a homeless/bound ped's owned car (if any) must be retired
    return false;
  }
  sendOwnedCarHome(state, map, p, p.homeTile); // its car FOLLOWS it home (warps to park near home)
  depositHealth(state, p.homeTile, -FAILED_TRIP_PENALTY);
  const hx = p.homeTile % map.width;
  const hy = (p.homeTile - hx) / map.width;
  // Stand just outside the home plot — on an orthogonally adjacent walkable tile (the plot itself
  // isn't walkable). A coastal/boxed home may have no walkable orthogonal neighbour, so fall back to
  // the nearest walkable tile (a wider search) rather than landing the ped on the plot or on water.
  let sx = hx;
  let sy = hy;
  let found = false;
  for (let d = 0; d < 4; d++) {
    const nx = hx + DIR_DX[d]!;
    const ny = hy + DIR_DY[d]!;
    if (isWalkable(map, nx, ny)) {
      sx = nx;
      sy = ny;
      found = true;
      break;
    }
  }
  if (!found) {
    const w = nearestWalkable(map, hx, hy);
    if (w) {
      sx = w.x;
      sy = w.y;
    }
  }
  p.x = sx;
  p.y = sy;
  p.tx = sx;
  p.ty = sy;
  p.walkTo = undefined;
  p.phase = undefined;
  p.building = undefined;
  p.carId = undefined;
  p.fuel = undefined;
  p.recent = undefined;
  p.path = undefined; // the committed foot route is invalid after a reposition
  p.leg = undefined;
  p.pathGoal = undefined;
  p.roadSteps = undefined;
  p.wornSteps = undefined;
  p.itinerary = undefined; // a lost citizen's round ends; it rejoins the neighbourhood at home
  p.itinStep = undefined;
  p.mode = undefined;
  p.parkAt = undefined;
  p.homeDest = undefined;
  return true;
}

function spawnFlocks(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.birds.length >= FLOCK_CAP) return;
    const { x, y } = sampleTile(map, rng);
    if (!birdSpawnAt(map, x, y)) continue;
    const size = FLOCK_MIN + rng.nextInt(FLOCK_MAX - FLOCK_MIN + 1);
    const birds: Bird[] = [];
    for (let i = 0; i < size; i++) {
      birds.push({
        x: x + (rng.next() - 0.5),
        y: y + (rng.next() - 0.5),
        vx: (rng.next() - 0.5) * BIRD_MAX_SPEED,
        vy: (rng.next() - 0.5) * BIRD_MAX_SPEED,
      });
    }
    state.birds.push({ birds });
  }
}

// --- The substep + the public stepper ------------------------------------

/** A car-passable road tile adjacent to (x, y), or -1. */
function adjacentRoad(map: GameMap, x: number, y: number): number {
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (map.inBounds(nx, ny) && carPassable(map, nx, ny)) return map.idx(nx, ny);
  }
  return -1;
}

/**
 * Spawn police cruisers out of the precincts (≈ one per 2x2 precinct, capped) until the patrol
 * count is met. Each spawns on a road beside a precinct and patrols from there. The precincts sit
 * in the redlined districts, so the patrols concentrate there — the over-policing made visible.
 * Renderer-side; reads the built layer, writes only state.cruisers.
 */
export function spawnCruisers(state: AmbientState, map: GameMap, rng: Rng): void {
  const precincts: number[] = [];
  for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.Precinct) precincts.push(i);
  if (precincts.length === 0) return;
  const target = Math.min(CRUISER_CAP, Math.ceil(precincts.length / 4)); // ≈ one per 2x2 precinct
  let guard = precincts.length;
  while (state.cruisers.length < target && guard-- > 0) {
    const pi = precincts[rng.nextInt(precincts.length)]!;
    const px = pi % map.width;
    const py = (pi - px) / map.width;
    const road = adjacentRoad(map, px, py);
    if (road < 0) continue;
    const rx = road % map.width;
    const ry = (road - rx) / map.width;
    // Spread personalities across the fleet (direct / ambush / shy) so the patrol reads varied.
    state.cruisers.push({
      x: rx, y: ry, dir: rng.nextInt(4), tx: rx, ty: ry, dwell: CRUISER_LIFE, recent: [],
      personality: state.cruisers.length % 3,
    });
  }
}

/** The nearest on-foot citizen to (x, y) within HUNT_RADIUS, or null. */
function nearestPed(peds: readonly Ped[], x: number, y: number): Ped | null {
  let best = HUNT_RADIUS + 1;
  let found: Ped | null = null;
  for (const p of peds) {
    if (p.phase === 'inside' || p.phase === 'driving') continue; // not on the street
    const d = Math.abs(Math.round(p.x) - x) + Math.abs(Math.round(p.y) - y);
    if (d < best) {
      best = d;
      found = p;
    }
  }
  return found;
}

/**
 * The tile a cruiser aims for this step, by its ghost PERSONALITY (or null → patrol/seek grade):
 *   0 direct (Blinky)  — the citizen's tile;
 *   1 ambush (Pinky)   — AMBUSH_LEAD tiles AHEAD of the citizen's heading, to cut them off;
 *   2 shy (Clyde)      — the citizen's tile ONLY when within SHY_RADIUS, else null (it patrols).
 * Deterministic; reads the nearest on-foot citizen.
 */
export function huntTarget(c: Mover, peds: readonly Ped[]): { x: number; y: number } | null {
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  const p = nearestPed(peds, cx, cy);
  if (!p) return null;
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  const pers = c.personality ?? 0;
  if (pers === 1) return { x: px + DIR_DX[p.dir]! * AMBUSH_LEAD, y: py + DIR_DY[p.dir]! * AMBUSH_LEAD };
  if (pers === 2) return Math.abs(px - cx) + Math.abs(py - cy) <= SHY_RADIUS ? { x: px, y: py } : null;
  return { x: px, y: py };
}

/**
 * Deliberate cruiser patrol (replaces the old random wander): among the passable, non-reversing,
 * non-recent road neighbours, pick the one that (a) closes on the nearest on-foot citizen if one
 * is within HUNT_RADIUS — the cruiser HUNTS — else (b) climbs toward more redlined ground (higher
 * grade), so patrols seek the redlined streets instead of drifting into greenlined ones. A small
 * rng jitter breaks ties. Returns the reverse on a dead-end, or -1 when boxed in (caller despawns).
 * Deterministic in `rng`.
 */
export function nextPatrolStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  recent: readonly number[] | undefined,
  target: { x: number; y: number } | null,
  safe?: ReadonlySet<number>,
): number {
  const options: number[] = [];
  let uTurn = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny) || !carPassable(map, nx, ny)) continue;
    if (safe?.has(map.idx(nx, ny))) continue; // community refuge — cruisers won't enter it
    if (d === fromDir) {
      uTurn = d;
      continue;
    }
    options.push(d);
  }
  if (options.length === 0) return uTurn; // dead-end: reverse, or -1 if truly isolated
  let pool = options;
  if (recent && recent.length > 0) {
    const fresh = options.filter((d) => !recent.includes(map.idx(x + DIR_DX[d]!, y + DIR_DY[d]!)));
    if (fresh.length === 0) return -1; // boxed in by its own path → despawn
    pool = fresh;
  }
  let bestDir = pool[0]!;
  let bestScore = -Infinity;
  for (const d of pool) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    // Hunt: distance to the citizen dominates (×10). Else seek the redline grade. +jitter tiebreak.
    const score = target
      ? -(Math.abs(nx - target.x) + Math.abs(ny - target.y)) * 10 + rng.nextInt(3)
      : map.redline[map.idx(nx, ny)]! + rng.nextInt(3);
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }
  return bestDir;
}

/**
 * Move every cruiser one substep: a DELIBERATE patrol (hunt nearby citizens, else seek redlined
 * streets — see nextPatrolStep), despawning if its road was bulldozed or it boxes itself in, and
 * counting down its patrol life so the fleet recirculates from the precincts. Renderer-side;
 * deterministic in `rng`.
 */
export function stepCruisers(state: AmbientState, map: GameMap, rng: Rng, safe?: ReadonlySet<number>): void {
  const chasing = policePhase(state.policeTick) === 'chase';
  state.cruisers = state.cruisers.filter((c) => {
    if ((c.dwell ?? 0) <= 0) return false; // shift over → recycle (respawn tops up from the precinct)
    c.dwell! -= 1;
    if (!carPassable(map, Math.round(c.x), Math.round(c.y))) return false; // road gone
    // Chase → aim per the cruiser's ghost personality; scatter → no target, so it seeks redlined streets.
    const target = chasing ? huntTarget(c, state.peds) : null;
    return advanceMover(c, CAR_SPEED, map, (x, y, fromDir, recent) =>
      nextPatrolStep(map, x, y, fromDir, rng, recent, target, safe),
    );
  });
}

/**
 * Arrest sweep: each cruiser may seize the nearest on-foot citizen within ARREST_RADIUS — removing
 * them from the street AND draining a person from their household's occupancy — with a probability
 * that SCALES WITH the redline grade under the cruiser (arrestChance: 0 at greenlined, max at fully
 * redlined). For nothing: no cause, only the grade. The player ends it by defunding the precinct
 * (no precinct → no cruisers → no arrests). Renderer-side; deterministic in `rng`.
 */
export function stepArrests(state: AmbientState, map: GameMap, rng: Rng, safe?: ReadonlySet<number>): void {
  if (state.cruisers.length === 0 || state.peds.length === 0) return;
  for (const c of state.cruisers) {
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    if (!map.inBounds(cx, cy)) continue;
    if (safe?.has(map.idx(cx, cy))) continue; // no arrests inside a community refuge
    // Arrest pressure scales with how redlined the ground is (0 at greenlined) — no threshold.
    if (!rng.chance(arrestChance(map.redline[map.idx(cx, cy)]!))) continue;
    // Nearest on-foot citizen within reach (riders/indoors aren't on the street).
    let victim = -1;
    let best = ARREST_RADIUS + 1;
    for (let i = 0; i < state.peds.length; i++) {
      const p = state.peds[i]!;
      if (p.phase === 'inside' || p.phase === 'driving') continue;
      const d = Math.abs(Math.round(p.x) - cx) + Math.abs(Math.round(p.y) - cy);
      if (d < best) {
        best = d;
        victim = i;
      }
    }
    if (victim < 0) continue;
    const taken = state.peds[victim]!;
    if (taken.homeTile !== undefined) {
      const cur = state.occupancy.get(taken.homeTile);
      if (cur !== undefined) state.occupancy.set(taken.homeTile, Math.max(0, cur - ARREST_DRAIN));
      depositHealth(state, taken.homeTile, -ARREST_TRAUMA); // the trauma craters the household's wellbeing
    }
    // The taken citizen is removed from the game, so their car is ABANDONED where they were seized —
    // a derelict dumped on an empty tile that rusts into ground pollution (not driven home).
    abandonOwnedCar(state, map, taken);
    // Stain the spot — the police-violence record (the anti-crime-map) builds where arrests fall.
    layField(state.policeViolence, map.idx(Math.round(taken.x), Math.round(taken.y)), POLICE_VIOLENCE_LAY, POLICE_VIOLENCE_MAX);
    state.peds.splice(victim, 1); // taken off the street, for nothing
  }
}

/**
 * A pedestrian is despawned when its substrate vanished — UNLESS it's a last-mile walker (a `walkTo`
 * is set; it crosses lots/roads off-grid and self-despawns on arrival) or a hidden DRIVER (`phase
 * 'driving'`; it rides inside its car, off the ped network by design). The driving exemption is
 * EXPLICIT by phase so it can't break if the stale `walkTo` left over from boarding is ever cleared.
 */
export function pedDespawns(map: GameMap, p: Ped): boolean {
  return p.phase !== 'driving' && p.walkTo === undefined && pedOffNetwork(map, p);
}

function substep(state: AmbientState, map: GameMap, rng: Rng): void {
  // 1. Despawn anything whose substrate vanished (read-only self-healing). See pedDespawns for the
  //    exemptions (last-mile walkers + hidden drivers).
  state.cars = state.cars.filter((c) => !carOffNetwork(map, c));
  state.peds = state.peds.filter((p) => !pedDespawns(map, p));
  for (const f of state.birds) {
    const t = flockTile(map, f);
    if (!birdSpawnAt(map, t.x, t.y)) f.birds.pop();
  }
  state.birds = state.birds.filter((f) => f.birds.length > 0);

  // 2. Spawn the daily-itinerary CITIZENS (the primary walkers — from the residential census),
  //    then top up with ambient wanderers and bird flocks. Cars are NOT spawned here — they are
  //    the sim's O-D trips, ingested via ingestTrips on the traffic cadence (cars=trips).
  //    Last-mile walkers spawn on a car PARKING (see tryPark → spawnParkPed), not here.
  spawnCitizens(state, map, rng);
  spawnPeds(state, map, rng);
  spawnFlocks(state, map, rng);
  spawnCruisers(state, map, rng); // top the patrol fleet up from the precincts

  // 3. Move the cars. A PARKED car waits for its pedestrian (its bound ped zeroes `dwell` on
  //    return; the countdown is just a safety release). A moving trip-car follows its path
  //    and, on arrival, PARKS (a lot stall, or a street curb if none) — it no longer vanishes
  //    at the destination. A path-less car (a test fixture) falls back to the grid wander.
  state.cars = state.cars.filter((c) => {
    // An ABANDONED derelict (its citizen was arrested) sits on its empty tile rusting into ground
    // pollution, then despawns — the toxic legacy left behind, not driven anywhere.
    if (c.abandoned) return degradeAbandonedCar(state, map, c);
    // An OWNED citizen-car is managed entirely by its owner ped (it walks to it, drives it, parks
    // it, retires it). The filter never moves, dwells, or despawns it — so it never vanishes while
    // its owner is away on foot. (Demoted to a plain parked car when the owner's round ends.)
    if (c.owned) return true;
    if (c.parked) {
      c.dwell! -= 1;
      return c.dwell! > 0;
    }
    // A freeway moves traffic twice as fast as a surface street.
    const onFreeway = map.built[map.idx(Math.round(c.x), Math.round(c.y))] === BuiltKind.RoadHighway;
    const sp = onFreeway ? CAR_SPEED * 2 : CAR_SPEED;
    if (c.path !== undefined) {
      const alive = advanceMover(c, sp, map, (x, y) => pathStep(map, c, x, y));
      return alive ? true : tryPark(state, c, map);
    }
    return advanceMover(c, sp, map, (x, y, fromDir, recent) =>
      nextRoadStep(map, x, y, fromDir, rng, recent),
    );
  });

  // 3a. Police: advance the scatter/chase clock, move the cruisers (hunt in chase, patrol in
  //     scatter), and run the arrest sweep ONLY during a chase — the streets pulse between calm
  //     and active sweeps (the ghost cadence).
  state.policeTick += 1;
  // Community safe-zones the cruisers avoid + never sweep (built fresh only when there ARE cruisers).
  const safe = state.cruisers.length > 0 ? buildSafeZones(map) : undefined;
  stepCruisers(state, map, rng, safe);
  state.arrestTick += 1;
  if (state.arrestTick % ARREST_CADENCE === 0 && policePhase(state.policeTick) === 'chase') {
    stepArrests(state, map, rng, safe);
  }

  // 3b. Move the pedestrians. A walk target (walkTo) is reached by a MANHATTAN walk — an
  //     axis-aligned, tile-by-tile route over walkable tiles (never diagonally, never through
  //     a plot). A BOUND ped (carId) runs its car→building→inside→car machine, releasing its
  //     car on return. Others wander on ped substrate.
  state.peds = state.peds.filter((p) => {
    // Self-heal the substrate invariant: a visible ped must stand on the walkable set. If it was
    // placed off it (open water, a freeway, a plot — a degenerate spawn/park), snap it back onto
    // the nearest solid tile, or respawn home if it's truly stranded. Riders ('driving') and peds
    // 'inside' a building are hidden and exempt. (Maddy: pedestrians crossing water / freeways.)
    if (
      p.phase !== 'driving' &&
      p.phase !== 'inside' &&
      !isWalkable(map, Math.round(p.x), Math.round(p.y))
    ) {
      const w = nearestWalkable(map, Math.round(p.x), Math.round(p.y));
      if (w === null) return respawnAtHome(state, p, map);
      p.x = w.x;
      p.y = w.y;
      p.tx = w.x;
      p.ty = w.y;
      p.recent = undefined;
    }
    if (p.phase === 'inside') {
      p.dwellInside! -= 1;
      if (p.dwellInside! > 0) return true;
      if (p.itinerary !== undefined) {
        // A CITIZEN on a daily round: go to the next stop (each leg picks its own mode), or head home.
        if (!advanceItinerary(state, p, map)) {
          const hx = p.homeTile! % map.width;
          const hy = (p.homeTile! - hx) / map.width;
          // If it has an owned car out, drive home to retrieve + park it; otherwise walk home.
          const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
          if (!(car && setDriveLeg(state, p, map, { x: hx, y: hy }, 'to-home'))) {
            p.phase = 'to-home';
            p.walkTo = { x: hx, y: hy };
            p.building = undefined; // stops banked on arrival; the home leg carries nothing extra
            p.mode = TravelMode.Walk;
          }
        }
      } else if (p.carId !== undefined) {
        // A sim/freight last-mile ped: walk back to its parked car and release it.
        const car = findCar(state, p.carId);
        if (!car) return false; // its car already left → the ped vanishes too
        p.phase = 'to-car';
        p.walkTo = { x: car.x, y: car.y };
      } else {
        // A single-stop sim walk citizen: head home, carrying the visit's wellbeing.
        const hx = p.homeTile! % map.width;
        const hy = (p.homeTile! - hx) / map.width;
        p.phase = 'to-home';
        p.walkTo = { x: hx, y: hy };
      }
      p.tx = Math.round(p.x); // recommit the Manhattan route from here toward the destination
      p.ty = Math.round(p.y);
      p.recent = undefined;
      return true;
    }

    if (p.phase === 'driving') {
      // The citizen rides its owned car along a COMMITTED least-cost route (set at boarding — no
      // greedy circling), fast on freeways, laying live traffic as it goes (which other cars route
      // around). On arrival it PARKS in a free, non-freeway spot and the citizen walks the last mile.
      const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
      if (!car || car.path === undefined) {
        p.phase = p.homeDest ? 'to-home' : 'to-building'; // lost the car / no route → finish on foot
        p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
        p.mode = TravelMode.Walk;
        p.tx = Math.round(p.x);
        p.ty = Math.round(p.y);
        p.recent = undefined;
        return true;
      }
      const onFreeway = map.built[map.idx(Math.round(car.x), Math.round(car.y))] === BuiltKind.RoadHighway;
      const sp = onFreeway ? CAR_SPEED * 2 : CAR_SPEED; // freeways move traffic twice as fast
      const moving = advanceMover(car, sp, map, (x, y) => pathStep(map, car, x, y));
      layTraffic(state, map, Math.round(car.x), Math.round(car.y)); // the car IS the traffic
      layPollution(state, map, Math.round(car.x), Math.round(car.y), onFreeway); // ...and the smog
      p.x = car.x; // ride along (hidden)
      p.y = car.y;
      if (moving) return true;
      // route done → pull into a free lot stall (lots fill up), else a street curb; then walk the last mile.
      parkOwnedCarSomewhere(state, map, car);
      car.path = undefined;
      car.leg = undefined;
      p.x = car.x;
      p.y = car.y;
      p.phase = p.homeDest ? 'to-home' : 'to-building';
      p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
      p.mode = TravelMode.Walk;
      p.tx = Math.round(p.x);
      p.ty = Math.round(p.y);
      p.recent = undefined;
      p.fuel = undefined; // fresh walking leg
      return true;
    }
    if (p.walkTo !== undefined) {
      const tgtx = Math.round(p.walkTo.x);
      const tgty = Math.round(p.walkTo.y);
      // FUEL: a persistent tank, spent per substep by the terrain underfoot (beaten paths cheap,
      //   lush ground dear) and refilled at plots. A citizen chasing an UNREACHABLE destination loops
      //   without closing the distance and burns out — catching limit cycles longer than `recent`.
      //   On burnout it turns back home on a limp-home reserve (losing some wellbeing); if it's
      //   ALREADY heading home (or has no home), it respawns at home / despawns.
      p.fuel ??= FUEL_TANK;
      p.fuel -= fuelBurn(map, state.wear, Math.round(p.x), Math.round(p.y));
      if (p.fuel <= 0) {
        if (p.carId === undefined && p.phase === 'to-building' && p.homeTile !== undefined) {
          const hx = p.homeTile % map.width;
          const hy = (p.homeTile - hx) / map.width;
          p.phase = 'to-home';
          p.walkTo = { x: hx, y: hy };
          p.building = undefined; // never visited the plot → carries no visit value, just the give-up cost
          p.tx = Math.round(p.x); // recommit the route home from here
          p.ty = Math.round(p.y);
          p.recent = undefined;
          p.fuel = FUEL_LIMP_HOME; // a reserve to drag itself home (not a full tank)
          p.mode = TravelMode.Walk; // exhausted → limp home on foot
          depositHealth(state, p.homeTile, -GIVE_UP_PENALTY);
          return true;
        }
        return respawnAtHome(state, p, map); // couldn't even get home → respawn there (or despawn if homeless)
      }
      // The travel MODE sets the route (which tiles, which it hugs) and the speed (fast on its
      // network — a tram on its line, a driver on roads — slower walking to/from a stop).
      const mode = p.mode ?? TravelMode.Walk;
      const hereKind = map.built[map.idx(Math.round(p.x), Math.round(p.y))]!;
      const speed = PED_SPEED * modeSpeedMult(mode, hereKind);
      let moving: boolean;
      if (mode === TravelMode.Walk) {
        // Walking legs follow a COMMITTED least-cost foot route (walkPath), so a citizen routes
        // AROUND buildings/freeways instead of dithering in a greedy local minimum at a wall (the bug
        // Maddy saw: peds piling up at a lot + drifting home "to nowhere" when the destination sat
        // behind a barrier). Recompute only when the destination (walkTo) changes; reuse otherwise.
        const goalIdx = map.idx(tgtx, tgty);
        if (p.path === undefined || p.pathGoal !== goalIdx) {
          const route = walkPath(
            map, Math.round(p.x), Math.round(p.y), tgtx, tgty, state.wear, state.traffic, state.pollution,
          );
          if (route && route.length >= 2) {
            const p0x = route[0]! % map.width;
            const p0y = (route[0]! - p0x) / map.width;
            const p1x = route[1]! % map.width;
            const p1y = (route[1]! - p1x) / map.width;
            p.x = p0x; // snap onto the route start (the rounded tile it already stands on)
            p.y = p0y;
            p.tx = p1x;
            p.ty = p1y;
            p.dir = p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0;
            p.path = route;
            p.leg = 2; // route[0]=start, route[1]=committed next; pathStep targets route[2] onward
            p.pathGoal = goalIdx;
          } else {
            p.path = undefined; // already at the door (len 1) or no foot route → arrival/give-up below
            p.pathGoal = undefined;
          }
        }
        moving = p.path !== undefined && advanceMover(p, speed, map, (x, y) => pathStep(map, p, x, y));
      } else {
        // Bike/transit legs hug their OWN network via the greedy mode-cost step (walkPath's pedCost
        // doesn't know a tram line; a rider must prefer its rails). Dithering is rare on open lines.
        moving = advanceMover(p, speed, map, (x, y, _fromDir, recent) =>
          nextStepToward(map, x, y, tgtx, tgty, recent, state.wear, mode, state.traffic, state.pollution),
        );
      }
      if (moving) return true; // still walking this leg
      // The leg ended (arrived within a tile, or no route) — drop the committed path so the NEXT leg
      // (a new stop / heading home) recomputes a fresh route.
      p.path = undefined;
      p.leg = undefined;
      p.pathGoal = undefined;
      // advanceMover stopped: arrived (within a tile of the target) or boxed in.
      const arrived = Math.abs(Math.round(p.x) - tgtx) + Math.abs(Math.round(p.y) - tgty) <= 1;
      if (!arrived) {
        // pathing went nowhere (e.g. boxed in, or dead-ended at a freeway) — the citizen gives up.
        // A homed citizen respawns at home (the household persists) and home loses wellbeing for the
        // lost trip; a bound/homeless ped despawns (a bound car releases on its safety timeout).
        return respawnAtHome(state, p, map);
      }
      if (p.phase === 'to-vehicle') {
        // Reached its OWNED car → plan a COMMITTED least-cost route to a free parking spot near the
        // destination, then drive it. (The car was parked, waiting; it never vanished.) If no road
        // route exists, finish the leg on foot.
        const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
        const dest = p.building ?? p.homeDest;
        const spot = car && dest ? findParkingNear(state, map, dest.x, dest.y) ?? dest : undefined;
        const path =
          car && spot
            ? roadPath(map, Math.round(car.x), Math.round(car.y), spot.x, spot.y, state.traffic)
            : null;
        if (!car || !path || path.length < 2) {
          p.phase = p.homeDest ? 'to-home' : 'to-building';
          p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
          p.mode = TravelMode.Walk;
          p.tx = Math.round(p.x);
          p.ty = Math.round(p.y);
          p.recent = undefined;
          return true;
        }
        // Board: snap onto the route's first tile and commit to following it (cars=committed paths).
        const p0x = path[0]! % map.width;
        const p0y = (path[0]! - p0x) / map.width;
        const p1x = path[1]! % map.width;
        const p1y = (path[1]! - p1x) / map.width;
        car.x = p0x;
        car.y = p0y;
        car.tx = p1x;
        car.ty = p1y;
        car.dir = p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0;
        car.path = path;
        car.leg = 2; // path[0]=start, path[1]=the committed next tile; pathStep targets path[2] next
        car.parked = false;
        car.recent = undefined;
        p.parkAt = spot;
        p.phase = 'driving';
        return true;
      }
      if (p.phase === 'to-building') {
        p.phase = 'inside';
        p.dwellInside = INSIDE_DWELL_MIN + rng.nextInt(INSIDE_DWELL_SPAN);
        if (p.building) {
          const kind = map.built[map.idx(p.building.x, p.building.y)]!;
          // A successful visit refuels the citizen by the plot's status/use (a good plot restores more).
          p.fuel = Math.min(FUEL_TANK, (p.fuel ?? 0) + refuelFor(kind));
          // A citizen on a daily round BANKS each stop's wellbeing at home as it visits (less the
          // leg's walk tolls), so its home health tracks where its people actually go. A single-stop
          // walk citizen instead deposits once on getting home (below).
          if (p.itinerary !== undefined && p.homeTile !== undefined) {
            const penalty = Math.floor(
              (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
            );
            depositVisit(state, p.homeTile, p.building, map, penalty);
          }
        }
        return true;
      }
      if (p.phase === 'to-car') {
        // A sim/freight last-mile ped got back in → release its car to leave.
        const car = findCar(state, p.carId!);
        if (car) car.dwell = 0;
        return false;
      }
      if (p.phase === 'to-home') {
        // Walked home → deposit any single-stop visit (sim walk citizens), less the road/worn tolls.
        if (p.homeTile !== undefined && p.building) {
          const penalty = Math.floor(
            (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
          );
          depositVisit(state, p.homeTile, p.building, map, penalty);
        }
        retireOwnedCar(state, p, map); // the citizen is home → its car is put away (lingers, then leaves)
        return false;
      }
      return false; // unbound routed ped → despawn on arrival
    }
    return advanceMover(p, PED_SPEED, map, (x, y, fromDir) => nextPedStep(map, x, y, fromDir, rng));
  });
  for (const f of state.birds) advanceFlock(f);

  // 4. Building health eases toward neutral so it tracks RECENT citizen visits, not all-time.
  if (state.buildingHealth.size > 0) {
    for (const [k, v] of [...state.buildingHealth]) {
      const nv = v > 0 ? v - HEALTH_DECAY : v + HEALTH_DECAY;
      if (Math.abs(nv) < HEALTH_DECAY) state.buildingHealth.delete(k);
      else state.buildingHealth.set(k, nv);
    }
  }

  // 5. Desire-path WEAR: every pedestrian on a wild-green tile beats it down a little; unused
  //    wear regrows. Cars don't count (they ride pavement) — this is foot traffic forming paths.
  for (const p of state.peds) {
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    if (isWearable(map, tx, ty)) {
      const i = map.idx(tx, ty);
      const capped = layField(state.wear, i, WEAR_RATE, WEAR_MAX);
      // A walking citizen crossing a heavily-worn (degraded, littered) path brings home less — the
      // beaten path is convenient but bleak.
      if (p.phase !== undefined && p.carId === undefined && capped >= WORN_DEGRADE_MIN) {
        p.wornSteps = (p.wornSteps ?? 0) + 1;
      }
    } else if (p.phase !== undefined && p.carId === undefined) {
      // A walking citizen trudging a road/stroad accrues the unpleasant-commute penalty.
      const k = map.built[map.idx(tx, ty)]!;
      if (k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue) p.roadSteps = (p.roadSteps ?? 0) + 1;
    }
  }
  decayField(state.wear, WEAR_DECAY);

  // 5b. Live traffic eases back where no car is passing — so the agent-driven field tracks CURRENT
  //     driving, and a calmed/bypassed road clears.
  decayField(state.traffic, TRAFFIC_DECAY);

  // 5c. Dirty power plants emit smog from their footprint plume every pass (persistent exhaust,
  //     like a parked source) — laid BEFORE the decay so a coal/gas district stays hazy while a
  //     renewable one clears. Clean plants publish no emitters.
  if (state.plantEmitters) {
    for (const e of state.plantEmitters) layField(state.pollution, e.tile, e.amount, POLL_MAX);
  }

  // 5d. Prevailing wind: on its own clock, carry the smog one tile downwind so plumes streak away
  //     from their sources (the freeway, the coal plant) across the neighbourhoods downwind, rather
  //     than only diffusing/lingering in place. Runs before the decay so the drifted haze still fades.
  state.windTick += 1;
  if (state.windTick % WIND_CADENCE === 0) driftPollution(state, map);

  // Air pollution lingers as smog and eases back slowly (slower than traffic) — so calming a
  // corridor clears its jam quickly but the haze takes longer to lift.
  decayField(state.pollution, POLL_DECAY);
  // Police-violence record fades slowly — the harm lingers far longer than smog.
  decayField(state.policeViolence, POLICE_VIOLENCE_DECAY);

  // 6. Water runoff: on a slow cadence, each coastal water tile collects pollution from the
  //    ground around it and grows heavily polluted over time (impassable, so it never wears).
  state.waterTick += 1;
  if (state.waterTick % WATER_RUNOFF_CADENCE === 0) {
    accumulateWaterRunoff(state, map);
    flowWaterPollution(state, map); // carry the contamination downstream to the banks below
    treatWaterPollution(state, map); // the player's wastewater works heals it back
  }

  // 6b. Ground contamination: on the same slow cadence, industry + dirty power + demand-path litter
  //     poison the land they sit on and the land around them — lingering, but clearing once the
  //     source is gone (the toxic legacy the player heals; the source the creeks run off from).
  state.groundTick += 1;
  if (state.groundTick % GROUND_RUNOFF_CADENCE === 0) {
    accumulateGroundPollution(state, map);
  }

  // 7. Land value: on a slow cadence, recompute each plot's desirability from the healed land +
  //    amenities minus the live nuisances. A readout over the other layers — derived, not laid.
  state.lvTick += 1;
  if (state.lvTick % LV_CADENCE === 0) {
    state.coverage = computeCoverage(map); // refresh fire/health coverage before land value reads it
    recomputeLandValue(state, map);
  }

  // 8. Population: on a slow cadence, drift each home's occupancy toward its capacity (prized/clean/
  //    healthy) or empty (decayed/smoggy). Runs AFTER land value so it reads the fresh field. The
  //    spawn target + home weighting follow this — closing the agent-emergent population loop.
  state.occTick += 1;
  if (state.occTick % OCC_CADENCE === 0) stepOccupancy(state, map);

  // 9. Road decay: on a slow infrastructure clock, redlined roads crumble while cared-for
  //    neighborhoods' roads recover. Runs after land value so it reads the fresh field.
  state.roadTick += 1;
  if (state.roadTick % ROAD_CADENCE === 0) stepRoadDecay(state, map);
}

/** One water-runoff pass: every water tile with ground neighbours collects their runoff
 *  (paved/built/worn ground sheds most), accumulating toward WATER_POLL_MAX. Open water with no
 *  ground neighbours stays clean. Whole-map scan — gated to WATER_RUNOFF_CADENCE by the caller. */
export function accumulateWaterRunoff(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.water[i] === 0) continue; // only water collects runoff
      let runoff = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] !== 0) continue; // a water neighbour sheds nothing
        const k = map.built[ni]!;
        if (zoneTypeOf(k) === ZoneType.Industrial) {
          // Industry is the toxic source; redlined industry sheds the MOST (least
          // regulated, concentrated there by policy) — scale by the tile's grade.
          // This is the Hackensack: the contamination starts at the redlined plant.
          runoff += RUNOFF_INDUSTRY * (1 + map.redline[ni]! / 255);
        } else if (isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None) {
          // Redlined built ground sheds more toxic runoff — the disinvested district
          // (no drainage, dumping, industrial legacy) poisons its own water. Grade-
          // scaled so the mechanic holds even where worldgen gutted the industry.
          runoff += RUNOFF_URBAN * (1 + map.redline[ni]! / 255);
        } else {
          runoff += RUNOFF_WILD; // wilderness is not a toxic source, regardless of grade
        }
        if ((state.wear.get(ni) ?? 0) > 40) runoff += RUNOFF_WORN;
      }
      if (runoff === 0) continue;
      layField(state.waterPollution, i, runoff, WATER_POLL_MAX);
    }
  }
}

/** Lay the LAND-contamination field: each ground tile accrues pollution from its OWN source-ness
 *  (industry + a dirty power plant sitting on it, grade-scaled), the litter/wear of demand paths
 *  that cross it, and a seep from adjacent industrial/plant tiles (the plume spreads a tile). Then
 *  the whole field decays slowly, so removing a source (bulldoze the plant, calm the path, rewild)
 *  lets the land recover — the toxic legacy is lingering but reparable. Whole-map scan; gated to
 *  GROUND_RUNOFF_CADENCE by the caller. Live/non-hashed. */
export function accumulateGroundPollution(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  const plants =
    state.plantEmitters && state.plantEmitters.length > 0
      ? new Set(state.plantEmitters.map((e) => e.tile))
      : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.water[i] !== 0) continue; // ground only — water keeps its own runoff field
      let load = 0;
      const k = map.built[i]!;
      // The tile's OWN source-ness: industry + dirty power poison the ground they stand on.
      if (zoneTypeOf(k) === ZoneType.Industrial) load += GROUND_INDUSTRY * (1 + map.redline[i]! / 255);
      if (plants && plants.has(i)) load += GROUND_PLANT;
      // Demand-path litter: the trampled, littered ground of a beaten path leaches into the soil.
      const wear = state.wear.get(i) ?? 0;
      if (wear > 0) load += (wear / WEAR_MAX) * GROUND_LITTER;
      // Seep from adjacent sources — the contamination spreads a tile into the surrounding land.
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] !== 0) continue;
        if (zoneTypeOf(map.built[ni]!) === ZoneType.Industrial) {
          load += GROUND_SEEP * (1 + map.redline[ni]! / 255);
        } else if (plants && plants.has(ni)) {
          load += GROUND_SEEP;
        }
      }
      if (load > 0) layField(state.groundPollution, i, load, GROUND_POLL_MAX);
    }
  }
  decayField(state.groundPollution, GROUND_DECAY); // lingers, but clears once the sources are gone
}

/**
 * Flow water pollution DOWNSTREAM: each polluted water tile pushes WATER_FLOW_FRACTION
 * of its load to its lower-elevation water neighbours. Processed high→low elevation so
 * contamination cascades downhill in a single pass — so a community DOWNSTREAM of the
 * redlined industry is poisoned even with no polluting neighbour of its own (the
 * Hackensack: the harm is sited upstream, borne downstream). Live/non-hashed;
 * deterministic (sorted order); integer/rational only.
 */
/** One smog-drift pass: carry WIND_FRACTION of every air-pollution tile's load ONE tile downwind
 *  (along `state.wind`), so plumes streak away from their sources instead of only diffusing in place.
 *  A conservative transfer — what leaves a tile arrives at its downwind neighbour (smog at the map
 *  edge blows off the map and leaves the system); the normal POLL_DECAY then fades the whole plume
 *  with distance/time. Air ignores substrate — it drifts over land and water alike. Departures are
 *  computed from the pre-pass values and arrivals applied AFTER the scan, so it's a clean
 *  simultaneous update (no within-pass cascade). Live/non-hashed; gated to WIND_CADENCE by the
 *  caller. */
export function driftPollution(state: AmbientState, map: GameMap): void {
  const { dx, dy } = state.wind;
  if (dx === 0 && dy === 0) return;
  if (state.pollution.size === 0) return;
  const arrivals: Array<[number, number]> = []; // (downwind tile, amount) — applied after the scan
  for (const [i, p] of state.pollution) {
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue; // blows off the map edge — leaves the system (no wrap)
    const move = p * WIND_FRACTION;
    if (move <= 0) continue;
    arrivals.push([map.idx(nx, ny), move]);
    state.pollution.set(i, p - move);
  }
  for (const [ni, amt] of arrivals) layField(state.pollution, ni, amt, POLL_MAX);
}

export function flowWaterPollution(state: AmbientState, map: GameMap): void {
  if (state.waterPollution.size === 0) return;
  const tiles = [...state.waterPollution.keys()].filter((i) => map.water[i] !== 0);
  tiles.sort((a, b) => map.elevation[b]! - map.elevation[a]! || a - b);
  for (const i of tiles) {
    const p = state.waterPollution.get(i) ?? 0;
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const e = map.elevation[i]!;
    const lower: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d]!;
      const ny = y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (map.water[ni] !== 0 && map.elevation[ni]! < e) lower.push(ni);
    }
    if (lower.length === 0) continue;
    const move = (p * WATER_FLOW_FRACTION) / lower.length;
    if (move <= 0) continue;
    for (const ni of lower) layField(state.waterPollution, ni, move, WATER_POLL_MAX);
    state.waterPollution.set(i, p - move * lower.length);
  }
}

/**
 * Step road decay: each road tile crumbles (scaled by its redline grade — redlined roads
 * crumble, greenlined stay sound) UNLESS its neighborhood is cared-for (the best adjacent plot's
 * land value is at/above ROAD_CARED_LV), in which case the pavement recovers. So the player's
 * existing healing — raising a redlined district's land value — also fixes its roads; no separate
 * repair tool. Live/non-hashed; reads land value + grade, writes only roadDecay.
 */
export function stepRoadDecay(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (!isRoadKind(map.built[i]!)) continue;
      // Local care = the best land value among the plots this road serves (4-neighbours).
      let caredLV = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        caredLV = Math.max(caredLV, state.landValue.get(map.idx(nx, ny)) ?? 0);
      }
      if (caredLV >= ROAD_CARED_LV) {
        const cur = state.roadDecay.get(i);
        if (cur === undefined) continue;
        const nv = cur - ROAD_RECOVER_RATE;
        if (nv <= 0) state.roadDecay.delete(i);
        else state.roadDecay.set(i, nv);
      } else {
        const crumble = ROAD_CRUMBLE_RATE * (map.redline[i]! / 255); // redlined crumbles, greenlined ~0
        if (crumble > 0) layField(state.roadDecay, i, crumble, ROAD_DECAY_MAX);
      }
    }
  }
}

/**
 * Reparation: a WastewaterWorks cleans contaminated water within WATER_TREAT_RADIUS,
 * strongest at the works and falling off with distance. The player's heal for the
 * poisoned creek — restore the water, restore the bankside community's land value and
 * health (the inverse of the harm). Rewilding the banks also helps implicitly (wild
 * ground sheds almost nothing). Live/non-hashed; few works, so cheap.
 */
export function treatWaterPollution(state: AmbientState, map: GameMap): void {
  if (state.waterPollution.size === 0) return;
  for (let wi = 0; wi < map.built.length; wi++) {
    if (map.built[wi] !== BuiltKind.WastewaterWorks) continue;
    const wx = wi % map.width;
    const wy = (wi - wx) / map.width;
    for (let dy = -WATER_TREAT_RADIUS; dy <= WATER_TREAT_RADIUS; dy++) {
      for (let dx = -WATER_TREAT_RADIUS; dx <= WATER_TREAT_RADIUS; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > WATER_TREAT_RADIUS) continue;
        const nx = wx + dx;
        const ny = wy + dy;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] === 0) continue;
        const cur = state.waterPollution.get(ni);
        if (cur === undefined) continue;
        const nv = cur - WATER_TREAT_AMOUNT * (1 - dist / (WATER_TREAT_RADIUS + 1));
        if (nv <= 0) state.waterPollution.delete(ni);
        else state.waterPollution.set(ni, nv);
      }
    }
  }
}

/** Number of urban (road / parking / built) tiles in the 8-neighbourhood of (x, y). */
function urbanNeighbours(map: GameMap, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const k = map.built[map.idx(nx, ny)]!;
      if (isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None) n++;
    }
  }
  return n;
}

/** Seed the live decay a century of car-culture left BEFORE the player arrives, so the city
 *  starts degraded rather than pristine: empty urban ground is already trampled brown (wear,
 *  by how hemmed-in it is) and the shorelines are already polluted (runoff). Derived from the
 *  worldgen world; the live layers evolve from here as the player heals or neglects the city. */
export function seedDecay(state: AmbientState, map: GameMap): void {
  const PLOT_SEED_RADIUS = 5; // how far a home "feels" the plots around it
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = map.built[map.idx(x, y)]!;
      // Trampled urban ground: hemmed-in empty land is already a beaten path.
      if (k === BuiltKind.None && map.water[map.idx(x, y)] === 0) {
        const urban = urbanNeighbours(map, x, y);
        if (urban >= 2) state.wear.set(map.idx(x, y), Math.min(WEAR_MAX, urban * 26));
        continue;
      }
      // Precomputed home wellbeing: a century in this environment, summed from the plots a
      // home's citizens would visit nearby (industry drags it down, commerce/civic/new-urbanist
      // lift it) — so homes START with a wellbeing reflecting where they sit, not zero.
      if (zoneTypeOf(k) === ZoneType.Residential) {
        let h = 0;
        for (let dy = -PLOT_SEED_RADIUS; dy <= PLOT_SEED_RADIUS; dy++) {
          for (let dx = -PLOT_SEED_RADIUS; dx <= PLOT_SEED_RADIUS; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!map.inBounds(nx, ny)) continue;
            h += visitValue(map.built[map.idx(nx, ny)]!);
          }
        }
        if (h !== 0) state.buildingHealth.set(map.idx(x, y), Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, h)));
      }
    }
  }
  // A century of runoff already in the water — saturate the urban shorelines.
  for (let n = 0; n < 60; n++) accumulateWaterRunoff(state, map);
}

/**
 * Advance the ambient state by `dtMs` of wall-clock time, in fixed 50ms substeps.
 * Clamps `dtMs` to AMBIENT_MAX_FRAME_MS first (so a pathological gap can never spin
 * more than AMBIENT_MAX_FRAME_MS/50 = 20 substeps and hang the frame). Writes ONLY
 * `state`; `map` is read-only.
 */
export function stepAmbient(state: AmbientState, map: GameMap, rng: Rng, dtMs: number): void {
  state.accMs += Math.min(dtMs, AMBIENT_MAX_FRAME_MS);
  while (state.accMs >= SUBSTEP_MS) {
    state.accMs -= SUBSTEP_MS;
    substep(state, map, rng);
  }
}
