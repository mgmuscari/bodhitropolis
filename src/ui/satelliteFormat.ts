// The CPU↔GPU data contract for the hybrid satellite renderer (see
// docs/art/satellite-shader.md). Four bytes per world cell — the only per-frame
// bridge to the GPU:
//
//   R  tile type   SatType enum the shader switches on (procedural synthesis + atlas index)
//   G  height/band density (building floors) · road class · water class · terrain band+elevation
//   B  adjacency   8-bit transport connection mask (N=1 E=2 S=4 W=8) — exactly transportMask
//   A  sim         live scalar (traffic density today; pollution/wellbeing later)
//
// Pure and DOM-free: gridTextureBridge (the CPU writer) and satelliteShader (the
// GLSL reader) both import these so the packing is single-source. The shader's
// GLSL references the SatType numbers via string interpolation — keep this the
// one place the enum lives.
import { GameMap, Water } from '../engine/map';
import { BuiltKind, isTransportKind, transportMask, transportCategory } from '../engine/fabric';

/**
 * R-channel tile type. A small, stable enum: the shader branches on it for
 * procedural fallback synthesis and (phase 2) to index the baked-tile atlas. The
 * terrain land-cover band rides in the G channel when type === Terrain.
 */
export const SatType = {
  Terrain: 0, // bare/meadow/grass/forest — G carries band (low 2 bits) + elevation (high 6)
  Water: 1, //   G carries Water class (1 river · 2 lake · 3 ocean)
  Road: 2, //    G carries transportCategory; B carries the adjacency mask
  Residential: 3,
  Commercial: 4,
  Industrial: 5,
  Civic: 6, //   civic services + precinct/fire
  Power: 7, //   power plants + distributed generation
  Green: 8, //   parks / gardens / planted median / rewilded — the restored ground
} as const;
export type SatType = (typeof SatType)[keyof typeof SatType];

/** Bytes per cell in the packed data texture (RGBA). */
export const DATA_CHANNELS = 4;

const B = BuiltKind;

/** BuiltKind → archetype bucket for the R channel. */
export const BUILDING_TYPE: Readonly<Record<number, SatType>> = {
  [B.HouseSingle]: SatType.Residential,
  [B.Apartments]: SatType.Residential,
  [B.Projects]: SatType.Residential,
  [B.ADU]: SatType.Residential,
  [B.CoopHousing]: SatType.Residential,
  [B.Commune]: SatType.Residential,
  [B.CommercialStrip]: SatType.Commercial,
  [B.Offices]: SatType.Commercial,
  [B.ParkingLot]: SatType.Commercial,
  [B.Bazaar]: SatType.Commercial,
  [B.MakerSpace]: SatType.Commercial,
  [B.Industrial]: SatType.Industrial,
  [B.CompostHub]: SatType.Industrial,
  [B.VerticalFarm]: SatType.Industrial,
  [B.WastewaterWorks]: SatType.Industrial,
  [B.Civic]: SatType.Civic,
  [B.Precinct]: SatType.Civic,
  [B.FireStation]: SatType.Civic,
  [B.Clinic]: SatType.Civic,
  [B.Library]: SatType.Civic,
  [B.School]: SatType.Civic,
  [B.HealingCommons]: SatType.Civic,
  [B.CoalPlant]: SatType.Power,
  [B.GasPlant]: SatType.Power,
  [B.HydroPlant]: SatType.Power,
  [B.NuclearPlant]: SatType.Power,
  [B.WindTurbine]: SatType.Power,
  [B.SolarPlant]: SatType.Power,
  [B.FusionPlant]: SatType.Power,
  [B.EnergyNode]: SatType.Power,
  [B.AINode]: SatType.Power,
  [B.Parklet]: SatType.Green,
  [B.CommunityGarden]: SatType.Green,
  [B.Park]: SatType.Green,
  [B.RewildedLand]: SatType.Green,
  // PlantedMedian (11) is a transport-range kind but reads as a green amenity — handled in satTypeAt.
};

// Shadow-casting height proxy per building (0..255, G channel for non-terrain).
// Drives the single-pass raymarched drop shadows: towers loom, lots are flat.
const HEIGHT: Readonly<Record<number, number>> = {
  [B.HouseSingle]: 40,
  [B.ADU]: 28,
  [B.Apartments]: 150,
  [B.Projects]: 185,
  [B.CoopHousing]: 120,
  [B.Commune]: 110,
  [B.CommercialStrip]: 60,
  [B.Offices]: 220,
  [B.Bazaar]: 70,
  [B.MakerSpace]: 80,
  [B.ParkingLot]: 6,
  [B.Industrial]: 95,
  [B.CompostHub]: 40,
  [B.VerticalFarm]: 165,
  [B.WastewaterWorks]: 60,
  [B.Civic]: 90,
  [B.Precinct]: 80,
  [B.FireStation]: 70,
  [B.Clinic]: 90,
  [B.Library]: 80,
  [B.School]: 80,
  [B.HealingCommons]: 70,
  [B.CoalPlant]: 200,
  [B.GasPlant]: 170,
  [B.HydroPlant]: 90,
  [B.NuclearPlant]: 210,
  [B.WindTurbine]: 235,
  [B.SolarPlant]: 30,
  [B.FusionPlant]: 200,
  [B.EnergyNode]: 50,
  [B.AINode]: 120,
  [B.Parklet]: 8,
  [B.CommunityGarden]: 8,
  [B.Park]: 6,
  [B.RewildedLand]: 12,
  [B.PlantedMedian]: 6,
};

/** Shadow-casting height (0..255) for a building/green kind; 64 for anything unmapped. */
export function buildingHeight(kind: number): number {
  return HEIGHT[kind] ?? 64;
}

/** R-channel tile type at (x, y): built layer wins over water, water over terrain. */
export function satTypeAt(map: GameMap, x: number, y: number): SatType {
  const built = map.getBuilt(x, y);
  if (built !== 0) {
    if (built === B.PlantedMedian) return SatType.Green; // green amenity, not a road
    if (isTransportKind(built)) return SatType.Road;
    return BUILDING_TYPE[built] ?? SatType.Civic;
  }
  if (map.getWater(x, y) !== Water.None) return SatType.Water;
  return SatType.Terrain;
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Pack one cell's four bytes into `out` at byte offset `off`. See the channel
 * table at the top of this module. The terrain G byte folds the land-cover band
 * (low 2 bits) with quantized elevation (high 6) so the shader can both colour by
 * cover and shade by relief from one byte.
 */
export function packCell(map: GameMap, x: number, y: number, out: Uint8Array, off: number): void {
  const type = satTypeAt(map, x, y);
  out[off] = type;

  let g = 0;
  if (type === SatType.Terrain) {
    const band = map.getLandCover(x, y) & 0x3;
    const elevQ = clampByte(Math.round(map.getElevation(x, y) * 63)) & 0x3f;
    g = band | (elevQ << 2);
  } else if (type === SatType.Water) {
    g = map.getWater(x, y);
  } else if (type === SatType.Road) {
    g = transportCategory(map.getBuilt(x, y));
  } else {
    g = buildingHeight(map.getBuilt(x, y));
  }
  out[off + 1] = g & 0xff;
  out[off + 2] = transportMask(map, x, y) & 0xff; // 0 for non-transport cells
  out[off + 3] = map.traffic[map.idx(x, y)] ?? 0;
}
