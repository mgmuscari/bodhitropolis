import { describe, it, expect } from 'vitest';
import { builtRenderKey, renderKeyspace, type FootprintPos } from '../../src/ui/renderKey';
import { BuiltKind, isTransportKind } from '../../src/engine/fabric';

const POSITIONS: FootprintPos[] = ['c', 'e', 'k'];
const TIERS = [0, 1];

// Every named placeable kind (None excluded).
const PLACEABLE = Object.values(BuiltKind).filter((k) => k !== BuiltKind.None);

describe('builtRenderKey totality + membership', () => {
  const keyspace = new Set(renderKeyspace());

  it('returns a non-empty key in renderKeyspace for every placeable kind across its dims', () => {
    for (const kind of PLACEABLE) {
      if (isTransportKind(kind)) {
        for (let mask = 0; mask < 16; mask++) {
          const key = builtRenderKey(kind, mask, 'c', 0);
          expect(key, `kind ${kind} mask ${mask}`).toBeTruthy();
          expect(keyspace.has(key), `kind ${kind} mask ${mask} -> ${key} not in keyspace`).toBe(true);
        }
      } else {
        for (const pos of POSITIONS) {
          for (const tier of TIERS) {
            const key = builtRenderKey(kind, 0, pos, tier);
            expect(key, `kind ${kind} pos ${pos} tier ${tier}`).toBeTruthy();
            expect(keyspace.has(key), `kind ${kind} -> ${key} not in keyspace`).toBe(true);
          }
        }
      }
    }
  });
});

describe('renderKeyspace shape', () => {
  it('has no duplicates', () => {
    const ks = renderKeyspace();
    expect(new Set(ks).size).toBe(ks.length);
  });

  it('is order-stable across calls', () => {
    expect(renderKeyspace()).toEqual(renderKeyspace());
  });
});

describe('QuietStreet(7) renders into the road set (missing-style regression)', () => {
  it('keys road-7-{mask} and enumerates the full road-7 mask set', () => {
    const keyspace = new Set(renderKeyspace());
    expect(builtRenderKey(BuiltKind.QuietStreet, 5, 'c', 0)).toBe('road-7-5');
    for (let m = 0; m < 16; m++) {
      expect(keyspace.has(`road-7-${m}`), `road-7-${m} missing from keyspace`).toBe(true);
    }
  });
});

describe('builtRenderKey kind → prefix mapping', () => {
  it('maps each transport kind to its category prefix (mask used, pos/tier ignored)', () => {
    expect(builtRenderKey(BuiltKind.RoadStreet, 1, 'c', 0)).toBe('road-1-1');
    expect(builtRenderKey(BuiltKind.RoadAvenue, 2, 'e', 1)).toBe('road-2-2'); // pos/tier ignored
    expect(builtRenderKey(BuiltKind.RoadHighway, 3, 'c', 0)).toBe('road-3-3');
    expect(builtRenderKey(BuiltKind.Rail, 2, 'c', 0)).toBe('rail-2');
    expect(builtRenderKey(BuiltKind.Streetcar, 8, 'c', 0)).toBe('streetcar-8');
    expect(builtRenderKey(BuiltKind.ElevatedRail, 6, 'c', 0)).toBe('elev-6');
    expect(builtRenderKey(BuiltKind.BikePath, 4, 'c', 0)).toBe('bike-4');
    expect(builtRenderKey(BuiltKind.Promenade, 9, 'c', 0)).toBe('ped-9');
  });

  it('maps buildings to b-{kind}-{pos}-{tier} (mask ignored)', () => {
    expect(builtRenderKey(BuiltKind.HouseSingle, 7, 'e', 1)).toBe('b-16-e-1');
    expect(builtRenderKey(BuiltKind.Parklet, 0, 'k', 0)).toBe('b-48-k-0');
    expect(builtRenderKey(BuiltKind.HealingCommons, 0, 'c', 1)).toBe('b-60-c-1');
  });

  it('is deterministic for equal inputs', () => {
    expect(builtRenderKey(BuiltKind.Rail, 3, 'c', 0)).toBe(builtRenderKey(BuiltKind.Rail, 3, 'c', 0));
    expect(builtRenderKey(BuiltKind.Parklet, 0, 'e', 1)).toBe(builtRenderKey(BuiltKind.Parklet, 0, 'e', 1));
  });
});
