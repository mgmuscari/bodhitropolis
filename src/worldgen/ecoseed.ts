// Worldgen stage 3: ecology seeding.
//
// After terrain lays the land and the Moses century scars it, this stage seeds
// the three ecology layers so the player's t0 world already carries the wound —
// soil broken along the corridors, the wild pushed to the edges. Everything is a
// deterministic function of the existing map state (no rng needed): the layers
// are reproducible from (terrain, fabric) alone, so the double-run world hash is
// stable.
//
// Worldgen layer: no DOM, no transcendental Math (architecture guard scans it);
// the corridor falloff is rational (CORRIDOR_WOUND / (1 + d)), like terrain's
// moisture falloff. It writes ONLY soil/flora/fauna and appends one chronicle
// line — an automated layer-isolation test pins that.
//
// The era5 line is the durable RECORD of the wound. It is NOT the player-facing
// surface: the opening renders one headline per era (events[0]) and moses owns
// era5.events[0] (disinvestment), so this line lands at era5.events[1+], parsed
// but unshown (a regression guard pins eraHeadline(era5) unchanged). The display
// half is the report-driven ecologyStatLine (Task 5/6).

import { GameMap, Water, LandCover } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { distanceField } from './fields';
import type { WorldgenStage, WorldState } from './pipeline';

/** The durable era5 RECORD line (NOT shown in the opening — see module header). */
export const ECO_SEED_WOUND =
  'era5: the land kept the bill — soil broken along the corridors, the wild pushed to the edges';

// Seeding constants (placeholder ecology; the contract is the directional ring
// orderings + the vegetation/water rule, never these magnitudes).
const SOIL_BASE: Record<number, number> = {
  [LandCover.Forest]: 190,
  [LandCover.Grass]: 150,
  [LandCover.Meadow]: 120,
  [LandCover.Bare]: 80,
};
const SOIL_MOISTURE_GAIN = 40; // soil += floor(moisture * this)
const CORRIDOR_WOUND = 160; // soil -= floor(this / (1 + highwayDist)) — rational falloff
const INDUSTRY_WOUND = 60; // soil -= floor(this / (1 + industryDist))

const FLORA_VEG_BASE: Record<number, number> = {
  [LandCover.Forest]: 60,
  [LandCover.Grass]: 40,
  [LandCover.Meadow]: 24,
  [LandCover.Bare]: 0,
};
const FLORA_SOIL_SHIFT = 2; // flora += soil >> this (soil / 4)

const FAUNA_FLORA_SHIFT = 2; // fauna += flora >> this (flora / 4)
const FAUNA_WATER_BONUS = 15; // fauna += this per water 4-neighbour (riparian)
const FAUNA_PERIPHERY_RATE = 3; // fauna += min(highwayDist, CAP) * this
const FAUNA_PERIPHERY_CAP = 40; // distance past which the periphery bonus plateaus
const FAUNA_UNREACHABLE = 120; // periphery bonus for tiles no highway can reach

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.floor(v));

/**
 * Seed the three ecology layers from the existing map state. Water tiles get soil
 * capped low and flora/fauna 0 (open water is not habitat in v1). Land tiles draw
 * soil from (moisture, landCover) minus corridor + industry wounds, flora from
 * (landCover, soil), and fauna from (flora, water-adjacency, periphery weight).
 */
export function seedEcology(map: GameMap): void {
  const { width, height } = map;
  const highwayDist = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);
  const industryDist = distanceField(map, (i) => map.built[i] === BuiltKind.Industrial);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);

      if (map.water[i] !== Water.None) {
        map.soilHealth[i] = 0;
        map.floraVitality[i] = 0;
        map.faunaPresence[i] = 0;
        continue;
      }

      // --- Soil: landCover + moisture base, minus corridor/industry wounds.
      const lc = map.landCover[i]!;
      let soil = (SOIL_BASE[lc] ?? SOIL_BASE[LandCover.Bare]!) +
        Math.floor(map.moisture[i]! * SOIL_MOISTURE_GAIN);
      const hd = highwayDist[i]!;
      if (hd >= 0) soil -= Math.floor(CORRIDOR_WOUND / (1 + hd));
      const id = industryDist[i]!;
      if (id >= 0) soil -= Math.floor(INDUSTRY_WOUND / (1 + id));
      soil = clampByte(soil);
      map.soilHealth[i] = soil;

      // --- Flora: a vegetation floor (so vegetated land is always > 0) + soil.
      const flora = clampByte((FLORA_VEG_BASE[lc] ?? 0) + (soil >> FLORA_SOIL_SHIFT));
      map.floraVitality[i] = flora;

      // --- Fauna: flora + riparian bonus + periphery weight (far from highways).
      let waterAdj = 0;
      if (x > 0 && map.water[map.idx(x - 1, y)] !== Water.None) waterAdj++;
      if (x < width - 1 && map.water[map.idx(x + 1, y)] !== Water.None) waterAdj++;
      if (y > 0 && map.water[map.idx(x, y - 1)] !== Water.None) waterAdj++;
      if (y < height - 1 && map.water[map.idx(x, y + 1)] !== Water.None) waterAdj++;
      const periphery =
        hd < 0
          ? FAUNA_UNREACHABLE
          : (hd > FAUNA_PERIPHERY_CAP ? FAUNA_PERIPHERY_CAP : hd) * FAUNA_PERIPHERY_RATE;
      const fauna = clampByte(
        (flora >> FAUNA_FLORA_SHIFT) + FAUNA_WATER_BONUS * waterAdj + periphery,
      );
      map.faunaPresence[i] = fauna;
    }
  }
}

/**
 * The eco-seed worldgen stage: seed the ecology layers and append the durable
 * era5 wound RECORD. Deterministic in the map state alone (no rng consumed).
 */
export function ecoSeedStage(): WorldgenStage {
  return {
    name: 'eco-seed',
    apply(world: WorldState): void {
      seedEcology(world.map);
      world.log.push(ECO_SEED_WOUND);
    },
  };
}
