import { describe, it, expect } from 'vitest';
import { Camera, BASE_TILE, MIN_ZOOM, MAX_ZOOM } from '../../src/ui/camera';

function makeCamera(overrides: Partial<ConstructorParameters<typeof Camera>[0]> = {}) {
  return new Camera({
    mapWidth: 128,
    mapHeight: 128,
    viewportWidth: 640,
    viewportHeight: 480,
    x: 10,
    y: 10,
    zoom: 2,
    ...overrides,
  });
}

describe('Camera transforms', () => {
  it('tileSize is zoom * BASE_TILE', () => {
    const cam = makeCamera({ zoom: 3 });
    expect(cam.tileSize).toBe(3 * BASE_TILE);
  });

  it('worldToScreen/screenToWorld round-trip at every zoom level', () => {
    for (const zoom of [1, 2, 3, 4]) {
      const cam = makeCamera({ zoom, x: 12, y: 7 });
      const wx = 40.5;
      const wy = 22.25;
      const s = cam.worldToScreen(wx, wy);
      const w = cam.screenToWorld(s.sx, s.sy);
      expect(w.wx).toBeCloseTo(wx, 6);
      expect(w.wy).toBeCloseTo(wy, 6);
    }
  });
});

describe('Camera zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    // Large map, interior point -> clamping does not interfere.
    const cam = new Camera({
      mapWidth: 256,
      mapHeight: 256,
      viewportWidth: 640,
      viewportHeight: 480,
      x: 100,
      y: 100,
      zoom: 2,
    });
    const sx = 320;
    const sy = 240;
    const before = cam.screenToWorld(sx, sy);
    cam.zoomAt(sx, sy, +1);
    expect(cam.zoom).toBe(3);
    const after = cam.screenToWorld(sx, sy);
    expect(after.wx).toBeCloseTo(before.wx, 6);
    expect(after.wy).toBeCloseTo(before.wy, 6);
  });

  it('clamps zoom at the min and max levels', () => {
    const cam = makeCamera({ zoom: 1 });
    cam.zoomAt(0, 0, -1);
    expect(cam.zoom).toBe(1);

    const cam2 = makeCamera({ zoom: 4 });
    cam2.zoomAt(0, 0, +1);
    expect(cam2.zoom).toBe(4);
  });

  it('steps zoom one integer level at a time', () => {
    const cam = makeCamera({ zoom: 2 });
    cam.zoomAt(100, 100, +1);
    expect(cam.zoom).toBe(3);
    cam.zoomAt(100, 100, +1);
    expect(cam.zoom).toBe(4);
    cam.zoomAt(100, 100, -1);
    expect(cam.zoom).toBe(3);
  });
});

describe('Camera pan clamping', () => {
  // zoom 2 -> tileSize 32; viewport 640x480 -> 20x15 visible tiles;
  // maxX = 128 - 20 = 108, maxY = 128 - 15 = 113.
  it('clamps at the left/top edges', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(100000, 100000); // huge positive screen drag -> camera toward origin
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('clamps at the right/bottom edges', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(-100000, -100000);
    expect(cam.x).toBeCloseTo(108, 6);
    expect(cam.y).toBeCloseTo(113, 6);
  });

  it('pans freely within bounds', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(-32, -32); // one tile worth at zoom 2
    expect(cam.x).toBeCloseTo(51, 6);
    expect(cam.y).toBeCloseTo(51, 6);
  });
});

describe('Camera setViewport', () => {
  it('re-clamps an out-of-bounds position when the viewport grows', () => {
    // zoom 2 -> tileSize 32. Small 320px viewport -> 10 tiles visible,
    // maxX = maxY = 128 - 10 = 118, so x,y sit exactly on the far edge.
    const cam = new Camera({
      mapWidth: 128,
      mapHeight: 128,
      viewportWidth: 320,
      viewportHeight: 320,
      x: 118,
      y: 118,
      zoom: 2,
    });
    expect(cam.x).toBeCloseTo(118, 6);
    expect(cam.y).toBeCloseTo(118, 6);

    // Growing to 640px -> 20 tiles visible, maxX = maxY = 108. The prior
    // edge position is now out of bounds and must be re-clamped.
    cam.setViewport(640, 640);
    expect(cam.viewportWidth).toBe(640);
    expect(cam.viewportHeight).toBe(640);
    expect(cam.x).toBeCloseTo(108, 6);
    expect(cam.y).toBeCloseTo(108, 6);
  });
});

describe('Camera visibleTileRange', () => {
  it('reports the inclusive visible tile bounds, clamped to the map', () => {
    const cam = makeCamera({ x: 10, y: 10, zoom: 2 });
    const r = cam.visibleTileRange();
    expect(r.x0).toBe(10);
    expect(r.y0).toBe(10);
    expect(r.x1).toBeLessThanOrEqual(127);
    expect(r.y1).toBeLessThanOrEqual(127);
    expect(r.x1).toBeGreaterThan(r.x0);
  });
});

describe('Camera centerOn (zoom-to-location API)', () => {
  it('puts the target world tile at the viewport centre (interior, unclamped)', () => {
    const cam = makeCamera({ x: 0, y: 0, zoom: 2 });
    cam.centerOn(64, 64);
    const c = cam.screenToWorld(cam.viewportWidth / 2, cam.viewportHeight / 2);
    expect(c.wx).toBeCloseTo(64, 6);
    expect(c.wy).toBeCloseTo(64, 6);
  });

  it('sets zoom when given, rounded and clamped to [MIN_ZOOM, MAX_ZOOM]', () => {
    const cam = makeCamera();
    cam.centerOn(64, 64, 4);
    expect(cam.zoom).toBe(4);
    cam.centerOn(64, 64, 9);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.centerOn(64, 64, 0);
    expect(cam.zoom).toBe(MIN_ZOOM);
    cam.centerOn(64, 64, 2.6);
    expect(cam.zoom).toBe(3);
  });

  it('leaves zoom unchanged when omitted', () => {
    const cam = makeCamera({ zoom: 3 });
    cam.centerOn(64, 64);
    expect(cam.zoom).toBe(3);
  });

  it('clamps the view to the map at the corners', () => {
    const cam = makeCamera({ zoom: 2 });
    cam.centerOn(0, 0);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    cam.centerOn(1e6, 1e6);
    const ts = cam.tileSize;
    expect(cam.x).toBeCloseTo(cam.mapWidth - cam.viewportWidth / ts, 6);
    expect(cam.y).toBeCloseTo(cam.mapHeight - cam.viewportHeight / ts, 6);
  });
});
