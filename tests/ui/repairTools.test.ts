import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import { toolDef } from '../../src/tools/tools';
import { isRepairTool } from '../../src/ui/repairTools';

// isRepairTool is the pure predicate over a ToolDef that the repair-forwarding
// wiring in main.ts consumes: REPAIR = every conversion + every ecology-boost
// build; bulldoze, inspect, and non-boost builds are NOT repairs. Pure module so
// it is unit-tested rather than left to main.ts wiring.

describe('isRepairTool', () => {
  it('classifies EVERY conversion tool as a repair (road diets)', () => {
    for (const to of [
      BuiltKind.RoadStreet,
      BuiltKind.RoadAvenue,
      BuiltKind.BikePath,
      BuiltKind.Streetcar,
      BuiltKind.QuietStreet,
      BuiltKind.Promenade,
    ]) {
      const def = toolDef(`convert-${to}`)!;
      expect(isRepairTool(def), `convert-${to}`).toBe(true);
    }
  });

  it('classifies the rezone convert tools (convert-61/62) as repairs (convert-prefix)', () => {
    expect(isRepairTool(toolDef('convert-61')!), 'convert-61').toBe(true);
    expect(isRepairTool(toolDef('convert-62')!), 'convert-62').toBe(true);
  });

  it('classifies every ecology-BOOST build as a repair', () => {
    for (const k of [
      BuiltKind.CommunityGarden,
      BuiltKind.CompostHub,
      BuiltKind.Parklet,
      BuiltKind.QuietStreet,
      BuiltKind.Promenade,
      BuiltKind.BikePath,
    ]) {
      const def = toolDef(`build-${k}`)!;
      expect(isRepairTool(def), `build-${k}`).toBe(true);
    }
  });

  it('does NOT classify a non-boost build as a repair (e.g. ADU, Bazaar)', () => {
    expect(isRepairTool(toolDef(`build-${BuiltKind.ADU}`)!)).toBe(false);
    expect(isRepairTool(toolDef(`build-${BuiltKind.Bazaar}`)!)).toBe(false);
  });

  it('does NOT classify bulldoze or inspect as repairs', () => {
    expect(isRepairTool(toolDef('bulldoze')!)).toBe(false);
    expect(isRepairTool(toolDef('inspect')!)).toBe(false);
  });
});
