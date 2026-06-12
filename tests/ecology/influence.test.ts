import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import {
  influenceOf,
  INFLUENCE,
  ZERO_INFLUENCE,
  ECO_CADENCE,
  RADIUS,
  type KindInfluence,
} from '../../src/ecology/influence';

// The influence table is DATA: per-BuiltKind ecology deltas applied within RADIUS
// each ecology tick, plus the fauna-fragmenting flag. The tests pin the SIGN
// contract (boosts strictly positive, suppressors strictly negative) and the
// road-diet payoff (busy roads fragment; calm corridors do not) as data — never
// the magnitudes, which are placeholder ecology.

const BOOST_KINDS = [
  BuiltKind.Parklet,
  BuiltKind.CommunityGarden,
  BuiltKind.CompostHub,
  BuiltKind.QuietStreet,
  BuiltKind.Promenade,
  BuiltKind.BikePath,
];

const SUPPRESSOR_KINDS = [
  BuiltKind.RoadHighway,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadStreet,
  BuiltKind.ParkingLot,
  BuiltKind.Industrial,
];

const FRAGMENTING_KINDS = [BuiltKind.RoadStreet, BuiltKind.RoadAvenue, BuiltKind.RoadHighway];
const NON_FRAGMENTING_TRANSIT = [BuiltKind.QuietStreet, BuiltKind.Promenade, BuiltKind.BikePath];

describe('influenceOf: totality', () => {
  it('resolves EVERY BuiltKind to a well-formed KindInfluence', () => {
    for (const kind of Object.values(BuiltKind)) {
      const inf = influenceOf(kind);
      expect(inf, `kind ${kind} resolves`).toBeDefined();
      expect(typeof inf.soil).toBe('number');
      expect(typeof inf.flora).toBe('number');
      expect(typeof inf.fauna).toBe('number');
      expect(typeof inf.fragmenting).toBe('boolean');
    }
  });

  it('falls back to ZERO_INFLUENCE for an off-table kind (e.g. empty / unhoused code)', () => {
    expect(influenceOf(BuiltKind.None)).toEqual(ZERO_INFLUENCE);
    // A reserved-band code with no entry resolves to ZERO, not undefined.
    expect(influenceOf(24)).toEqual(ZERO_INFLUENCE);
    expect(ZERO_INFLUENCE).toEqual({ soil: 0, flora: 0, fauna: 0, fragmenting: false });
  });

  it('a neutral-by-default building (HouseSingle) is ZERO', () => {
    expect(influenceOf(BuiltKind.HouseSingle)).toEqual(ZERO_INFLUENCE);
  });
});

describe('influenceOf: sign contract', () => {
  it('boost kinds are strictly positive on soil/flora/fauna and never fragment', () => {
    for (const kind of BOOST_KINDS) {
      const inf = influenceOf(kind);
      expect(inf.soil, `boost ${kind} soil`).toBeGreaterThan(0);
      expect(inf.flora, `boost ${kind} flora`).toBeGreaterThan(0);
      expect(inf.fauna, `boost ${kind} fauna`).toBeGreaterThan(0);
      expect(inf.fragmenting, `boost ${kind} fragmenting`).toBe(false);
    }
  });

  it('suppressor kinds are strictly negative on soil/flora/fauna', () => {
    for (const kind of SUPPRESSOR_KINDS) {
      const inf = influenceOf(kind);
      expect(inf.soil, `suppressor ${kind} soil`).toBeLessThan(0);
      expect(inf.flora, `suppressor ${kind} flora`).toBeLessThan(0);
      expect(inf.fauna, `suppressor ${kind} fauna`).toBeLessThan(0);
    }
  });

  it('the community garden is the strongest soil boost in the table', () => {
    const garden = influenceOf(BuiltKind.CommunityGarden).soil;
    for (const [kind, inf] of INFLUENCE) {
      if (kind === BuiltKind.CommunityGarden) continue;
      expect(inf.soil, `garden soil > ${kind} soil`).toBeLessThan(garden);
    }
  });
});

describe('influenceOf: road-diet fragmentation flag (pinned as data)', () => {
  it('busy roads fragment fauna', () => {
    for (const kind of FRAGMENTING_KINDS) {
      expect(influenceOf(kind).fragmenting, `road ${kind} fragments`).toBe(true);
    }
  });

  it('calm corridors (quiet street / promenade / bike path) do NOT fragment fauna', () => {
    for (const kind of NON_FRAGMENTING_TRANSIT) {
      expect(influenceOf(kind).fragmenting, `corridor ${kind} non-fragmenting`).toBe(false);
    }
  });
});

describe('ecology structural constants', () => {
  it('pins the cadence and influence radius', () => {
    expect(ECO_CADENCE).toBe(10);
    expect(RADIUS).toBe(2);
  });

  it('exposes a frozen-shaped table whose entries all satisfy the KindInfluence contract', () => {
    for (const [, inf] of INFLUENCE) {
      const keys = Object.keys(inf).sort();
      expect(keys).toEqual(['fauna', 'flora', 'fragmenting', 'soil']);
    }
  });
});

// Type-only touch so `KindInfluence` is exercised by the test compile.
const _typecheck: KindInfluence = ZERO_INFLUENCE;
void _typecheck;
