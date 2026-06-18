// Civic dynamics: one deterministic per-neighborhood step over belonging, voice,
// and trust. Pure module — no DOM, no rng, no transcendental Math (the
// architecture guard scans src/civic). It reads READ-ONLY fabric (the map's nine
// layers + the parcel store) and the live partition, and writes ONLY CivicState
// (an automated isolation test pins that). Capabilities arrive as plain booleans,
// so dynamics never imports tech — the consume of hasCapability happens OUTSIDE.
//
// Read-prev / write-next: every neighborhood's deltas are computed from the
// values it entered the tick with (voice scales by the belonging it was held at,
// not the belonging it leaves with), then written once. Neighborhoods are
// independent, so an in-place per-neighborhood update is order-free.
//
// All rates/thresholds are PLACEHOLDER civic (like the effort/ecology economies):
// the tested contract is the directional invariants + the trust floor, never the
// magnitudes, which a later balancing feature will set.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { influenceOf } from '../ecology/influence';
import type { NeighborhoodMap } from './neighborhoods';
import type { CivicState } from './state';

/** The participatory capabilities civic dynamics consumes (resolved tech-side). */
export interface CivicCaps {
  circles: boolean;
  participatoryBudgeting: boolean;
  giftCircles: boolean;
}

// --- Tuning constants (directional contract only) -------------------------
const COND_THRESHOLD = 128; // neighborhood condition mean for a belonging bonus
const ECO_THRESHOLD = 96; // neighborhood eco mean (soil+flora+fauna)/3 bonus gate
const ISOLATION_FRAGMENTS = 2; // distinct perimeter fragmenting tiles ⇒ isolated
const ISOLATION_PENALTY = 2; // belonging lost per tick while isolated
const VOICE_CIRCLES = 1; // per-tick voice base from `circles`
const VOICE_PARTICIPATORY = 2; // from `participatory-budgeting`
const VOICE_GIFT = 1; // from `gift-circles`
const TRUST_GAIN = 2; // trust gained per tick with a recent repair
const TRUST_DECAY = 1; // trust lost per tick without one (slow)
/** Trust never falls below this floor — the PRD's design call, pinned. */
export const TRUST_FLOOR = 40;
// Over-policing: a precinct in a neighborhood suppresses civic voice & trust, scaled
// by how redlined it is (redlined + policed = worst). NOT a service — the player undoes
// it by DEFUNDING (convert the precinct to a Healing Commons) and by community
// alternatives (the voice caps below), which can outweigh the suppression.
const POLICE_VOICE_PEN = 3; // voice lost per tick in a fully-redlined policed neighborhood
const POLICE_TRUST_PEN = 2; // trust lost per tick in a fully-redlined policed neighborhood
const RECENT_WINDOW = 100; // a repair counts as "recent" within this many ticks

// Gathering places: a belonging bonus when ≥1 sits inside the neighborhood. Park
// is a gathering place (a green commons where the neighborhood meets), so a
// gathering→Park rezone keeps the bonus — RewildedLand stays OUT (wild, not social).
const GATHERING_KINDS = new Set<number>([
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.HealingCommons,
  BuiltKind.CommunityGarden,
  BuiltKind.Civic,
  BuiltKind.Park,
]);

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Integer belonging-band multiplier: a community speaks louder when held. */
function voiceBand(belonging: number): number {
  if (belonging < 64) return 0; // too unheld to speak
  if (belonging < 128) return 1;
  return 2;
}

/**
 * Advance the civic layers of every neighborhood by one tick. Reads the map's
 * ecology layers + parcel conditions (aggregated per neighborhood via the live
 * `partition`) and the participation `caps`; writes ONLY `civic`. The CivicState
 * must already match `partition` (same neighborhood count) — the composite
 * orchestrator refreshes/remaps the partition before calling this.
 */
