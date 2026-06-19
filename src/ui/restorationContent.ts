// Restoration-progress readout: the pure aggregation + formatting behind the "is my renewal helping?"
// HUD. It surveys the LIVE agent-layer metrics (land value, population, building health, ecology
// richness, air/ground/water pollution) into a single sample, and formats two samples into
// IMPROVEMENT-oriented trend lines so the player can read, at a glance, whether the city is reviving.
//
// Pure: no DOM, no transcendental Math (the architecture guard's pure-ui allowlist scans this file).
// All fields read straight off AmbientState (live, never hashed) + the map's ecology layers; the host
// samples on the civic cadence and keeps the previous sample for the trend.

import { Water, type GameMap } from '../engine/map';
import { richnessOf } from '../ecology/biodiversity';
import type { AmbientState } from './ambientContent';

/** A snapshot of the city's restoration state — the scalars the readout trends over time. */
export interface RestorationSample {
  /** Mean derived land value over inhabited plots (higher = more desirable). */
  landValue: number;
  /** Total live population across all homes. */
  occupancy: number;
  /** Mean building health (citizens' trips banked home; negative = struggling). */
  buildingHealth: number;
  /** Mean ecological richness (flora × fauna) over land tiles. */
  ecology: number;
  /** Total live air pollution (smog) across the map. */
  airPollution: number;
  /** Total live ground contamination across the land. */
  groundPollution: number;
  /** Total live water-runoff pollution across the creeks. */
  waterPollution: number;
}

function meanOf(m: Map<number, number>): number {
  if (m.size === 0) return 0;
  let sum = 0;
  for (const v of m.values()) sum += v;
  return Math.round(sum / m.size);
}

function totalOf(m: Map<number, number>): number {
  let sum = 0;
  for (const v of m.values()) sum += v;
  return Math.round(sum);
}

/** Aggregate the current live restoration metrics from the ambient state + the map's ecology layers. */
export function sampleRestoration(state: AmbientState, map: GameMap): RestorationSample {
  let richSum = 0;
  let landCount = 0;
  const n = map.width * map.height;
  for (let i = 0; i < n; i++) {
    if (map.water[i] !== Water.None) continue; // ecology richness is terrestrial
    richSum += richnessOf(map, i);
    landCount++;
  }
  return {
    landValue: meanOf(state.landValue),
    occupancy: totalOf(state.occupancy),
    buildingHealth: meanOf(state.buildingHealth),
    ecology: landCount > 0 ? Math.round(richSum / landCount) : 0,
    airPollution: totalOf(state.pollution),
    groundPollution: totalOf(state.groundPollution),
    waterPollution: totalOf(state.waterPollution),
  };
}

/** A trend glyph oriented by IMPROVEMENT: ↗ this metric got better, ↘ worse, → flat / no prior. */
export type Trend = '↗' | '→' | '↘';

export interface RestorationLine {
  label: string;
  value: number;
  trend: Trend;
}

// Each metric + whether a HIGHER value is the improvement. Pollution metrics improve as they FALL, so
// the trend arrow flips for them — every ↗ in the readout therefore means "your renewal is helping",
// regardless of whether the underlying number rose or fell.
const METRICS: ReadonlyArray<{ key: keyof RestorationSample; label: string; higherIsBetter: boolean }> = [
  { key: 'landValue', label: 'Land value', higherIsBetter: true },
  { key: 'occupancy', label: 'Population', higherIsBetter: true },
  { key: 'buildingHealth', label: 'Building health', higherIsBetter: true },
  { key: 'ecology', label: 'Ecology', higherIsBetter: true },
  { key: 'airPollution', label: 'Air pollution', higherIsBetter: false },
  { key: 'groundPollution', label: 'Ground pollution', higherIsBetter: false },
  { key: 'waterPollution', label: 'Water pollution', higherIsBetter: false },
];

/** The structured readout: one line per metric with its current value and an improvement-oriented
 *  trend arrow vs `prev`. `prev === null` (before the first cadence sample) is FLAT for every metric. */
export function restorationReadout(cur: RestorationSample, prev: RestorationSample | null): RestorationLine[] {
  return METRICS.map((m) => {
    const value = cur[m.key];
    let trend: Trend = '→';
    if (prev !== null) {
      const delta = value - prev[m.key];
      if (delta !== 0) {
        const improved = m.higherIsBetter ? delta > 0 : delta < 0;
        trend = improved ? '↗' : '↘';
      }
    }
    return { label: m.label, value, trend };
  });
}

/** The readout as plain `Label: value ↗` lines, for the HUD panel shell. */
export function restorationLines(cur: RestorationSample, prev: RestorationSample | null): string[] {
  return restorationReadout(cur, prev).map((l) => `${l.label}: ${l.value} ${l.trend}`);
}
