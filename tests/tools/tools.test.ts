import { describe, it, expect } from 'vitest';
import {
  availableTools,
  previewTool,
  applyTool,
  toolDef,
  inspectReadout,
  type ToolId,
} from '../../src/tools/tools';
import {
  BuiltKind,
  ParcelStore,
  hashWorld,
  placeParcel,
  placeTransport,
  checkParcelAgreement,
} from '../../src/engine/fabric';
import { GameMap, Water } from '../../src/engine/map';
import { createTechState, type TechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

interface ToolWorld {
  map: GameMap;
  parcels: ParcelStore;
  seed: string;
  log: string[];
}

function freshWorld(): ToolWorld {
  return { map: new GameMap(16, 16), parcels: new ParcelStore(), seed: 'tools', log: [] };
}

function freshTech(effort: number): TechState {
  const t = createTechState(TECH_TREE);
  t.effort = effort;
  return t;
}

function ids(tech: TechState): string[] {
  return availableTools(tech).map((t) => t.id);
}

describe('toolDef (grant-agnostic tool definitions)', () => {
  it('always resolves inspect (free) and bulldoze (cost 1)', () => {
    const inspect = toolDef('inspect')!;
    expect(inspect.cost).toBe(0);
    const bulldoze = toolDef('bulldoze')!;
    expect(bulldoze.cost).toBe(1);
  });

  it('carries kind + footprint for building tools, no footprint for transport', () => {
    const parklet = toolDef('build-48')!;
    expect(parklet.kind).toBe(BuiltKind.Parklet);
    expect(parklet.footprint).toEqual({ w: 1, h: 1 });
    expect(parklet.cost).toBeGreaterThan(0);

    const bike = toolDef('build-5')!;
    expect(bike.kind).toBe(BuiltKind.BikePath);
    expect(bike.footprint).toBeUndefined();
  });

  it('carries the target kind for conversion tools', () => {
    const conv = toolDef('convert-7')!;
    expect(conv.kind).toBe(BuiltKind.QuietStreet);
    expect(conv.cost).toBeGreaterThan(0);
  });

  it('returns undefined for an unknown build/convert kind', () => {
    expect(toolDef('build-999' as ToolId)).toBeUndefined();
    expect(toolDef('convert-3' as ToolId)).toBeUndefined(); // Highway is no conversion target
  });
});

describe('availableTools reflects grants', () => {
  it('always offers inspect and bulldoze, even with nothing unlocked', () => {
    const list = ids(freshTech(0));
    expect(list).toContain('inspect');
    expect(list).toContain('bulldoze');
  });

  it('reveals build-48 only after parklets is unlocked', () => {
    const tech = freshTech(1000);
    expect(ids(tech)).not.toContain('build-48');
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    tech.unlock('parklets');
    expect(ids(tech)).toContain('build-48');
  });

  it('reveals convert-1 AND convert-2 exactly when road-diets is unlocked (classic targets)', () => {
    const tech = freshTech(1000);
    expect(ids(tech)).not.toContain('convert-1');
    expect(ids(tech)).not.toContain('convert-2');

    tech.unlock('walkable-streets'); // road-diets prereq, not road-diets itself
    expect(ids(tech)).not.toContain('convert-1');
    expect(ids(tech)).not.toContain('convert-2');

    tech.unlock('road-diets');
    const list = ids(tech);
    expect(list).toContain('convert-1'); // avenue -> street
    expect(list).toContain('convert-2'); // highway -> avenue
  });

  it('reveals build-6 and convert-6 when streetcar-revival is unlocked (tech target)', () => {
    const tech = freshTech(1000);
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    tech.unlock('sun-and-wire');
    tech.unlock('renewable-energy');
    expect(ids(tech)).not.toContain('build-6');
    expect(ids(tech)).not.toContain('convert-6');

    tech.unlock('streetcar-revival'); // grants Streetcar(6)
    const list = ids(tech);
    expect(list).toContain('build-6'); // streetcar build tool
    expect(list).toContain('convert-6'); // rail -> streetcar conversion
  });

  it('is deterministic and stably ordered for equal grants', () => {
    const a = freshTech(1000);
    const b = freshTech(1000);
    for (const t of [a, b]) {
      t.unlock('walkable-streets');
      t.unlock('road-diets');
      t.unlock('parklets');
    }
    expect(availableTools(a)).toEqual(availableTools(b));
  });
});

describe('availableTools: rezone tools (building-target 3-way gate)', () => {
  it('resolves the rezone convert tools with their target kind + cost', () => {
    expect(toolDef('convert-61')!.kind).toBe(BuiltKind.Park);
    expect(toolDef('convert-62')!.kind).toBe(BuiltKind.RewildedLand);
    expect(toolDef('convert-61')!.cost).toBeGreaterThan(0);
    expect(toolDef('convert-62')!.cost).toBeGreaterThan(0);
  });

  it('reveals convert-61 only after the pocket-parks chain (Park grant), never via road-diets alone', () => {
    const tech = freshTech(1000);
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    expect(ids(tech)).not.toContain('convert-61'); // road-diets capability does NOT surface it
    tech.unlock('parklets');
    tech.unlock('pocket-parks'); // grants Park(61)
    expect(ids(tech)).toContain('convert-61');
  });

  it('reveals convert-62 only after the rewilding chain (RewildedLand grant)', () => {
    const tech = freshTech(1000);
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    expect(ids(tech)).not.toContain('convert-62');
    tech.unlock('soil-and-soul');
    tech.unlock('urban-composting');
    tech.unlock('community-gardens');
    tech.unlock('rewilding'); // grants RewildedLand(62)
    expect(ids(tech)).toContain('convert-62');
  });

  it('road-diets still surfaces convert-1/2 but NOT the rezone tools (gate not loosened)', () => {
    const tech = freshTech(1000);
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    const list = ids(tech);
    expect(list).toContain('convert-1');
    expect(list).toContain('convert-2');
    expect(list).not.toContain('convert-61');
    expect(list).not.toContain('convert-62');
  });
});

describe('previewTool never mutates', () => {
  it('leaves world hash + tech snapshot byte-equal on a VALID target', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    const h = hashWorld(world);
    const sb = tech.snapshotBytes();
    const r = previewTool(world, tech, toolDef('build-48')!, 3, 3);
    expect(r.valid).toBe(true);
    expect(hashWorld(world)).toBe(h);
    expect(tech.snapshotBytes()).toEqual(sb);
  });

  it('leaves world hash + tech snapshot byte-equal on an INVALID target', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 3, 3, BuiltKind.RoadStreet); // occupy the tile
    const h = hashWorld(world);
    const sb = tech.snapshotBytes();
    const r = previewTool(world, tech, toolDef('build-48')!, 3, 3);
    expect(r.valid).toBe(false);
    expect(hashWorld(world)).toBe(h);
    expect(tech.snapshotBytes()).toEqual(sb);
  });

  it('reports effort as the blocker when geometry is valid but funds are short', () => {
    const world = freshWorld();
    const tech = freshTech(0);
    const r = previewTool(world, tech, toolDef('build-48')!, 3, 3);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('effort');
  });

  it('reports an invalid conversion target', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    const r = previewTool(world, tech, toolDef('convert-7')!, 3, 3); // empty tile
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid-target');
  });
});

