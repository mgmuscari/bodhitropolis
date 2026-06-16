import { describe, it, expect } from 'vitest';
import { builtRenderKey, renderKeyspace, type FootprintPos } from '../../src/ui/renderKey';
import { BuiltKind, isTransportKind } from '../../src/engine/fabric';
import { ROAD_STYLE_KINDS, BUILDING_STYLE_KINDS, PAINTABLE_PREFIXES } from '../../src/ui/renderer';

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

describe('Park(61) + RewildedLand(62) render into the building set', () => {
  const keyspace = new Set(renderKeyspace());

  it('keys b-61/b-62 and enumerates the full pos×tier sets', () => {
    expect(builtRenderKey(BuiltKind.Park, 0, 'c', 0)).toBe('b-61-c-0');
    expect(builtRenderKey(BuiltKind.RewildedLand, 0, 'e', 1)).toBe('b-62-e-1');
    for (const pos of POSITIONS) {
      for (const tier of TIERS) {
        expect(keyspace.has(`b-61-${pos}-${tier}`), `b-61-${pos}-${tier} missing`).toBe(true);
        expect(keyspace.has(`b-62-${pos}-${tier}`), `b-62-${pos}-${tier} missing`).toBe(true);
      }
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

describe('builtRenderKey wide-body variant', () => {
  it('appends -w only for road kinds when wide=true', () => {
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0, true)).toBe('road-2-15-w');
    expect(builtRenderKey(BuiltKind.RoadHighway, 7, 'c', 0, true)).toBe('road-3-7-w');
    expect(builtRenderKey(BuiltKind.RoadStreet, 3, 'c', 0, true)).toBe('road-1-3-w');
  });

  it('defaults wide=false: 4-arg calls and explicit false are unchanged', () => {
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0)).toBe('road-2-15');
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0, false)).toBe('road-2-15');
  });

  it('ignores wide for QuietStreet(7) — it never widens (no road-7-*-w)', () => {
    expect(builtRenderKey(BuiltKind.QuietStreet, 5, 'c', 0, true)).toBe('road-7-5');
  });

  it('ignores wide for rail/transit and building kinds', () => {
    expect(builtRenderKey(BuiltKind.Rail, 2, 'c', 0, true)).toBe('rail-2');
    expect(builtRenderKey(BuiltKind.Streetcar, 8, 'c', 0, true)).toBe('streetcar-8');
    expect(builtRenderKey(BuiltKind.HouseSingle, 0, 'e', 1, true)).toBe('b-16-e-1');
  });
});

describe('renderKeyspace wide-body enumeration', () => {
  const keyspace = new Set(renderKeyspace());

  it('enumerates road-{k}-{m}-w for kinds 1–3 across all 16 masks', () => {
    for (const k of [1, 2, 3]) {
      for (let m = 0; m < 16; m++) {
        expect(keyspace.has(`road-${k}-${m}-w`), `road-${k}-${m}-w missing`).toBe(true);
      }
    }
    // Spot-checks from the PRP.
    expect(keyspace.has('road-2-15-w')).toBe(true);
    expect(keyspace.has('road-3-0-w')).toBe(true);
  });

  it('excludes QuietStreet wide keys (road-7-*-w) but keeps plain road-7-{m}', () => {
    const quietWide = renderKeyspace().filter((k) => k.startsWith('road-7-') && k.endsWith('-w'));
    expect(quietWide).toEqual([]);
    for (let m = 0; m < 16; m++) {
      expect(keyspace.has(`road-7-${m}`), `road-7-${m} missing`).toBe(true);
    }
  });
});

// Crash-on-load guard: buildAtlas iterates renderKeyspace() and paintForKey derefs
// ROAD_STYLES[k]! / BUILDING_STYLES[kind]! and switches on the key prefix. A
// renderKey kind/prefix the renderer has no style/case for throws at Renderer
// construction — green under tsc/build/unit tests, dead on load. This asserts
// every key the keyspace emits is paintable, headlessly (the renderer style
// keysets are exported for exactly this). Non-vacuous: drop ROAD_STYLES[7] or a
// BUILDING_STYLES[48..60] entry and the matching assertion fails.
describe('renderKeyspace is fully covered by renderer styles', () => {
  const keys = renderKeyspace();
  const roadKinds = new Set(ROAD_STYLE_KINDS);
  const buildingKinds = new Set(BUILDING_STYLE_KINDS);
  const prefixes = new Set(PAINTABLE_PREFIXES);

  it('every emitted key has a prefix paintForKey handles', () => {
    for (const key of keys) {
      const prefix = key.split('-')[0]!;
      expect(prefixes.has(prefix), `no paintForKey case for prefix '${prefix}' (${key})`).toBe(true);
    }
  });

  it('every road-{k} key has a ROAD_STYLES entry', () => {
    const roadKeys = keys.filter((k) => k.startsWith('road-'));
    expect(roadKeys.length).toBeGreaterThan(0); // guard is non-vacuous
    for (const key of roadKeys) {
      const kind = Number(key.split('-')[1]);
      expect(roadKinds.has(kind), `ROAD_STYLES missing kind ${kind} for ${key}`).toBe(true);
    }
  });

  it('every b-{kind} key has a BUILDING_STYLES entry', () => {
    const buildingKeys = keys.filter((k) => k.startsWith('b-'));
    expect(buildingKeys.length).toBeGreaterThan(0); // guard is non-vacuous
    for (const key of buildingKeys) {
      const kind = Number(key.split('-')[1]);
      expect(buildingKinds.has(kind), `BUILDING_STYLES missing kind ${kind} for ${key}`).toBe(true);
    }
  });
});
