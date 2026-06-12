// Ecology report: a pure, deterministic read over the seeded/ticked ecology
// layers, the sibling of the blight report. It feeds the opening's ecology stat
// line and (later) any ecology HUD. Pure module: no DOM, no rng, no transcendental
// Math (the architecture guard scans src/ecology); every divide is guarded so an
// empty ring / all-water world yields nulls and exact 0s, never NaN.
//
// The core/periphery split mirrors the blight report's highway thresholds (d≤8
// core / d≥16 periphery) but over TILE means, not parcel cohorts — ecology lives
// on tile layers, so the parcel-cohort MIN_COHORT guard would be the wrong unit
// (plan review round-2 correction). Tiles a highway cannot reach are treated as
// deep periphery (infinitely far from any corridor).

import { GameMap, Water } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { distanceField } from '../worldgen/fields';
import { biodiversityField } from './biodiversity';

const CORE_MAX = 8;
const PERIPHERY_MIN = 16;

export interface EcologyReport {
  /** City means over LAND tiles (0 when there is no land). */
  soilMean: number;
  floraMean: number;
  faunaMean: number;
  biodiversityMean: number;
  /** Corridor-ring (d≤8) soil tile-mean; null when the ring is empty. */
  coreSoilMean: number | null;
  /** Periphery-ring (d≥16 or highway-unreachable) soil tile-mean; null when empty. */
  peripherySoilMean: number | null;
  /** periphery − core soil mean (>0 ⇒ soil thinner along the corridors); null if either ring empty. */
  corridorSoilDeficit: number | null;
  /** Periphery-ring fauna tile-mean (the wild at the edges); null when the ring is empty. */
  peripheryFaunaMean: number | null;
}

export interface EcologyReportableWorld {
  map: GameMap;
}

/**
 * Build the ecology report over `world.map`. City means run over land tiles; the
 * corridor/periphery scalars run over land tiles binned by the highway distance
 * field. Every mean is divide-guarded — a ring with no tiles is null, never NaN.
 */
export function ecologyReport(world: EcologyReportableWorld): EcologyReport {
  const { map } = world;
  const n = map.width * map.height;
  const bio = biodiversityField(map);
  const highwayDist = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);

  let landN = 0;
  let soilSum = 0;
  let floraSum = 0;
  let faunaSum = 0;
  let bioSum = 0;
  let coreN = 0;
  let coreSoil = 0;
  let periN = 0;
  let periSoil = 0;
  let periFauna = 0;

  for (let i = 0; i < n; i++) {
    if (map.water[i] !== Water.None) continue;
    landN++;
    soilSum += map.soilHealth[i]!;
    floraSum += map.floraVitality[i]!;
    faunaSum += map.faunaPresence[i]!;
    bioSum += bio[i]!;

    const d = highwayDist[i]!;
    if (d >= 0 && d <= CORE_MAX) {
      coreN++;
      coreSoil += map.soilHealth[i]!;
    } else if (d < 0 || d >= PERIPHERY_MIN) {
      periN++;
      periSoil += map.soilHealth[i]!;
      periFauna += map.faunaPresence[i]!;
    }
  }

  const coreSoilMean = coreN > 0 ? coreSoil / coreN : null;
  const peripherySoilMean = periN > 0 ? periSoil / periN : null;
  const peripheryFaunaMean = periN > 0 ? periFauna / periN : null;
  const corridorSoilDeficit =
    coreSoilMean !== null && peripherySoilMean !== null ? peripherySoilMean - coreSoilMean : null;

  return {
    soilMean: landN > 0 ? soilSum / landN : 0,
    floraMean: landN > 0 ? floraSum / landN : 0,
    faunaMean: landN > 0 ? faunaSum / landN : 0,
    biodiversityMean: landN > 0 ? bioSum / landN : 0,
    coreSoilMean,
    peripherySoilMean,
    corridorSoilDeficit,
    peripheryFaunaMean,
  };
}