describe('applyTool spends + routes to single-writers', () => {
  it('debits exactly the tool cost and places the parcel', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    const tool = toolDef('build-48')!;
    const before = tech.effort;
    const r = applyTool(world, tech, tool, 3, 3);
    expect(r.ok).toBe(true);
    expect(tech.effort).toBe(before - tool.cost);
    expect(world.map.getBuilt(3, 3)).toBe(BuiltKind.Parklet);
    expect(world.parcels.aliveCount()).toBe(1);
  });

  it('rejects on insufficient effort, mutating neither world nor tech', () => {
    const world = freshWorld();
    const tech = freshTech(0);
    const h = hashWorld(world);
    const sb = tech.snapshotBytes();
    const r = applyTool(world, tech, toolDef('build-48')!, 3, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('effort');
    expect(hashWorld(world)).toBe(h);
    expect(tech.snapshotBytes()).toEqual(sb);
  });

  it('routes a transport build tool to placeTransport', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    expect(applyTool(world, tech, toolDef('build-5')!, 2, 2).ok).toBe(true);
    expect(world.map.getBuilt(2, 2)).toBe(BuiltKind.BikePath);
  });

  it('routes a convert tool to convertTransport (in place)', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 2, 2, BuiltKind.RoadStreet);
    expect(applyTool(world, tech, toolDef('convert-7')!, 2, 2).ok).toBe(true);
    expect(world.map.getBuilt(2, 2)).toBe(BuiltKind.QuietStreet);
    expect(world.map.getParcel(2, 2)).toBe(0); // conversion never touches parcels
  });

  it('routes bulldoze to demolishParcel for a building and demolishTransportAt for transport', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    const pid = placeParcel(world.map, world.parcels, {
      x: 4,
      y: 4,
      width: 1,
      height: 1,
      kind: BuiltKind.HouseSingle,
    });
    placeTransport(world.map, 6, 6, BuiltKind.RoadStreet);

    expect(applyTool(world, tech, toolDef('bulldoze')!, 4, 4).ok).toBe(true);
    expect(world.map.getBuilt(4, 4)).toBe(0);
    expect(world.parcels.isAlive(pid)).toBe(false);

    expect(applyTool(world, tech, toolDef('bulldoze')!, 6, 6).ok).toBe(true);
    expect(world.map.getBuilt(6, 6)).toBe(0);
  });

  it('rejects bulldoze on an empty tile (nothing to remove)', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    const before = tech.effort;
    const r = applyTool(world, tech, toolDef('bulldoze')!, 7, 7);
    expect(r.ok).toBe(false);
    expect(tech.effort).toBe(before); // no charge on a no-op
  });

  it('inspect is free and non-mutating, returning info', () => {
    const world = freshWorld();
    const tech = freshTech(50);
    placeParcel(world.map, world.parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const h = hashWorld(world);
    const sb = tech.snapshotBytes();
    const eff = tech.effort;
    const r = applyTool(world, tech, toolDef('inspect')!, 2, 2);
    expect(r.ok).toBe(true);
    expect(r.info).toBeTruthy();
    expect(tech.effort).toBe(eff);
    expect(hashWorld(world)).toBe(h);
    expect(tech.snapshotBytes()).toEqual(sb);
  });

  it('leaves the agreement sweep clean after a mixed build/convert/bulldoze sequence', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 1, 1, BuiltKind.RoadStreet);
    applyTool(world, tech, toolDef('build-48')!, 3, 3); // parklet 1x1
    applyTool(world, tech, toolDef('build-49')!, 5, 5); // garden 2x2
    applyTool(world, tech, toolDef('convert-7')!, 1, 1); // street -> quiet street
    applyTool(world, tech, toolDef('bulldoze')!, 3, 3); // remove the parklet
    expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
  });
});

