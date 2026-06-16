import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore } from '../../src/engine/fabric';
import { Camera } from '../../src/ui/camera';
import { createAmbientState } from '../../src/ui/ambientContent';

// Headless backstop for the renderer cache split (CRITIC-YP8). The renderer is a
// DOM shell and the node test env has no jsdom, so pixel parity stays the live
// pass; these two tests pin the cache LOGIC behind a minimal `document` shim + a
// recording 2D context. A single shim serves both backstops (residual B).

// A no-op recording 2D context that satisfies buildAtlas (createImageData/
// putImageData) and the draw passes (setTransform/fillRect/drawImage/path ops).
function makeFakeContext(): unknown {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    setTransform() {},
    fillRect() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    save() {},
    restore() {},
    createImageData(w: number, h: number) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData() {},
  };
}

function makeFakeCanvas(): unknown {
  const ctx = makeFakeContext();
  return {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      return ctx;
    },
  };
}

// Stub the global document so buildAtlas (document.createElement('canvas')) and the
// Renderer constructor (offscreen base canvas) work headlessly.
vi.stubGlobal('document', {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
    return makeFakeCanvas();
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Imported AFTER the document stub so buildAtlas can run when Renderer constructs.
const { Renderer } = await import('../../src/ui/renderer');

function makeWorld() {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  return { map, parcels, seed: 'test', log: [] as string[] };
}

function makeCamera(): Camera {
  return new Camera({ mapWidth: 16, mapHeight: 16, viewportWidth: 320, viewportHeight: 240, zoom: 2 });
}

describe('renderer base-cache split: base dims track resize', () => {
  it('sizes the offscreen base to the backing-store dims (cssW*dpr)', () => {
    const r = new Renderer(makeFakeCanvas() as never);
    r.resize(800, 600, 2);
    const base = (r as unknown as { base: { width: number; height: number } }).base;
    expect(base.width).toBe(Math.round(800 * 2));
    expect(base.height).toBe(Math.round(600 * 2));
    r.resize(640, 480, 1.5);
    expect(base.width).toBe(Math.round(640 * 1.5));
    expect(base.height).toBe(Math.round(480 * 1.5));
  });
});

describe('renderer base-cache split: invalidateBase gates drawBase', () => {
  it('render() rebuilds the base only on the first frame and after invalidateBase', () => {
    const r = new Renderer(makeFakeCanvas() as never);
    r.resize(320, 240, 1);
    const world = makeWorld();
    const camera = makeCamera();
    const spy = vi.spyOn(r as unknown as { drawBase: () => void }, 'drawBase');
    r.render(world as never, camera);
    expect(spy).toHaveBeenCalledTimes(1); // first frame: base is dirty
    r.render(world as never, camera);
    expect(spy).toHaveBeenCalledTimes(1); // no invalidate → cached blit, NO rebuild
    r.invalidateBase();
    r.render(world as never, camera);
    expect(spy).toHaveBeenCalledTimes(2); // invalidated → rebuilt
  });

  it('renderFrame() rebuilds the base only on the first frame and after invalidateBase', () => {
    const r = new Renderer(makeFakeCanvas() as never);
    r.resize(320, 240, 1);
    const world = makeWorld();
    const camera = makeCamera();
    const ambient = createAmbientState();
    const spy = vi.spyOn(r as unknown as { drawBase: () => void }, 'drawBase');
    r.renderFrame(world as never, camera, ambient);
    expect(spy).toHaveBeenCalledTimes(1);
    r.renderFrame(world as never, camera, ambient);
    expect(spy).toHaveBeenCalledTimes(1); // sprite-only frame does NOT rebuild the base
    r.invalidateBase();
    r.renderFrame(world as never, camera, ambient);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
