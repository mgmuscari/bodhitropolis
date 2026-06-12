// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop (the sim
// has no stages yet — it just exists and ticks). All DOM access is guarded so
// this module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { ecoSeedStage } from './worldgen/ecoseed';
import { parseChronicle } from './worldgen/chronicle';
import { buildReport } from './worldgen/report';
import { ecologyTick } from './ecology/tick';
import { ECO_CADENCE } from './ecology/influence';
import { ecologyReport } from './ecology/report';
import { biodiversityField } from './ecology/biodiversity';
import { Water } from './engine/map';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { attachInput } from './ui/input';
import { statLines, eraHeadline, challengeText, ecologyStatLine } from './ui/openingContent';
import {
  cycleOverlay,
  shouldCycleOverlay,
  overlayTint,
  legendLine,
  type OverlayState,
} from './ui/ecoOverlayContent';
import { mountOpening, type OpeningContent } from './ui/opening';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { accrue } from './tech/effort';
import { branchColumns, effortLine } from './ui/techContent';
import { mountTechPanel } from './ui/techPanel';
import { isTransportKind } from './engine/fabric';
import { availableTools, previewTool, applyTool, toolDef, type ToolId } from './tools/tools';
import { toolbarRows } from './ui/toolbarContent';
import { mountToolbar } from './ui/toolbar';

const DEFAULT_SEED = 'bodhitropolis';
const SIM_TICK_MS = 100;