describe('applyTool: rezone (building-target) dispatch', () => {
  it('convert-61 rezones an alive building parcel in place and debits its cost', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeParcel(world.map, world.parcels, {
      x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.Projects, condition: 40,
    });
    const tool = toolDef('convert-61')!;
    const before = tech.effort;
    const r = applyTool(world, tech, tool, 4, 4);
    expect(r.ok).toBe(true);
    expect(tech.effort).toBe(before - tool.cost); // debited via tech.spend
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(world.map.getBuilt(4 + dx, 4 + dy)).toBe(BuiltKind.Park);
        expect(world.map.getParcel(4 + dx, 4 + dy)).toBe(1); // parcel id preserved
      }
    }
    expect(world.parcels.conditionAt(0)).toBe(255);
    expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
  });

  it('convert-62 rezones to RewildedLand', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeParcel(world.map, world.parcels, { x: 3, y: 3, width: 1, height: 1, kind: BuiltKind.ParkingLot });
    expect(applyTool(world, tech, toolDef('convert-62')!, 3, 3).ok).toBe(true);
    expect(world.map.getBuilt(3, 3)).toBe(BuiltKind.RewildedLand);
  });

  it('rejects a rezone on empty / road / water tiles, mutating nothing', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 6, 6, BuiltKind.RoadStreet);
    world.map.setWater(8, 8, Water.Lake);
    const h = hashWorld(world);
    const before = tech.effort;
    expect(applyTool(world, tech, toolDef('convert-61')!, 1, 1).ok).toBe(false); // empty
    expect(applyTool(world, tech, toolDef('convert-61')!, 6, 6).ok).toBe(false); // road
    expect(applyTool(world, tech, toolDef('convert-61')!, 8, 8).ok).toBe(false); // water
    expect(hashWorld(world)).toBe(h);
    expect(tech.effort).toBe(before); // no charge on a no-op
  });

  it('keeps transport converts (convert-1, convert-6) routed to convertTransport (built only)', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 2, 2, BuiltKind.RoadAvenue); // convert-1: avenue -> street
    placeTransport(world.map, 5, 5, BuiltKind.Rail); // convert-6: rail -> streetcar
    expect(applyTool(world, tech, toolDef('convert-1')!, 2, 2).ok).toBe(true);
    expect(world.map.getBuilt(2, 2)).toBe(BuiltKind.RoadStreet);
    expect(world.map.getParcel(2, 2)).toBe(0); // transport convert never touches parcels
    expect(applyTool(world, tech, toolDef('convert-6')!, 5, 5).ok).toBe(true);
    expect(world.map.getBuilt(5, 5)).toBe(BuiltKind.Streetcar);
    expect(world.map.getParcel(5, 5)).toBe(0);
  });
});

