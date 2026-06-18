// Parcel glyphs: the pure decision behind the SNES-style legibility letters the
// renderer stamps on each building footprint — R1/R2/R3 for residential by
// density, C/I likewise, and a short distinct glyph per civic amenity. Greens,
// parking, transport, and empty land get no glyph (they read clearly already, and
// a letter there would only clutter). No DOM, no transcendental Math — on the
// architecture pure-ui allowlist (tests/architecture.test.ts). Keeping the mapping
// here, not in the renderer shell, lets it be unit-tested rather than left to QA.

import { BuiltKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';

/** Clamp a parcel density into the 1..3 tier the glyph displays. */
function densityTier(density: number): number {
  return density < 1 ? 1 : density > 3 ? 3 : Math.floor(density);
}

// Power plants aren't an RCI zone (they stay ZoneType.None), but they still want a
// readable label — a 'P' + a generation-source letter (Coal/Gas/Hydro/Nuclear/
// Wind/Solar/Fusion). Checked before the zone switch in parcelGlyph.
const POWER_GLYPH: ReadonlyMap<number, string> = new Map<number, string>([
  [BuiltKind.CoalPlant, 'PC'],
  [BuiltKind.GasPlant, 'PG'],
  [BuiltKind.HydroPlant, 'PH'],
  [BuiltKind.NuclearPlant, 'PN'],
  [BuiltKind.WindTurbine, 'PW'],
  [BuiltKind.SolarPlant, 'PS'],
  [BuiltKind.FusionPlant, 'PF'],
]);

// Civic amenities all map to ZoneType.Civic, but the player wants to tell a
// healing commons from a power node at a glance — so each gets its own short tag.
const CIVIC_GLYPH: ReadonlyMap<number, string> = new Map<number, string>([
  [BuiltKind.Civic, '+'],
  [BuiltKind.FireStation, 'FD'],
  [BuiltKind.HealingCommons, 'H'],
  [BuiltKind.VerticalFarm, 'F'],
  [BuiltKind.WastewaterWorks, 'W'],
  [BuiltKind.EnergyNode, 'P'],
  [BuiltKind.AINode, 'AI'],
  [BuiltKind.CompostHub, 'K'],
]);

/**
 * The legibility glyph for a parcel of `kind` at `density`, or null when no glyph
 * should be drawn. Residential/Commercial/Industrial read as `R`/`C`/`I` + the
 * 1..3 density tier (so a block visibly upzones as it densifies); civic amenities
 * get a distinct short glyph (density-independent); everything else — greens,
 * parking, transport, empty — returns null. Total over BuiltKind.
 */
export function parcelGlyph(kind: BuiltKind, density: number): string | null {
  const power = POWER_GLYPH.get(kind);
  if (power) return power;
  if (kind === BuiltKind.Precinct) return 'PD'; // the apparatus of control (ZoneType.None)
  switch (zoneTypeOf(kind)) {
    case ZoneType.Residential:
      return `R${densityTier(density)}`;
    case ZoneType.Commercial:
      return `C${densityTier(density)}`;
    case ZoneType.Industrial:
      return `I${densityTier(density)}`;
    case ZoneType.Civic:
      return CIVIC_GLYPH.get(kind) ?? '+';
    default:
      return null;
  }
}
