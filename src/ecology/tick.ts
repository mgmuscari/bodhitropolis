// The ecology tick: one composite, deterministic step that advances the three
// ecology layers (soil → flora → fauna) over a GameMap. Pure engine-adjacent
// module — no DOM, no rng, no transcendental Math (the architecture guard scans
// src/ecology). It reads READ-ONLY fabric (built/parcel/water) plus the three
// ecology layers, and writes ONLY the three ecology layers (an automated
// layer-isolation test pins that). Tech state is unreachable by construction:
// ecologyTick receives only the map.
//
// STRICT double buffering (plan review P3): every sub-step reads the tick-entry
// "prev" snapshot — the live layers, untouched until the very end — and writes
// into persistent module-level scratch buffers; the scratch is copied back into
// the layers only AFTER all sub-steps finish. So soil→flora→fauna couple with a
// 1-tick lag (a healed garden raises soil at T, flora responds at T+1, fauna at
// T+2), and no sub-step ever reads another's freshly-written value. The scratch
// is reused across ticks (no per-tick allocation) and fully overwritten each
// tick, so determinism holds regardless of prior contents.
//
// Rates/thresholds/caps are PLACEHOLDER ecology (like the effort economy): the
// tested contract is directional invariants + determinism, never balance.

import { GameMap, Water } from '../engine/map';
import { isTransportKind } from '../engine/fabric';
import { influenceOf, isUnsealed, RADIUS } from './influence';

const BASE_RECOVERY = 1; // soil heals toward 255 each tick on open land
const PAVED_CAP = 40; // soil ceiling on sealed tiles (paved / built / water)
const SOIL_THRESH = 128; // flora grows where PREV soil ≥ this
const FLORA_GROWTH = 2; // flora gained per tick on healthy soil
const SPREAD_MIN = 64; // a tile below this flora can gain from rich neighbours
const SPREAD_SRC = 128; // a 4-neighbour at/above this flora seeds spread
const SPREAD_GAIN = 2; // flora gained from spread
const WATER_ADJ_BONUS = 30; // fauna-habitat bonus per water 4-neighbour (riparian)
const CORRIDOR_FLOOR = 40; // fauna-habitat floor on non-fragmenting transit tiles
const FAUNA_RATE = 8; // max fauna change per tick (ease toward target)
const SPREAD_LOSS = 16; // fauna lost colonising from a richer passable neighbour

interface EcologyScratch {
  soil: Uint8Array;
  flora: Uint8Array;
  fauna: Uint8Array;
  /** Scattered per-tile influence accumulators (signed), re-zeroed each tick. */
  soilInf: Int32Array;
  floraInf: Int32Array;
}

