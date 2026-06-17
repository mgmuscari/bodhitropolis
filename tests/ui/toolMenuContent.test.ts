// PR D1 — the pure view-model behind the categorized pictorial tool dock.

import { describe, it, expect } from 'vitest';
import {
  categoryOf,
  toolIcon,
  buildToolMenu,
  CATEGORY_ORDER,
  type ToolCategory,
} from '../../src/ui/toolMenuContent';
import { availableTools, toolDef } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

function freshTech(effort: number) {
  const t = createTechState(TECH_TREE);
  t.effort = effort;
  return t;
}

describe('categoryOf', () => {
  it('puts modes (inspect/bulldoze) in no category', () => {
    expect(categoryOf(toolDef('inspect')!)).toBeNull();
    expect(categoryOf(toolDef('bulldoze')!)).toBeNull();
  });

  it('routes transport builds and converts to transit', () => {
    expect(categoryOf(toolDef('build-1')!)).toBe('transit'); // Street
    expect(categoryOf(toolDef('build-4')!)).toBe('transit'); // Rail
    expect(categoryOf(toolDef('build-5')!)).toBe('transit'); // BikePath
  });

  it('routes building kinds to their category', () => {
    expect(categoryOf(toolDef('build-16')!)).toBe('residential');
    expect(categoryOf(toolDef('build-19')!)).toBe('commercial');
    expect(categoryOf(toolDef('build-21')!)).toBe('industrial');
    expect(categoryOf(toolDef('build-23')!)).toBe('civic');
    expect(categoryOf(toolDef('build-48')!)).toBe('green'); // Parklet
    expect(categoryOf(toolDef('build-53')!)).toBe('energy'); // EnergyNode
  });
});

describe('toolIcon', () => {
  it('gives modes and kinds distinct pictorial glyphs', () => {
    expect(toolIcon(toolDef('inspect')!)).toBe('🔍');
    expect(toolIcon(toolDef('bulldoze')!)).toBe('🧨');
    expect(toolIcon(toolDef('build-4')!)).toBe('🚆'); // Rail
    expect(toolIcon(toolDef('build-16')!)).toBe('🏠');
    expect(toolIcon(toolDef('build-53')!)).toBe('⚡'); // EnergyNode
  });
});

describe('buildToolMenu', () => {
  it('with nothing unlocked: modes + classic categories, nothing open', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, null);
    expect(view.modes.map((m) => m.id)).toEqual(['inspect', 'bulldoze']);
    const cats = view.categories.map((c) => c.id);
    expect(cats).toContain('transit');
    expect(cats).toContain('residential');
    expect(cats).toContain('commercial');
    expect(cats).toContain('industrial');
    expect(cats).toContain('civic');
    expect(view.open).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('lists categories in fixed CATEGORY_ORDER', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, null);
    const order = view.categories.map((c) => c.id);
    const expected = CATEGORY_ORDER.filter((c) => order.includes(c));
    expect(order).toEqual(expected);
  });

  it('opening a category yields its tools as rows and flags it active', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 100, 'transit');
    expect(view.open).toBe('transit');
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((r) => r.id.startsWith('build-') || r.id.startsWith('convert-'))).toBe(true);
    const transit = view.categories.find((c) => c.id === 'transit')!;
    expect(transit.active).toBe(true);
    expect(transit.count).toBe(view.rows.length);
  });

  it('marks a category hasSelected when it holds the selected tool', () => {
    const view = buildToolMenu(availableTools(freshTech(100)), 'build-16', 100, null);
    const res = view.categories.find((c) => c.id === 'residential')!;
    expect(res.hasSelected).toBe(true);
    expect(view.categories.find((c) => c.id === 'transit')!.hasSelected).toBe(false);
  });

  it('marks affordability per tool by effort', () => {
    const view = buildToolMenu(availableTools(freshTech(3)), null, 3, 'transit');
    const street = view.rows.find((r) => r.id === 'build-1')!; // cost 2
    const highway = view.rows.find((r) => r.id === 'build-3')!; // cost 5
    expect(street.affordable).toBe(true);
    expect(highway.affordable).toBe(false);
  });

  it('drops an empty/unknown open category back to null', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, 'energy' as ToolCategory);
    // energy has no tools unlocked at tech 0 → no flyout
    expect(view.open).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('surfaces a tech-unlocked category once its kind is granted', () => {
    const tech = freshTech(1000);
    expect(buildToolMenu(availableTools(tech), null, 1000, null).categories.map((c) => c.id)).not.toContain(
      'energy',
    );
    tech.unlock('sun-and-wire');
    tech.unlock('renewable-energy');
    tech.unlock('local-grids');
    tech.unlock('community-energy-nodes'); // grants EnergyNode
    expect(buildToolMenu(availableTools(tech), null, 1000, null).categories.map((c) => c.id)).toContain(
      'energy',
    );
  });
});
