import { describe, it, expect } from 'vitest';
import { toolbarRows } from '../../src/ui/toolbarContent';
import { availableTools, toolDef } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

describe('toolbarRows', () => {
  it('labels each row as `Name · cost` in the tools order', () => {
    const tools = [toolDef('inspect')!, toolDef('bulldoze')!];
    const rows = toolbarRows(tools, null, 100);
    expect(rows.map((r) => r.id)).toEqual(['inspect', 'bulldoze']);
    expect(rows[0]!.label).toBe('Inspect · 0');
    expect(rows[1]!.label).toBe('Bulldoze · 1');
  });

  it('marks exactly the selected tool', () => {
    const tools = [toolDef('inspect')!, toolDef('bulldoze')!];
    const rows = toolbarRows(tools, 'bulldoze', 100);
    expect(rows.find((r) => r.id === 'inspect')!.selected).toBe(false);
    expect(rows.find((r) => r.id === 'bulldoze')!.selected).toBe(true);
  });

  it('flags affordability against the current effort', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 1000;
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    tech.unlock('parklets'); // grants build-48 (cost 8)
    const tools = availableTools(tech);

    const rich = toolbarRows(tools, null, 10);
    expect(rich.find((r) => r.id === 'build-48')!.affordable).toBe(true);
    expect(rich.find((r) => r.id === 'inspect')!.affordable).toBe(true); // free

    const broke = toolbarRows(tools, null, 0);
    expect(broke.find((r) => r.id === 'build-48')!.affordable).toBe(false);
    expect(broke.find((r) => r.id === 'bulldoze')!.affordable).toBe(false); // cost 1 > 0
    expect(broke.find((r) => r.id === 'inspect')!.affordable).toBe(true); // cost 0
  });

  it('updates the selected flag as selection moves, leaving labels stable', () => {
    const tools = [toolDef('inspect')!, toolDef('bulldoze')!, toolDef('build-5')!];
    const a = toolbarRows(tools, 'inspect', 50);
    const b = toolbarRows(tools, 'build-5', 50);
    expect(a.map((r) => r.label)).toEqual(b.map((r) => r.label)); // labels unchanged
    expect(a.find((r) => r.id === 'inspect')!.selected).toBe(true);
    expect(b.find((r) => r.id === 'build-5')!.selected).toBe(true);
    expect(b.find((r) => r.id === 'inspect')!.selected).toBe(false);
  });

  it('is a deterministic pure function of its inputs', () => {
    const tools = [toolDef('inspect')!, toolDef('build-48')!];
    expect(toolbarRows(tools, 'build-48', 30)).toEqual(toolbarRows(tools, 'build-48', 30));
  });
});
