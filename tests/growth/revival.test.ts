// PR F — revival/decay: the deterministic-growth seam sampling live occupancy into
// the hashed building stock. Tests the pure decision (revivalStep), the signal, and
// the pass (stepRevival) over a real parcel store.

import { describe, it, expect } from 'vitest';
import {
  occupancySignalFor,
  revivalStep,
  stepRevival,
  DEFAULT_REVIVAL_PARAMS,
  type RevivalWorld,
} from '../../src/growth/revival';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';

const P = DEFAULT_REVIVAL_PARAMS;

describe('occupancySignalFor', () => {
  it('is 0 at the seeded baseline (citizensOf = 3 per density)', () => {
    expect(occupancySignalFor(3, 1)).toBe(0); // density 1 baseline = 3
    expect(occupancySignalFor(6, 2)).toBe(0); // density 2 baseline = 6
  });

  it('is positive above baseline (thriving), negative below (struggling)', () => {
    expect(occupancySignalFor(5, 1)).toBeGreaterThan(0);
    expect(occupancySignalFor(1, 1)).toBeLessThan(0);
  });

  it('clamps to [-1, 1] and treats empty density as 0', () => {
    expect(occupancySignalFor(99, 1)).toBe(1);
    expect(occupancySignalFor(0, 1)).toBe(-1);
    expect(occupancySignalFor(10, 0)).toBe(0);
  });
});

describe('revivalStep', () => {
  const rng = () => createRng('revival-test');

  it('heals a thriving home toward pristine', () => {
    const out = revivalStep(100, 1, 1, rng(), P);
    expect(out.condition).toBe(100 + P.conditionStep);
  });

  it('caps healing at 255', () => {
    expect(revivalStep(250, 1, 1, rng(), P).condition).toBe(255);
  });

  it('decays a struggling home toward 0', () => {
    const out = revivalStep(200, 1, -1, rng(), P);
    expect(out.condition).toBe(200 - P.conditionStep);
  });

  it('floors decay at 0', () => {
    expect(revivalStep(5, 1, -1, rng(), P).condition).toBe(0);
  });

  it('holds in the neutral band', () => {
    const out = revivalStep(120, 2, 0, rng(), P);
    expect(out).toEqual({ condition: 120, density: 2 });
  });

  it('can densify a thriving, well-kept home (with a forcing chance)', () => {
    const forcing = { ...P, densifyCondition: 0, densifyChance: 1 };
    const out = revivalStep(255, 1, 1, rng(), forcing);
    expect(out.density).toBe(2);
  });

  it('never densifies past maxDensity', () => {
    const forcing = { ...P, densifyCondition: 0, densifyChance: 1 };
    expect(revivalStep(255, P.maxDensity, 1, rng(), forcing).density).toBe(P.maxDensity);
  });

  it('does not densify a struggling home', () => {
    const forcing = { ...P, densifyCondition: 0, densifyChance: 1 };
    expect(revivalStep(255, 1, -1, rng(), forcing).density).toBe(1);
  });

  it('hard-gates an UNPOWERED home: decays + never grows, even when thriving', () => {
    // signal +1 (thriving) but powered=false → still decays by powerlessStep, no densify
    const forcing = { ...P, densifyCondition: 0, densifyChance: 1 };
    const out = revivalStep(200, 1, 1, rng(), forcing, false);
    expect(out.condition).toBe(200 - P.powerlessStep);
    expect(out.density).toBe(1);
  });

  it('floors unpowered decay at 0', () => {
    expect(revivalStep(3, 1, 1, rng(), P, false).condition).toBe(0);
  });

  it('powered=true (default) preserves the occupancy-driven behavior', () => {
    expect(revivalStep(100, 1, 1, rng(), P, true).condition).toBe(100 + P.conditionStep);
  });
});

function world(): RevivalWorld {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 4, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 120 });
  placeParcel(map, parcels, { x: 8, y: 8, width: 1, height: 1, kind: BuiltKind.CommercialStrip, condition: 120 });
  return { map, parcels };
}

describe('stepRevival (pass over the stock)', () => {
  it('heals a thriving home and ignores non-residential parcels', () => {
    const w = world();
    const homeTile = w.map.idx(4, 4);
    const occ = new Map<number, number>([[homeTile, 9]]); // density 1 baseline 3 → thriving
    const changed = stepRevival(w, (t) => occ.get(t), createRng('a'), () => true, P);
    expect(changed).toBeGreaterThan(0);
    expect(w.parcels.conditionAt(0)).toBe(120 + P.conditionStep); // home healed
    expect(w.parcels.conditionAt(1)).toBe(120); // shop untouched (not residential)
  });

  it('decays a struggling home toward ruin', () => {
    const w = world();
    const homeTile = w.map.idx(4, 4);
    const occ = new Map<number, number>([[homeTile, 0]]);
    stepRevival(w, (t) => occ.get(t), createRng('a'), () => true, P);
    expect(w.parcels.conditionAt(0)).toBe(120 - P.conditionStep);
  });

  it('holds homes with no live occupancy signal', () => {
    const w = world();
    const changed = stepRevival(w, () => undefined, createRng('a'), () => true, P);
    expect(changed).toBe(0);
    expect(w.parcels.conditionAt(0)).toBe(120);
  });

  it('is deterministic: same occupancy + rng → identical stock', () => {
    const occ = (w: RevivalWorld) => new Map<number, number>([[w.map.idx(4, 4), 12]]);
    const a = world();
    const b = world();
    stepRevival(a, (t) => occ(a).get(t), createRng('seed'), () => true, P);
    stepRevival(b, (t) => occ(b).get(t), createRng('seed'), () => true, P);
    expect(a.parcels.snapshotBytes()).toEqual(b.parcels.snapshotBytes());
  });

  it('hard-gates on power: an unpowered home decays even when occupancy is thriving', () => {
    const w = world();
    const homeTile = w.map.idx(4, 4);
    const occ = new Map<number, number>([[homeTile, 30]]); // thriving occupancy...
    // ...but unpowered → decays anyway
    stepRevival(w, (t) => occ.get(t), createRng('a'), () => false, P);
    expect(w.parcels.conditionAt(0)).toBe(120 - P.powerlessStep);
  });

  it('powered + thriving still heals (gate open)', () => {
    const w = world();
    const homeTile = w.map.idx(4, 4);
    const occ = new Map<number, number>([[homeTile, 30]]);
    stepRevival(w, (t) => occ.get(t), createRng('a'), () => true, P);
    expect(w.parcels.conditionAt(0)).toBe(120 + P.conditionStep);
  });

  it('is reversible: a ruined home heals back when occupancy returns', () => {
    const w = world();
    const homeTile = w.map.idx(4, 4);
    // drain it to ruin
    for (let i = 0; i < 20; i++) stepRevival(w, () => 0, createRng('x'), () => true, P);
    expect(w.parcels.conditionAt(0)).toBe(0);
    // heal it back
    for (let i = 0; i < 20; i++) stepRevival(w, (t) => (t === homeTile ? 12 : undefined), createRng('y'), () => true, P);
    expect(w.parcels.conditionAt(0)).toBe(255);
  });
});
