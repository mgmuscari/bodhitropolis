// Blight report — these planning terms ("blight", "redevelopment", "urban renewal")
// are used CRITICALLY here, scoped to the Moses-century mode this file indicts; they
// were the euphemisms of the apparatus. A redevelopment agency's "blight finding"
// (CA Community Redevelopment Law) was the legal pretext that authorized eminent-
// domain clearance + displacement; "urban renewal" was, in James Baldwin's words,
// "Negro removal." That apparatus razed West Oakland — 7th St, the Cypress Freeway
// (I-880), the Acorn project — and Black neighborhoods across Alameda County. This is
// the deterministic read of the HARM it left: the wounds (abandonment, clearance
// craters, the core→periphery gradient) the player inherits and must AMELIORATE.
// Elsewhere the neutral condition is "decay"; the player REPAIRS / RESTORES, never
// "redevelops." These terms live ONLY where the game names the policy that weaponized
// them. The opening overlay turns this into the player's first situation briefing.
//
// Two deliberate design choices, both from plan review:
//   1. The era-5 wound counts (abandoned / craters / preEra5Standing) are
//      parsed from the era-5 chronicle line, NOT derived from the store. Store
//      derivations diverge from the prose the overlay shows beside them:
//      "alive ParkingLot" overcounts craters (era 2 places healthy parking,
//      moses.ts:599) and `count - aliveCount` overcounts abandonment (it folds
//      in era-3 corridor demolitions, moses.ts:657). All three are null when
//      there is no era-5 line (e.g. an all-water seed).
//   2. The core/periphery gradient is the survivorship-FREE abandonment share
//      (demolished / total per cohort), computable from final state because
//      demolition tombstones keep parcel geometry. Survivor-condition means are
//      descriptive display values only, NOT an asserted ordering.
//
// Worldgen layer: no DOM, no transcendental Math (architecture guard scans it);
// every divide is guarded so an empty world yields exact 0s, never NaN.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { distanceField } from './fields';

export interface BlightReport {
  parcelsTotal: number;
  parcelsAlive: number;
  /** era-5 "(of P standing)" — null if no era-5 line. */
  preEra5Standing: number | null;
  /** era-5 "A abandoned" (disinvestment only); NOT count - aliveCount. */
  abandoned: number | null;
  /** era-5 "C craters"; NOT the alive ParkingLot count (era 2 places parking). */
  craters: number | null;
  conditionMean: number;
  conditionMedian: number;
  /** alive parcels with condition < 64, as a share of alive parcels. */
  shareDerelict: number;
  /** alive parcels with condition < 128, as a share of alive parcels. */
  shareStruggling: number;
  /** alive Projects = towers STILL STANDING (diverges from the era-3 "built"
   * count once a project is abandoned); never reads as a contradiction. */
  projectsStanding: number;
  /** from the era-3 "rails removed N (peak M)" line; null if absent. */
  railLost: { removed: number; peak: number } | null;
  // Cohort means are DESCRIPTIVE (survivor condition only); the tested gradient
  // lives in the survivorship-free *AbandonedShare fields. All four are null if
  // the cohort has < 5 members.
  coreMean: number | null;
  peripheryMean: number | null;
  coreAbandonedShare: number | null;
  peripheryAbandonedShare: number | null;
  /** alive parcels per kind (sums to parcelsAlive). */
  byKind: Partial<Record<BuiltKind, number>>;
}

export interface ReportableWorld {
  map: GameMap;
  parcels: ParcelStore;
  log: readonly string[];
}

// era-5 line: `era5: disinvestment — D decayed, A abandoned, C craters (of P
// standing)` (moses.ts:1022). `.*?` crosses the decayed count and the em-dash
// without depending on their exact bytes. Groups: 1=abandoned, 2=craters,
// 3=preEra5Standing.
const ERA5_RE = /era5: disinvestment.*?(\d+) abandoned, (\d+) craters \(of (\d+) standing\)/;
// era-3 line: `era3: rails removed N (peak M)` (moses.ts:699/760). Groups:
// 1=removed, 2=peak.
const ERA3_RAILS_RE = /era3: rails removed (\d+) \(peak (\d+)\)/;

// Cohort thresholds (mirrors parcelHighwayDist in moses.test.ts:526-548).
const CORE_MAX = 8;
const PERIPHERY_MIN = 16;
const MIN_COHORT = 5;
const DERELICT_BELOW = 64;
const STRUGGLING_BELOW = 128;

function firstMatch(log: readonly string[], re: RegExp): RegExpExecArray | null {
  for (const line of log) {
    const m = re.exec(line);
    if (m) return m;
  }
  return null;
}

