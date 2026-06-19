// Display names for the BuiltKind taxonomy: the human-readable label for each
// kind, used by the inspector (and future tooltips/menus). A pure fact about
// BuiltKind — engine layer, DOM-free, deterministic, total via a fallback. Kept
// in lockstep with the tool labels (tools.ts BUILD_TABLE) so a thing reads the
// same in the toolbar and the inspector.

import { BuiltKind } from './fabric';

const NAME_OF: ReadonlyMap<number, string> = new Map<number, string>([
  [BuiltKind.None, 'Open land'],
  // classic transport
  [BuiltKind.RoadStreet, 'Street'],
  [BuiltKind.RoadAvenue, 'Avenue'],
  [BuiltKind.RoadHighway, 'Highway'],
  [BuiltKind.Rail, 'Rail'],
  // tech-tree transit
  [BuiltKind.BikePath, 'Bike Path'],
  [BuiltKind.Streetcar, 'Streetcar'],
  [BuiltKind.QuietStreet, 'Quiet Street'],
  [BuiltKind.ElevatedRail, 'Elevated Rail'],
  [BuiltKind.Promenade, 'Promenade'],
  [BuiltKind.PlantedMedian, 'Planted Median'],
  // Moses-era buildings
  [BuiltKind.HouseSingle, 'Single-family Home'],
  [BuiltKind.Apartments, 'Apartments'],
  [BuiltKind.Projects, 'Housing Projects'],
  [BuiltKind.CommercialStrip, 'Commercial Strip'],
  [BuiltKind.Offices, 'Offices'],
  [BuiltKind.Industrial, 'Industry'],
  [BuiltKind.ParkingLot, 'Parking Lot'],
  [BuiltKind.Civic, 'Civic Building'],
  [BuiltKind.Precinct, 'Police Precinct'],
  [BuiltKind.FireStation, 'Fire Station'],
  [BuiltKind.Clinic, 'Clinic'],
  [BuiltKind.Library, 'Library'],
  [BuiltKind.School, 'School'],
  // power plants (SC2000 tier)
  [BuiltKind.CoalPlant, 'Coal Power Plant'],
  [BuiltKind.GasPlant, 'Gas Power Plant'],
  [BuiltKind.HydroPlant, 'Hydroelectric Plant'],
  [BuiltKind.NuclearPlant, 'Nuclear Power Plant'],
  [BuiltKind.WindTurbine, 'Wind Turbine'],
  [BuiltKind.SolarPlant, 'Solar Plant'],
  [BuiltKind.FusionPlant, 'Fusion Plant'],
  // tech-era buildings
  [BuiltKind.Parklet, 'Parklet'],
  [BuiltKind.CommunityGarden, 'Community Garden'],
  [BuiltKind.CompostHub, 'Compost Hub'],
  [BuiltKind.VerticalFarm, 'Vertical Farm'],
  [BuiltKind.WastewaterWorks, 'Wastewater Works'],
  [BuiltKind.EnergyNode, 'Energy Node'],
  [BuiltKind.AINode, 'AI Node'],
  [BuiltKind.ADU, 'Accessory Dwelling'],
  [BuiltKind.CoopHousing, 'Co-op Housing'],
  [BuiltKind.Commune, 'Commune'],
  [BuiltKind.Bazaar, 'Bazaar'],
  [BuiltKind.MakerSpace, 'Maker Space'],
  [BuiltKind.HealingCommons, 'Healing Commons'],
  // rezoning greens
  [BuiltKind.Park, 'Park'],
  [BuiltKind.RewildedLand, 'Rewilded Land'],
]);

/** The display name of a built kind. Total — an unmapped code falls back to `Kind N`. */
export function builtKindName(kind: BuiltKind): string {
  return NAME_OF.get(kind) ?? `Kind ${kind}`;
}