// Module-level, lazily-(re)sized scratch reused across ticks (plan review P3d —
// no per-tick allocation; GameMap layer fields are readonly, so we copy back via
// TypedArray.set rather than swapping references).
let scratch: EcologyScratch | null = null;
function getScratch(n: number): EcologyScratch {
  if (scratch === null || scratch.soil.length !== n) {
    scratch = {
      soil: new Uint8Array(n),
      flora: new Uint8Array(n),
      fauna: new Uint8Array(n),
      soilInf: new Int32Array(n),
      floraInf: new Int32Array(n),
    };
  }
  return scratch;
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Advance the ecology layers of `map` by one tick. Reads built/parcel/water +
 * the three ecology layers; writes ONLY soilHealth/floraVitality/faunaPresence.
 */
export function ecologyTick(map: GameMap): void {
  const { width, height } = map;
  const n = width * height;
  const next = getScratch(n);
  const soil = map.soilHealth;
  const flora = map.floraVitality;
  const fauna = map.faunaPresence;
  const water = map.water;
  const built = map.built;
  const parcel = map.parcel;

  // --- Influence field: scatter each built tile's influence over its RADIUS box.
  // Bounded local scan (≤ (2R+1)² per built tile), derived purely from read-only
  // fabric, so it is stable within the tick.
  next.soilInf.fill(0);
  next.floraInf.fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = built[map.idx(x, y)]!;
      if (k === 0) continue;
      const inf = influenceOf(k);
      if (inf.soil === 0 && inf.flora === 0) continue;
      const x0 = x - RADIUS < 0 ? 0 : x - RADIUS;
      const x1 = x + RADIUS >= width ? width - 1 : x + RADIUS;
      const y0 = y - RADIUS < 0 ? 0 : y - RADIUS;
      const y1 = y + RADIUS >= height ? height - 1 : y + RADIUS;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const t = map.idx(xx, yy);
          next.soilInf[t]! += inf.soil;
          next.floraInf[t]! += inf.flora;
        }
      }
    }
  }

  // --- Soil: recover toward health, plus influence; sealed tiles cap at PAVED_CAP.
  // A parcel-covered tile is sealed UNLESS it holds a depaved green (Park /
  // RewildedLand) — the rezoning payoff: a converted park has parcel != 0 but its
  // soil must heal past the cap, so isUnsealed exempts it. Reads kind only; the
  // write set (the 3 ecology layers) is unchanged, so layer isolation holds.
  for (let i = 0; i < n; i++) {
    const sealed =
      water[i] !== Water.None ||
      isTransportKind(built[i]!) ||
      (parcel[i] !== 0 && !isUnsealed(built[i]!));
    let v = clampByte(soil[i]! + BASE_RECOVERY + next.soilInf[i]!);
    if (sealed && v > PAVED_CAP) v = PAVED_CAP;
    next.soil[i] = v;
  }

  // --- Flora (reads PREV soil/flora): soil-gated growth + symmetric influence
  // (boost if positive, decay if negative) + neighbour spread; water stays 0.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      if (water[i] !== Water.None) {
        next.flora[i] = 0;
        continue;
      }
      let v = flora[i]!;
      if (soil[i]! >= SOIL_THRESH) v += FLORA_GROWTH;
      v += next.floraInf[i]!;
      if (flora[i]! < SPREAD_MIN) {
        let rich = 0;
        if (x > 0 && flora[map.idx(x - 1, y)]! >= SPREAD_SRC) rich++;
        if (x < width - 1 && flora[map.idx(x + 1, y)]! >= SPREAD_SRC) rich++;
        if (y > 0 && flora[map.idx(x, y - 1)]! >= SPREAD_SRC) rich++;
        if (y < height - 1 && flora[map.idx(x, y + 1)]! >= SPREAD_SRC) rich++;
        if (rich >= 2) v += SPREAD_GAIN;
      }
      next.flora[i] = clampByte(v);
    }
  }

  // --- Fauna (reads PREV flora/fauna): habitat-capped colonisation. A busy road
  // (fragmenting) is impassable — its fauna is pinned 0 and no diffusion edge
  // crosses it; open water is habitat 0. For a passable land tile, habitat is the
  // carrying capacity (prev flora + riparian bonus + corridor floor) and CAPS the
  // pull toward the best passable neighbour, easing by ≤ FAUNA_RATE/tick.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      const k = built[i]!;
      if (influenceOf(k).fragmenting) {
        next.fauna[i] = 0;
        continue;
      }
      if (water[i] !== Water.None) {
        next.fauna[i] = 0;
        continue;
      }
      let waterAdj = 0;
      if (x > 0 && water[map.idx(x - 1, y)] !== Water.None) waterAdj++;
      if (x < width - 1 && water[map.idx(x + 1, y)] !== Water.None) waterAdj++;
      if (y > 0 && water[map.idx(x, y - 1)] !== Water.None) waterAdj++;
      if (y < height - 1 && water[map.idx(x, y + 1)] !== Water.None) waterAdj++;
      // k is non-fragmenting here; any transit kind hosts a corridor verge.
      const corridor = isTransportKind(k) ? CORRIDOR_FLOOR : 0;
      let habitat = flora[i]! + WATER_ADJ_BONUS * waterAdj + corridor;
      if (habitat > 255) habitat = 255;

      let bestNbr = 0;
      const consider = (nx: number, ny: number): void => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const ni = map.idx(nx, ny);
        if (influenceOf(built[ni]!).fragmenting) return; // no edge crosses a busy road
        const f = fauna[ni]!;
        if (f > bestNbr) bestNbr = f;
      };
      consider(x - 1, y);
      consider(x + 1, y);
      consider(x, y - 1);
      consider(x, y + 1);

      const prev = fauna[i]!;
      const pulled = bestNbr - SPREAD_LOSS;
      let target = prev > pulled ? prev : pulled; // max(prev, bestNbr − LOSS)
      if (target > habitat) target = habitat; // habitat CAPS growth (anti-flood)
      let delta = target - prev;
      if (delta > FAUNA_RATE) delta = FAUNA_RATE;
      else if (delta < -FAUNA_RATE) delta = -FAUNA_RATE;
      next.fauna[i] = clampByte(prev + delta);
    }
  }

  // --- Copy back: the only writes to the live layers, after every sub-step read
  // the untouched prev state (strict double buffering).
  map.soilHealth.set(next.soil);
  map.floraVitality.set(next.flora);
  map.faunaPresence.set(next.fauna);
}