describe('inspectReadout (pure tile readout)', () => {
  it('reports an empty tile', () => {
    expect(inspectReadout(freshWorld(), 3, 3)).toBe('(3, 3) empty');
  });

  it('reports a transport tile by kind', () => {
    const world = freshWorld();
    placeTransport(world.map, 2, 2, BuiltKind.RoadStreet);
    expect(inspectReadout(world, 2, 2)).toBe('(2, 2) transport kind 1');
  });

  it('reports a building tile with its parcel id and condition', () => {
    const world = freshWorld();
    const pid = placeParcel(world.map, world.parcels, {
      x: 4,
      y: 4,
      width: 1,
      height: 1,
      kind: BuiltKind.HouseSingle,
    });
    world.parcels.setCondition(pid, 100);
    expect(inspectReadout(world, 4, 4)).toBe(`(4, 4) building kind 16 · parcel ${pid + 1} · condition 100`);
  });

  it('reports an out-of-bounds tile', () => {
    expect(inspectReadout(freshWorld(), -1, 0)).toBe('(-1, 0) out of bounds');
  });

  it('is pure: equal inputs, equal output, no mutation', () => {
    const world = freshWorld();
    placeTransport(world.map, 1, 1, BuiltKind.Rail);
    const h = hashWorld(world);
    expect(inspectReadout(world, 1, 1)).toBe(inspectReadout(world, 1, 1));
    expect(hashWorld(world)).toBe(h);
  });
});

describe('applyTool determinism', () => {
  function playScript(): { h: string; sb: Uint8Array } {
    const world = freshWorld();
    const tech = freshTech(1000);
    placeTransport(world.map, 8, 8, BuiltKind.RoadStreet); // a conversion target
    const script: ReadonlyArray<readonly [ToolId, number, number]> = [
      ['build-5', 2, 2],
      ['build-48', 4, 4],
      ['build-49', 10, 10],
      ['convert-7', 8, 8],
      ['bulldoze', 4, 4],
    ];
    for (const [id, x, y] of script) applyTool(world, tech, toolDef(id)!, x, y);
    return { h: hashWorld(world), sb: tech.snapshotBytes() };
  }

  it('replays a scripted sequence on a regenerated world to identical hash + snapshot', () => {
    const a = playScript();
    const b = playScript();
    expect(a.h).toBe(b.h);
    expect(a.sb).toEqual(b.sb);
  });
});

describe('previewTool / applyTool guard the map edges', () => {
  it('treats an out-of-bounds target as invalid without mutation', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    expect(previewTool(world, tech, toolDef('build-48')!, -1, 0).valid).toBe(false);
    expect(applyTool(world, tech, toolDef('build-48')!, -1, 0).ok).toBe(false);
  });

  it('refuses to place a parcel onto water', () => {
    const world = freshWorld();
    const tech = freshTech(1000);
    world.map.setWater(5, 5, Water.Lake);
    expect(previewTool(world, tech, toolDef('build-48')!, 5, 5).valid).toBe(false);
    expect(applyTool(world, tech, toolDef('build-48')!, 5, 5).ok).toBe(false);
  });
});