export function main(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');

  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed') ?? DEFAULT_SEED;
  const world = runPipeline({ seed }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);

  // Tech-tree state: communal effort accrues into it each sim tick (see below).
  const tech = createTechState(TECH_TREE);

  // The opening overlay owns its own keydown and exposes no active-state; the
  // single composition root tracks whether it is up so the tech panel can
  // suppress its `T` toggle underneath it (init: up unless `?nointro=1`).
  let overlayActive = params.get('nointro') !== '1';

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

  // Opening challenge overlay. Computed from the same world, mounted over the
  // live map unless `?nointro=1`. The map input stays attached beneath; the
  // overlay captures pointer events until the player dismisses it (Begin /
  // Enter / Escape), after which the map is interactive.
  if (params.get('nointro') !== '1') {
    const name = cityName(createRng(seed).fork('city-name'));
    const chronicle = parseChronicle(world.log);
    const report = buildReport(world);
    // The eco-seed wound's DISPLAY half: surface it as a real opening stat line,
    // omitted (null) on the degenerate all-water / no-highway path.
    const ecoLine = ecologyStatLine(ecologyReport(world));
    const content: OpeningContent = {
      name,
      eras: chronicle.entries.map(eraHeadline),
      stats: ecoLine !== null ? [...statLines(report), ecoLine] : statLines(report),
      challenge: challengeText(name, report, chronicle),
    };
    mountOpening(document.body, content, () => {
      overlayActive = false;
      markDirty();
    });
  }

  // Tech panel: right-docked, toggled by `T`. Zero game imports — it receives its
  // content and the unlock action through deps. The `T` gate is suppressed while
  // the opening overlay is up (isOverlayActive), so it never toggles beneath it.
  const techPanel = mountTechPanel(document.body, {
    getContent: () => ({ effort: effortLine(tech), columns: branchColumns(TECH_TREE, tech) }),
    onUnlock: (id) => tech.unlock(id),
    isOverlayActive: () => overlayActive,
  });

  // panelDirty is DISTINCT from the canvas `dirty` flag: `dirty` drives only
  // renderer.render(world, camera); panelDirty drives a FULL panel re-derive so
  // nodes flip locked -> affordable as effort accrues, without needing a click.
  let panelDirty = false;

  // Tool state: the selected tool id (null = none). A "line tool" (transport build
  // 5..9 or any conversion) paints a dragged line; everything else is point-apply.
  let selectedToolId: ToolId | null = null;
  const isLineTool = (id: ToolId | null): boolean => {
    if (id === null) return false;
    if (id.startsWith('convert-')) return true;
    if (id.startsWith('build-')) {
      const def = toolDef(id);
      return def?.kind !== undefined && isTransportKind(def.kind);
    }
    return false;
  };

  // Bottom tool dock: always on, derived from tech grants + selection + effort.
  const toolbar = mountToolbar(document.body, {
    getRows: () => toolbarRows(availableTools(tech), selectedToolId, tech.effort),
    onSelect: (id) => {
      selectedToolId = id as ToolId;
      renderer.setPreview(null);
      toolbar.setStatus(null); // a prior inspect readout is stale on tool change
      dirty = true;
      toolbar.refresh();
    },
  });

  // Ecology heatmap overlay, cycled by E (off → soil → flora → fauna →
  // biodiversity → off). soil/flora/fauna sources read the LIVE layers, so they
  // auto-reflect each ecology tick; the DERIVED biodiversity field is recomputed
  // and re-pushed on each ecology tick while that view is active (plan review
  // MINOR-b). Water tiles are NOT tinted (tint → null): ecology lives on land —
  // water is habitat 0 / soil 0 by convention, not "the worst soil", so the
  // terrain water colour shows through unobscured.
  const overlayWater = world.map.water;
  let overlayState: OverlayState = null;
  const applyOverlay = (): void => {
    if (overlayState === null) {
      renderer.setOverlay(null);
      return;
    }
    if (overlayState === 'biodiversity') {
      const field = biodiversityField(world.map);
      renderer.setOverlay({
        tint: (i) => (overlayWater[i] !== Water.None ? null : overlayTint('biodiversity', field[i]!)),
      });
      return;
    }
    const view = overlayState;
    const layer =
      view === 'soil'
        ? world.map.soilHealth
        : view === 'flora'
          ? world.map.floraVitality
          : world.map.faunaPresence;
    renderer.setOverlay({
      tint: (i) => (overlayWater[i] !== Water.None ? null : overlayTint(view, layer[i]!)),
    });
  };

  // E self-binds (the tech panel's T pattern): its own keydown routed through the
  // pure shouldCycleOverlay gate, suppressed while the opening overlay is up. The
  // legend shares the dock status slot with the inspect readout — latest action
  // wins (a later inspect click overwrites it, and vice versa).
  window.addEventListener('keydown', (event) => {
    if (!shouldCycleOverlay(event.key, overlayActive)) return;
    event.preventDefault();
    overlayState = cycleOverlay(overlayState);
    applyOverlay();
    toolbar.setStatus(overlayState !== null ? legendLine(overlayState) : null);
    dirty = true;
  });

  const previewAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const p = previewTool(world, tech, def, tx, ty);
    renderer.setPreview([{ x: tx, y: ty, valid: p.valid }]);
    dirty = true;
  };

  const applyAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const r = applyTool(world, tech, def, tx, ty);
    // Inspect is free + non-mutating: surface its readout to the dock status line
    // (PRD: a minimal console-free line in the dock) without the mutate-path churn.
    if (def.id === 'inspect') {
      if (r.info !== undefined) toolbar.setStatus(r.info);
      return;
    }
    if (r.ok) {
      dirty = true;
      panelDirty = true; // effort changed → tech-panel affordability
      toolbar.refresh(); // effort changed → dock affordability
      previewAt(tx, ty); // re-tint the just-touched tile
    }
  };

  attachInput(canvas, camera, {
    onChange: markDirty,
    hasTool: () => selectedToolId !== null,
    isLineTool: () => isLineTool(selectedToolId),
    applyAt,
    hover: previewAt,
    clearHover: () => {
      renderer.setPreview(null);
      dirty = true;
    },
    onHotkey: (action) => {
      selectedToolId = action === 'inspect' ? 'inspect' : action === 'bulldoze' ? 'bulldoze' : null;
      renderer.setPreview(null);
      toolbar.setStatus(null);
      dirty = true;
      toolbar.refresh();
    },
  });

  // Refresh the dock's affordability when effort actually changes (it accrues each
  // sim tick); cheap, and avoids rebuilding the dock on idle frames.
  let lastEffort = tech.effort;

  window.addEventListener('resize', () => {
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    camera.setViewport(cssWidth, cssHeight);
    renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    markDirty();
  });

  // Simulation loop: communal effort accrues each tick — the first real per-tick
  // work. When the panel is open, the tick marks panelDirty so the next frame
  // re-derives its full content (node affordability tracks the rising effort).
  const sim = new FixedTickLoop(SIM_TICK_MS, (tick) => {
    accrue(tech, world, 1);
    if (techPanel.isOpen()) panelDirty = true;
    // Ecology cadence: the tick>0 guard lands the first ecology step at
    // tick = ECO_CADENCE, so the freshly-seeded state is the player's t0 and
    // dynamics begin one cadence interval later.
    if (tick > 0 && tick % ECO_CADENCE === 0) {
      ecologyTick(world.map);
      if (overlayState !== null) {
        // biodiversity is derived → recompute + re-push; soil/flora/fauna sources
        // read the live layers and need no recompute. Only mark dirty when the
        // overlay is active (no visual delta otherwise → avoid re-render churn).
        if (overlayState === 'biodiversity') applyOverlay();
        dirty = true;
      }
    }
  });
  let last = performance.now();
  const frame = (now: number): void => {
    sim.advance(now - last);
    last = now;
    if (dirty) {
      renderer.render(world, camera);
      dirty = false;
    }
    if (panelDirty) {
      techPanel.refresh();
      panelDirty = false;
    }
    if (tech.effort !== lastEffort) {
      toolbar.refresh();
      lastEffort = tech.effort;
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  main();
}
