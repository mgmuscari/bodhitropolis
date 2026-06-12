// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop (the sim
// has no stages yet — it just exists and ticks). All DOM access is guarded so
// this module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { attachInput } from './ui/input';

const DEFAULT_SEED = 'bodhitropolis';
const SIM_TICK_MS = 100;

export function main(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');

  const seed = new URLSearchParams(window.location.search).get('seed') ?? DEFAULT_SEED;
  const world = runPipeline({ seed }, [terrainStage()]);

  let cssWidth = window.innerWidth;
  let cssHeight = window.innerHeight;
  const camera = new Camera({
    mapWidth: world.map.width,
    mapHeight: world.map.height,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    zoom: 2,
  });

  const renderer = new Renderer(canvas);
  renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);

  let dirty = true;
  const markDirty = (): void => {
    dirty = true;
  };

  attachInput(canvas, camera, markDirty);

  window.addEventListener('resize', () => {
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    camera.setViewport(cssWidth, cssHeight);
    renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    markDirty();
  });

  // Simulation loop is wired but has no stages yet; it just advances ticks.
  const sim = new FixedTickLoop(SIM_TICK_MS, () => {});
  let last = performance.now();
  const frame = (now: number): void => {
    sim.advance(now - last);
    last = now;
    if (dirty) {
      renderer.render(world.map, camera);
      dirty = false;
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  main();
}