export function civicTick(
  map: GameMap,
  parcels: ParcelStore,
  partition: NeighborhoodMap,
  civic: CivicState,
  caps: CivicCaps,
  tick: number,
): void {
  const { width, height } = map;
  const n = width * height;
  const count = partition.neighborhoods.length;
  if (count === 0) return;

  const t2n = partition.tileToNeighborhood;

  // --- Per-neighborhood aggregates over the live layers (one tile pass).
  const ecoSum = new Float64Array(count); // soil + flora + fauna summed
  const tileCount = new Int32Array(count);
  const condSum = new Float64Array(count);
  const condTiles = new Int32Array(count);
  const gathering = new Uint8Array(count); // 0/1: a gathering place is present
  const gradeSum = new Float64Array(count); // redline grade summed (for the policing intensity)
  const precinctTiles = new Int32Array(count); // 0+ : police presence in the neighborhood
  for (let i = 0; i < n; i++) {
    const id = t2n[i]!;
    if (id === 0 || id > count) continue;
    const k = id - 1;
    tileCount[k]!++;
    ecoSum[k]! += map.soilHealth[i]! + map.floraVitality[i]! + map.faunaPresence[i]!;
    gradeSum[k]! += map.redline[i]!;
    const pid = map.parcel[i]!;
    if (pid !== 0) {
      condSum[k]! += parcels.conditionAt(pid - 1);
      condTiles[k]!++;
      if (GATHERING_KINDS.has(map.built[i]!)) gathering[k] = 1;
      if (map.built[i]! === BuiltKind.Precinct) precinctTiles[k]!++;
    }
  }

  // --- Isolation: count DISTINCT fragmenting tiles touching each neighborhood
  // (a barrier adjacent to two member tiles of the same neighborhood counts once).
  const fragTouch = new Int32Array(count);
  for (let i = 0; i < n; i++) {
    if (!influenceOf(map.built[i]!).fragmenting) continue;
    const x = i % width;
    const y = (i - x) / width;
    // De-dup the ≤4 neighbour neighborhood ids so this barrier counts once each.
    const ids: number[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const id = t2n[ny * width + nx]!;
      if (id !== 0 && id <= count && !ids.includes(id)) ids.push(id);
    }
    for (const id of ids) fragTouch[id - 1]!++;
  }

  // --- Apply deltas per neighborhood (read-prev / write-next).
  const capBase =
    (caps.circles ? VOICE_CIRCLES : 0) +
    (caps.participatoryBudgeting ? VOICE_PARTICIPATORY : 0) +
    (caps.giftCircles ? VOICE_GIFT : 0);

  for (let k = 0; k < count; k++) {
    const id = k + 1;
    const prev = civic.getValues(id);
    const tc = tileCount[k]! || 1;
    const ecoMean = Math.floor(ecoSum[k]! / (3 * tc));
    const condMean = condTiles[k]! > 0 ? Math.floor(condSum[k]! / condTiles[k]!) : 0;
    const isolated = fragTouch[k]! >= ISOLATION_FRAGMENTS;
    // Over-policing: a precinct suppresses voice & trust, scaled by how redlined the
    // neighborhood is (redlined + policed = worst). Zero where there's no precinct.
    const policing = precinctTiles[k]! > 0 ? gradeSum[k]! / (255 * tc) : 0; // 0..1
    const policeVoice = Math.floor(policing * POLICE_VOICE_PEN);
    const policeTrust = Math.floor(policing * POLICE_TRUST_PEN);

    let bDelta = 0;
    if (condMean >= COND_THRESHOLD) bDelta += 1;
    if (gathering[k] === 1) bDelta += 1;
    if (ecoMean >= ECO_THRESHOLD) bDelta += 1;
    if (isolated) bDelta -= ISOLATION_PENALTY;
    const belonging = clampByte(prev.belonging + bDelta);

    // Voice consumes the caps (scaled by the belonging band) MINUS over-policing.
    // Community alternatives (the caps) can outweigh the suppression — that's the
    // point: organizing recovers the voice the precinct silences. Locked caps with a
    // precinct present ⇒ voice declines.
    const voice = clampByte(prev.voice + voiceBand(prev.belonging) * capBase - policeVoice);

    // Trust rises on a recent repair, slow-decays otherwise, minus over-policing,
    // floored at TRUST_FLOOR. Policing accelerates the erosion; repairs counter it.
    const ring = civic.getRing(id);
    const recentRepair = ring.length > 0 && ring[0]! >= tick - RECENT_WINDOW;
    let trust = prev.trust + (recentRepair ? TRUST_GAIN : -TRUST_DECAY) - policeTrust;
    if (trust > 255) trust = 255;
    if (trust < TRUST_FLOOR) trust = TRUST_FLOOR;

    civic.setValues(id, { belonging, voice, trust });
  }
}
