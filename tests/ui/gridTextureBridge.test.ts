import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { DATA_CHANNELS, SatType, satTypeAt } from '../../src/ui/satelliteFormat';
import { GridTextureBridge } from '../../src/ui/gridTextureBridge';

// GridTextureBridge is the WebGL twin of the renderer's drawBase invalidation: it
// owns the packed RGBA byte buffer the shader samples and a dirty-rect so only the
// changed region uploads via texSubImage2D. It is GL-agnostic and pure (the upload
// lives in satelliteShader) so the packing + dirty bookkeeping are unit-testable.

function fillTestWorld(m: GameMap): void {
  m.setWater(0, 0, Water.Ocean);
  m.setBuilt(2, 2, BuiltKind.Offices);
  m.setBuilt(3, 3, BuiltKind.RoadStreet);
}

describe('GridTextureBridge: allocation', () => {
  it('allocates width*height*4 bytes', () => {
    const b = new GridTextureBridge(4, 4);
    expect(b.width).toBe(4);
    expect(b.height).toBe(4);
    expect(b.data.length).toBe(4 * 4 * DATA_CHANNELS);
  });
});

describe('GridTextureBridge: repackAll', () => {
  it('packs every cell from the world', () => {
    const m = new GameMap(4, 4);
    fillTestWorld(m);
    const b = new GridTextureBridge(4, 4);
    b.repackAll(m);
    const at = (x: number, y: number) => b.data[(y * 4 + x) * DATA_CHANNELS]!;
    expect(at(0, 0)).toBe(SatType.Water);
    expect(at(2, 2)).toBe(SatType.Commercial);
    expect(at(3, 3)).toBe(SatType.Road);
    expect(at(1, 1)).toBe(SatType.Terrain);
  });

  it('marks the whole grid dirty, then clears', () => {
    const m = new GameMap(4, 4);
    const b = new GridTextureBridge(4, 4);
    b.repackAll(m);
    expect(b.consumeDirty()).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(b.consumeDirty()).toBeNull();
  });
});

describe('GridTextureBridge: incremental repack', () => {
  it('repackCell matches the bytes repackAll would write', () => {
    const m = new GameMap(4, 4);
    fillTestWorld(m);
    const full = new GridTextureBridge(4, 4);
    full.repackAll(m);

    const inc = new GridTextureBridge(4, 4);
    inc.repackCell(m, 2, 2);
    const off = (2 * 4 + 2) * DATA_CHANNELS;
    for (let c = 0; c < DATA_CHANNELS; c++) {
      expect(inc.data[off + c]).toBe(full.data[off + c]);
    }
  });

  it('a single cell edit dirties only that cell', () => {
    const m = new GameMap(4, 4);
    const b = new GridTextureBridge(4, 4);
    b.repackAll(m);
    b.consumeDirty(); // clear the full-grid dirty from the initial pack

    m.setBuilt(2, 1, BuiltKind.HouseSingle);
    b.repackCell(m, 2, 1);
    expect(b.consumeDirty()).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it('multiple edits dirty their bounding rectangle', () => {
    const m = new GameMap(8, 8);
    const b = new GridTextureBridge(8, 8);
    b.repackAll(m);
    b.consumeDirty();

    b.repackCell(m, 1, 1);
    b.repackCell(m, 3, 2);
    expect(b.consumeDirty()).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });

  it('updates the packed bytes on edit so the type changes', () => {
    const m = new GameMap(4, 4);
    const b = new GridTextureBridge(4, 4);
    b.repackAll(m);
    const off = (1 * 4 + 1) * DATA_CHANNELS;
    expect(b.data[off]).toBe(SatType.Terrain);

    m.setBuilt(1, 1, BuiltKind.Industrial);
    b.repackCell(m, 1, 1);
    expect(b.data[off]).toBe(satTypeAt(m, 1, 1));
    expect(b.data[off]).toBe(SatType.Industrial);
  });
});
