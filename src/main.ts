// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop (the sim
// has no stages yet — it just exists and ticks). All DOM access is guarded so
// this module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { parseChronicle } from './worldgen/chronicle';
import { buildReport } from './worldgen/report';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { attachInput } from './ui/input';
import { statLines, eraHeadline, challengeText } from './ui/openingContent';
import { mountOpening, type OpeningContent } from './ui/opening';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { accrue } from './tech/effort';

const DEFAULT_SEED = 'bodhitropolis';
const SIM_TICK_MS = 100;

export function main(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');

  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed') ?? DEFAULT_SEED;
  const world = runPipeline({ seed }, [terrainStage(), mosesCenturyStage()]);

  // Tech-tree state: communal effort accrues into it each sim tick (see below).
  const tech = createTechState(TECH_TREE);

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

  // Opening challenge overlay. Computed from the same world, mounted over the
  // live map unless `?nointro=1`. The map input stays attached beneath; the
  // overlay captures pointer events until the player dismisses it (Begin /
  // Enter / Escape), after which the map is interactive.
  if (params.get('nointro') !== '1') {
    const name = cityName(createRng(seed).fork('city-name'));
    const chronicle = parseChronicle(world.log);
    const report = buildReport(world);
    const content: OpeningContent = {
      name,
      eras: chronicle.entries.map(eraHeadline),
      stats: statLines(report),
      challenge: challengeText(name, report, chronicle),
    };
    mountOpening(document.body, content, markDirty);
  }

  window.addEventListener('resize', () => {
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    camera.setViewport(cssWidth, cssHeight);
    renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    markDirty();
  });

  // Simulation loop: communal effort accrues each tick — the first real
  // per-tick work. The tech panel and its separate panelDirty refresh flag are
  // wired in a later task (they land together so the flag has a consumer); for
  // now the tick just funds the tech state, untouched by the canvas `dirty` flag.
  const sim = new FixedTickLoop(SIM_TICK_MS, () => {
    accrue(tech, world, 1);
  });
  let last = performance.now();
  const frame = (now: number): void => {
    sim.advance(now - last);
    last = now;
    if (dirty) {
      renderer.render(world, camera);
      dirty = false;
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  main();
}
