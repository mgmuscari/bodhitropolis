import { describe, it, expect } from 'vitest';
import {
  PROCEDURAL,
  TILESET_DEFS,
  tilesetDef,
  tilesetMetas,
  terrainKeys,
  buildingKeys,
  surfaceKey,
} from '../../src/ui/tileset';
import { BuiltKind } from '../../src/engine/fabric';
import { builtRenderKey } from '../../src/ui/renderKey';

describe('tileset registry', () => {
  it('procedural is the first def and supplies NO assets (pure painters, the permanent default)', () => {
    expect(TILESET_DEFS[0]!.id).toBe(PROCEDURAL);
    expect(TILESET_DEFS[0]!.assets).toEqual([]);
  });

  it('every def has a stable id, a human label, and a one-line description', () => {
    for (const d of TILESET_DEFS) {
      expect(d.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('exposes the satellite tileset (the first generated skin)', () => {
    expect(TILESET_DEFS.some((d) => d.id === 'satellite')).toBe(true);
  });

  it('tilesetDef returns the named def, and falls back to procedural for an unknown id', () => {
    expect(tilesetDef(PROCEDURAL).id).toBe(PROCEDURAL);
    expect(tilesetDef('satellite').id).toBe('satellite');
    expect(tilesetDef('does-not-exist').id).toBe(PROCEDURAL);
  });

  it('tilesetMetas lists every def as {id,label,description} for the settings dropdown', () => {
    const metas = tilesetMetas();
    expect(metas.map((m) => m.id)).toEqual(TILESET_DEFS.map((d) => d.id));
    expect(metas[0]).toEqual({
      id: TILESET_DEFS[0]!.id,
      label: TILESET_DEFS[0]!.label,
      description: TILESET_DEFS[0]!.description,
    });
  });

  it('every asset names a file and fills at least one well-formed key (atlas key or @surface ingredient)', () => {
    for (const d of TILESET_DEFS) {
      for (const a of d.assets) {
        expect(a.file.length).toBeGreaterThan(0);
        expect(a.keys.length).toBeGreaterThan(0);
        for (const k of a.keys) expect(k).toMatch(/^([a-z]|@surface\/)/); // an atlas key or a surface role, not a path
      }
    }
  });

  it('the satellite tileset ships asphalt road surfaces (≥2 variants, cycled to beat the plaid)', () => {
    const sat = tilesetDef('satellite');
    const asphalt = sat.assets.filter((a) => a.keys.some((k) => k.startsWith(surfaceKey('road'))));
    expect(asphalt.length).toBeGreaterThanOrEqual(2); // multiple variants for per-tile cycling
    for (const a of asphalt) expect(a.file).toMatch(/\.png$/);
  });
});

describe('surfaceKey (road-texture ingredient namespace)', () => {
  it('namespaces a surface role under @surface/ so it can never collide with an atlas key', () => {
    expect(surfaceKey('road')).toBe('@surface/road');
    expect(surfaceKey('road-2')).toBe('@surface/road-2');
    // Atlas keys start with a letter (terrain `grass-0`, built `road-1-5`, `b-16-c-0`); a surface
    // key starts with '@', so the renderer can tell ingredients from drawable tiles by prefix.
    expect(surfaceKey('road').startsWith('@')).toBe(true);
  });
});

describe('tileset key fan-out helpers', () => {
  it('terrainKeys expands one terrain PNG over all four elevation bands', () => {
    expect(terrainKeys('grass')).toEqual(['grass-0', 'grass-1', 'grass-2', 'grass-3']);
  });

  it('buildingKeys covers every footprint position × condition tier, via the canonical key builder', () => {
    const keys = buildingKeys(BuiltKind.HouseSingle);
    // 3 positions (c/e/k) × 2 tiers (pristine/derelict) = 6 keys, matching builtRenderKey.
    expect(keys).toHaveLength(6);
    expect(keys).toContain(builtRenderKey(BuiltKind.HouseSingle, 0, 'c', 0));
    expect(keys).toContain(builtRenderKey(BuiltKind.HouseSingle, 0, 'k', 1));
  });

  it('buildingKeys can scope to a single tier (so pristine and derelict art stay distinct)', () => {
    const pristine = buildingKeys(BuiltKind.Apartments, 0);
    expect(pristine).toHaveLength(3);
    for (const k of pristine) expect(k.endsWith('-0')).toBe(true);
  });
});