/**
 * Minimum highway-field distance over parcel `i`'s footprint, ignoring
 * unreachable (-1) tiles. Returns +Infinity when no footprint tile can reach a
 * highway — so a no-highway parcel is periphery-eligible (Infinity >= 16) and
 * never core (Infinity <= 8 is false). Reads geometry via get(i), which works
 * for tombstoned parcels too (markDead keeps the footprint).
 */
function parcelHighwayDistance(
  map: GameMap,
  parcels: ParcelStore,
  i: number,
  field: Int32Array,
): number {
  const e = parcels.get(i);
  let lo = Infinity;
  for (let dy = 0; dy < e.height; dy++) {
    for (let dx = 0; dx < e.width; dx++) {
      const v = field[map.idx(e.x + dx, e.y + dy)]!;
      if (v >= 0 && v < lo) lo = v;
    }
  }
  return lo;
}

/**
 * Descriptive survivor mean + survivorship-free abandonment share for one
 * cohort (a list of parcel indices spanning alive + tombstoned). Below
 * MIN_COHORT members both are null; with zero survivors the mean is null
 * (guarding the 0/0) while the abandonment share stays meaningful.
 */
function cohortFields(
  parcels: ParcelStore,
  members: number[],
): { mean: number | null; abandonedShare: number | null } {
  if (members.length < MIN_COHORT) return { mean: null, abandonedShare: null };
  let alive = 0;
  let sum = 0;
  for (const i of members) {
    if (parcels.isAlive(i)) {
      alive++;
      sum += parcels.conditionAt(i);
    }
  }
  const total = members.length;
  return {
    mean: alive > 0 ? sum / alive : null,
    abandonedShare: (total - alive) / total,
  };
}

export function buildReport(world: ReportableWorld): BlightReport {
  const { map, parcels, log } = world;
  const parcelsTotal = parcels.count();
  const parcelsAlive = parcels.aliveCount();

  // --- Chronicle-sourced (nullable) wound counts ---
  const era5 = firstMatch(log, ERA5_RE);
  const abandoned = era5 ? Number(era5[1]) : null;
  const craters = era5 ? Number(era5[2]) : null;
  const preEra5Standing = era5 ? Number(era5[3]) : null;

  const era3 = firstMatch(log, ERA3_RAILS_RE);
  const railLost = era3 ? { removed: Number(era3[1]), peak: Number(era3[2]) } : null;

  // --- Condition stats + shares over ALIVE parcels (divide guarded) ---
  const alive = parcels.aliveIndices();
  let conditionMean = 0;
  let conditionMedian = 0;
  let shareDerelict = 0;
  let shareStruggling = 0;
  if (alive.length > 0) {
    const conditions = alive.map((i) => parcels.conditionAt(i));
    const sum = conditions.reduce((a, b) => a + b, 0);
    conditionMean = sum / conditions.length;

    const sorted = [...conditions].sort((a, b) => a - b);
    const n = sorted.length;
    conditionMedian =
      n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;

    let derelict = 0;
    let struggling = 0;
    for (const c of conditions) {
      if (c < DERELICT_BELOW) derelict++;
      if (c < STRUGGLING_BELOW) struggling++;
    }
    shareDerelict = derelict / conditions.length;
    shareStruggling = struggling / conditions.length;
  }

  // --- projectsStanding + byKind over ALIVE parcels ---
  const byKind: Partial<Record<BuiltKind, number>> = {};
  let projectsStanding = 0;
  for (const i of alive) {
    const k = parcels.kindAt(i);
    byKind[k] = (byKind[k] ?? 0) + 1;
    if (k === BuiltKind.Projects) projectsStanding++;
  }

  // --- Core/periphery cohorts over the FULL store (alive + tombstoned) ---
  const highwayField = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);
  const core: number[] = [];
  const periphery: number[] = [];
  for (let i = 0; i < parcelsTotal; i++) {
    const d = parcelHighwayDistance(map, parcels, i, highwayField);
    if (d <= CORE_MAX) core.push(i);
    else if (d >= PERIPHERY_MIN) periphery.push(i);
  }
  const coreF = cohortFields(parcels, core);
  const periF = cohortFields(parcels, periphery);

  return {
    parcelsTotal,
    parcelsAlive,
    preEra5Standing,
    abandoned,
    craters,
    conditionMean,
    conditionMedian,
    shareDerelict,
    shareStruggling,
    projectsStanding,
    railLost,
    coreMean: coreF.mean,
    peripheryMean: periF.mean,
    coreAbandonedShare: coreF.abandonedShare,
    peripheryAbandonedShare: periF.abandonedShare,
    byKind,
  };
}
