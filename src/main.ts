// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop. The sim
// step is the composite orchestrator simTick (effort → ecology → civic); this
// shell only reads its deps for rendering. All DOM access is guarded so this
// module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { ecoSeedStage } from './worldgen/ecoseed';
import { parseChronicle } from './worldgen/chronicle';
import { buildReport } from './worldgen/report';
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
import { overlayTint, legendLine, type OverlayView } from './ui/ecoOverlayContent';
import {
  civicOverlayTint,
  civicLegendLine,
  cycleComposite,
  compositeKeyFor,
  type CompositeState,
  type CivicOverlayView,
  type OverlayKind,
} from './ui/civicOverlayContent';
import { pulseLine } from './ui/pulseContent';
import { mountPulseDock } from './ui/pulseDock';
import { isRepairTool } from './ui/repairTools';
import { mountOpening, type OpeningContent } from './ui/opening';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { wellbeing } from './tech/effort';
import { branchColumns, effortLine, panelSignature } from './ui/techContent';
import { mountTechPanel } from './ui/techPanel';
import { availableTools, previewTool, applyTool, toolDef, type ToolId } from './tools/tools';
import { isLineTool } from './ui/lineTools';
import { toolbarRows, refreshSignature, addedIds } from './ui/toolbarContent';
import { mountToolbar } from './ui/toolbar';
import { metaButtons } from './ui/dockContent';
import { computeNeighborhoods } from './civic/neighborhoods';
import { createCivicState } from './civic/state';
import { simTick, type SimDeps } from './civic/compose';

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

  // Civic state: the neighborhood partition + per-neighborhood belonging/voice/
  // trust. simTick refreshes the partition and remaps the state on the civic
  // cadence; this shell reads `deps.partition` to resolve a repair's tile.
  const partition = computeNeighborhoods(world.map);
  const civic = createCivicState(partition);
  const deps: SimDeps = { world, tech, civic, partition };

  // The latest sim tick, captured for the repair-forwarding hook (which fires
  // from pointer events, outside the sim loop).
  let currentTick = 0;

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
    // Cheap per-tick header source (no branchColumns derive) for refreshHeader (Y5).
    getEffort: () => effortLine(tech),
    onUnlock: (id) => {
      const ok = tech.unlock(id);
      if (ok) {
        // The panel re-renders itself (its delegated click listener). Refresh the
        // dock too — effort dropped (affordability) and an unlock may grant a new
        // tool — and snapshot both signatures so the next sim-gated check is a
        // no-op. The unlock FLASH still fires from the sim-gated addedIds path.
        toolbar.refresh();
        snapshotDock();
        snapshotPanel();
      }
      return ok;
    },
    isOverlayActive: () => overlayActive,
    // Y3: fired for the T key, the dock [Tech] button, AND any dismiss — keeps the
    // dock's [Tech] active-state in sync from ONE callback, off the rAF frame.
    onToggle: () => toolbar.refreshMeta(),
  });

  // Tool state: the selected tool id (null = none). A "line tool" (transport build
  // 5..9 or transport convert) paints a dragged line; everything else — building
  // build AND building convert (rezoning greens) — is point-apply. The predicate
  // lives in src/ui/lineTools.ts (pure, unit-tested); it reads the ToolDef's kind.
  let selectedToolId: ToolId | null = null;

  // The single composite overlay (eco | civic | null). Declared HERE — before the
  // dock mount — because the dock's getMetaButtons reads it at mount time and on
  // every refreshMeta. applyOverlay / cycleOverlay below own the transitions.
  let activeOverlay: CompositeState = null;

  // Bottom tool dock: always on, derived from tech grants + selection + effort. The
  // meta row ([Tech][Eco][Civic]) mirrors the T/E/C keys: getMetaButtons derives
  // the active flags from the live panel/overlay state; onMeta routes a click to
  // the SAME closures the keys use (techPanel.toggle / cycleOverlay).
  const toolbar = mountToolbar(document.body, {
    getRows: () => toolbarRows(availableTools(tech), selectedToolId, tech.effort),
    onSelect: (id) => {
      selectedToolId = id as ToolId;
      renderer.setPreview(null);
      toolbar.setStatus(null); // a prior inspect readout is stale on tool change
      dirty = true;
      toolbar.refresh();
      snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
    },
    getMetaButtons: () => metaButtons(techPanel.isOpen(), activeOverlay && { kind: activeOverlay.kind }),
    onMeta: (id) => {
      if (id === 'tech') techPanel.toggle();
      else cycleOverlay(id); // 'eco' | 'civic' — the SAME closure the E/C keys call
    },
  });

  // Sim-cadence gating (Y5): the heavy availableTools / branchColumns derivations +
  // signature compares run at most ONCE per frame, and only when a sim tick has
  // moved state (simChanged) — NOT every rAF frame. Discrete events (select /
  // hotkey / unlock) refresh directly and snapshot the signature so the immediately
  // following gated check is a no-op. prevToolIds is SEEDED from the initial rows
  // (Y7) so the first diff is empty → no spurious unlock flash on load.
  const initRows = toolbarRows(availableTools(tech), selectedToolId, tech.effort);
  let lastToolSig = refreshSignature(initRows);
  let prevToolIds: string[] = initRows.map((r) => r.id);
  let lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  let simChanged = false;

  const snapshotDock = (): void => {
    lastToolSig = refreshSignature(toolbarRows(availableTools(tech), selectedToolId, tech.effort));
  };
  const snapshotPanel = (): void => {
    lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  };

  // The sim-gated sync (run once per frame when simChanged): re-derive the dock
  // rows + signature and refresh ONLY on a real change; flash the dock when a new
  // tool id appears (Y7); while the panel is open, cheaply refresh its header each
  // tick and fully refresh only when the panel signature flips (a status change).
  const syncDock = (): void => {
    const rows = toolbarRows(availableTools(tech), selectedToolId, tech.effort);
    const sig = refreshSignature(rows);
    if (sig !== lastToolSig) {
      toolbar.refresh();
      lastToolSig = sig;
    }
    const ids = rows.map((r) => r.id);
    if (addedIds(prevToolIds, ids).length > 0) {
      toolbar.flash();
      prevToolIds = ids;
    }
    if (techPanel.isOpen()) {
      techPanel.refreshHeader();
      const psig = panelSignature(branchColumns(TECH_TREE, tech));
      if (psig !== lastPanelSig) {
        techPanel.refresh();
        lastPanelSig = psig;
      }
    }
  };

  // Always-on wellbeing pulse dock: its OWN dedicated element (not the shared
  // toolbar status, which inspect/legend clobber), refreshed on the civic cadence
  // only to avoid per-tick flicker. The trend compares to the previous cadence.
  const pulseDock = mountPulseDock(document.body);
  let prevWellbeing: number | null = null;
  const wellbeingNow = (): number =>
    wellbeing({ parcels: world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans });
  pulseDock.set(pulseLine(wellbeingNow(), null)); // initial: flat, no prior cadence

  // Composite heatmap overlay: a SINGLE active overlay (eco or civic, never both),
  // cycled by E (off → soil → flora → fauna → biodiversity → off) and C (off →
  // belonging → voice → trust → off). Pressing the other key replaces the active
  // overlay (exclusivity). Eco soil/flora/fauna read the LIVE layers; biodiversity
  // and every civic view are recomputed/re-pushed when their source ticks. Water
  // tiles are not tinted (eco lives on land); civic tiles with no neighborhood
  // (id 0) are not tinted.
  const overlayWater = world.map.water;
  const applyOverlay = (): void => {
    if (activeOverlay === null) {
      renderer.setOverlay(null);
      return;
    }
    if (activeOverlay.kind === 'civic') {
      const view = activeOverlay.view as CivicOverlayView;
      const count = deps.civic.count();
      const values = new Uint8Array(count); // per-neighborhood value, rebuilt per refresh
      for (let id = 1; id <= count; id++) {
        const v = deps.civic.getValues(id);
        values[id - 1] = view === 'belonging' ? v.belonging : view === 'voice' ? v.voice : v.trust;
      }
      const t2n = deps.partition.tileToNeighborhood;
      renderer.setOverlay({
        tint: (i) => {
          const id = t2n[i]!;
          return id === 0 ? null : civicOverlayTint(view, values[id - 1]!);
        },
      });
      return;
    }
    const view = activeOverlay.view as OverlayView;
    if (view === 'biodiversity') {
      const field = biodiversityField(world.map);
      renderer.setOverlay({
        tint: (i) => (overlayWater[i] !== Water.None ? null : overlayTint('biodiversity', field[i]!)),
      });
      return;
    }
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

  // The SHARED overlay-cycle body — one closure for BOTH the E/C keys and the dock
  // [Eco]/[Civic] buttons, so a key press and a button click can never diverge.
  // Cycles the single composite overlay, re-points the renderer, surfaces the
  // legend in the dock status slot, and refreshes the dock meta active-state.
  const cycleOverlay = (kind: OverlayKind): void => {
    activeOverlay = cycleComposite(activeOverlay, kind);
    applyOverlay();
    const legend =
      activeOverlay === null
        ? null
        : activeOverlay.kind === 'eco'
          ? legendLine(activeOverlay.view as OverlayView)
          : civicLegendLine(activeOverlay.view as CivicOverlayView);
    toolbar.setStatus(legend);
    dirty = true;
    toolbar.refreshMeta(); // the active overlay changed → dock [Eco]/[Civic] state
  };

  // E and C self-bind through the shared compositeKeyFor gate (suppressed while the
  // opening overlay is up); both delegate to cycleOverlay — the same body the dock
  // buttons call.
  window.addEventListener('keydown', (event) => {
    const kind = compositeKeyFor(event.key, overlayActive);
    if (kind === null) return;
    event.preventDefault();
    cycleOverlay(kind);
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
      // Effort changed → dock affordability + (if open) tech-panel affordability.
      // Refresh directly and snapshot both signatures so the next sim-gated check
      // is a no-op (the discrete-event path, per Y5).
      toolbar.refresh();
      snapshotDock();
      if (techPanel.isOpen()) {
        techPanel.refresh();
        snapshotPanel();
      }
      previewAt(tx, ty); // re-tint the just-touched tile
      // Repair forwarding (the sanctioned tools→civic crossing): a successful
      // repair-classified placement credits the anchor tile's neighborhood from
      // the LIVE partition. id 0 (no neighborhood) is a safe no-op; bulldoze is
      // excluded by isRepairTool. Multi-tile builds credit the anchor (tx, ty).
      if (isRepairTool(def)) {
        const nid = deps.partition.tileToNeighborhood[world.map.idx(tx, ty)] ?? 0;
        deps.civic.recordRepair(nid, currentTick);
      }
    }
  };

  attachInput(canvas, camera, {
    onChange: markDirty,
    hasTool: () => selectedToolId !== null,
    isLineTool: () => selectedToolId !== null && isLineTool(toolDef(selectedToolId)!),
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
      snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
    },
  });

  window.addEventListener('resize', () => {
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    camera.setViewport(cssWidth, cssHeight);
    renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    markDirty();
  });

  // Simulation loop: the composite orchestrator advances effort every tick and
  // ecology/civic on their cadences. Each tick sets simChanged so the next frame
  // re-derives the dock/panel signatures ONCE (~10Hz), not per rAF frame (Y5).
  // Overlays re-push on their source's tick; the pulse refreshes on the civic
  // cadence only.
  const sim = new FixedTickLoop(SIM_TICK_MS, (tick) => {
    currentTick = tick;
    const r = simTick(deps, tick);
    simChanged = true; // effort accrued / grants may have moved → re-sync next frame
    if (r.ecoTicked && activeOverlay?.kind === 'eco') {
      // biodiversity is derived → recompute + re-push; soil/flora/fauna read the
      // live layers and need no recompute.
      if (activeOverlay.view === 'biodiversity') applyOverlay();
      dirty = true;
    }
    if (r.civicTicked) {
      // the partition was refreshed/remapped and values changed → rebuild the
      // civic overlay against the new partition + values.
      if (activeOverlay?.kind === 'civic') {
        applyOverlay();
        dirty = true;
      }
      const wb = wellbeingNow();
      pulseDock.set(pulseLine(wb, prevWellbeing));
      prevWellbeing = wb;
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
    // Sim-gated (Y5): re-derive the dock/panel signatures + refresh on change ONLY
    // when a sim tick has run since the last sync — not every rAF frame.
    if (simChanged) {
      syncDock();
      simChanged = false;
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  main();
}
