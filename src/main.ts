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
import { gradeLetter } from './worldgen/redline';
import { ecologyReport } from './ecology/report';
import { biodiversityField } from './ecology/biodiversity';
import { Water } from './engine/map';
import { isRoadKind } from './engine/fabric';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { createAmbientState, stepAmbient, setParkingLots, setHouseholds, setPlantEmitters, seedDecay, liveInspectLine } from './ui/ambientContent';
import { residentialCensus } from './citizens/census';
import { parkingLots, parkingStalls } from './ui/parkingContent';
import { attachInput } from './ui/input';
import { statLines, eraHeadline, challengeText, ecologyStatLine } from './ui/openingContent';
import { overlayTint, legendLine, ecoLegend, type OverlayView } from './ui/ecoOverlayContent';
import {
  civicOverlayTint,
  civicLegendLine,
  civicLegend,
  cycleComposite,
  compositeKeyFor,
  type CompositeState,
  type CivicOverlayView,
  type OverlayKind,
} from './ui/civicOverlayContent';
import { redlineOverlayTint, redlineLegendLine, redlineLegend } from './ui/redlineOverlayContent';
import { policeLegendLine, policeLegend } from './ui/policeViolenceOverlayContent';
import type { OverlayLegend } from './ui/overlayLegend';
import { pulseLine } from './ui/pulseContent';
import { mountPulseDock } from './ui/pulseDock';
import { isRepairTool } from './ui/repairTools';
import { mountOpening, type OpeningContent } from './ui/opening';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { wellbeing } from './tech/effort';
import { branchColumns, effortLine, panelSignature } from './ui/techContent';
import { techLayout } from './ui/techLayout';
import { mountTechPanel } from './ui/techPanel';
import { availableTools, previewTool, applyTool, toolDef, type ToolId } from './tools/tools';
import { isLineTool } from './ui/lineTools';
import { toolbarRows, refreshSignature, addedIds } from './ui/toolbarContent';
import { buildToolMenu, type ToolCategory } from './ui/toolMenuContent';
import { mountToolbar } from './ui/toolbar';
import { metaButtons } from './ui/dockContent';
import { computeNeighborhoods } from './civic/neighborhoods';
import { createCivicState } from './civic/state';
import { simTick, type SimDeps } from './civic/compose';
import { stepRevival } from './growth/revival';
import { computePowerGrid, plantOutput, isPowerConsumer, plantPollution } from './growth/power';

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
  const deps: SimDeps = { world, tech, civic, partition, seed };

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

  // Two named dirty chokepoints (CRITIC-YP2). markDirty invalidates the cached
  // renderer base (map/camera/overlay changed); markPreviewDirty only requests a
  // repaint (preview/selection changed — it lives in the per-frame composite, not
  // the base, so a hover never triggers an O(visible-tiles) base rebuild). Forward
  // rule: a base/camera/overlay change calls markDirty(); a preview/selection-only
  // change calls markPreviewDirty(); never a raw `dirty = true`.
  let dirty = true;
  const markDirty = (): void => {
    dirty = true;
    renderer.invalidateBase();
  };
  const markPreviewDirty = (): void => {
    dirty = true;
  };

  // Ambient life (purely visual, read-only). A SEPARATE rng fork + a SEPARATE clock
  // so ambient timing can never perturb the sim: the sim's `last` is owned by the
  // sim path alone (its FixedTickLoop clamp owns catch-up), and `lastAmbient` is
  // owned by the ambient path (its own stepAmbient clamp owns catch-up). Default on
  // (PRD Q2); the [Life] toggle / L key flip it. ambientOn=false restores the exact
  // legacy dirty-driven render path.
  let ambientOn = true;
  const ambientState = createAmbientState();
  const ambientRng = createRng(seed).fork('ambient');
  // Revival/decay rng: a stable stream for the slow-cadence growth seam (densify
  // draws). Forked off the world seed, independent of the ambient + sim streams.
  const revivalRng = createRng(seed).fork('revival');
  let lastAmbient = performance.now();

  // The parking lots that STORE the moving cars: a trip-car parks in the nearest one on
  // arrival (cars=trips, lots=storage). Each lot publishes its centre + stall grid.
  // Recomputed at startup and on each civic tick so it tracks the built layer as the
  // player rezones lots.
  const refreshParkingLots = (): void => {
    setParkingLots(
      ambientState,
      parkingLots(world.map).map((lot) => ({
        cx: (lot.x0 + lot.x1) / 2,
        cy: (lot.y0 + lot.y1) / 2,
        stalls: parkingStalls(lot),
      })),
    );
  };
  refreshParkingLots();

  // The residential census the ambient layer spawns daily-itinerary citizens from. Recomputed
  // at startup and on each civic tick so it tracks homes as the city grows/decays.
  const refreshHouseholds = (): void => {
    setHouseholds(ambientState, residentialCensus(world.parcels));
  };
  refreshHouseholds();

  // Power grid: a live DERIVED field (flood-fill from plants over the built layer,
  // capacity vs demand → which consumers are powered). Recomputed on placement + the
  // civic cadence; published to the renderer (unpowered consumers get a red pip) and
  // read by inspect. Derived from the hashed built layer → never hashed itself.
  let powerGrid = computePowerGrid(world.map, world.parcels);
  let powerSig = `${powerGrid.capacity}/${powerGrid.demand}/${powerGrid.poweredAnchors.size}`;
  const recomputePower = (): boolean => {
    powerGrid = computePowerGrid(world.map, world.parcels);
    renderer.setPowerGrid(powerGrid.poweredAnchors);
    const sig = `${powerGrid.capacity}/${powerGrid.demand}/${powerGrid.poweredAnchors.size}`;
    const changed = sig !== powerSig;
    powerSig = sig;
    return changed;
  };
  renderer.setPowerGrid(powerGrid.poweredAnchors);

  // Dirty-plant smog: publish the air-pollution emitters from the built layer (each
  // coal/gas plant smogs its footprint + a 2-tile plume). Recomputed on placement;
  // the live pollution field (cars + plants) drags land value → occupancy → revival,
  // so dirty power poisons what it powers and renewables read clean.
  const PLUME_RADIUS = 2;
  const recomputePlantEmitters = (): void => {
    const emitters: { tile: number; amount: number }[] = [];
    for (const idx of world.parcels.aliveIndices()) {
      const p = world.parcels.get(idx);
      const amt = plantPollution(p.kind);
      if (amt <= 0) continue;
      for (let yy = -PLUME_RADIUS; yy < p.height + PLUME_RADIUS; yy++) {
        for (let xx = -PLUME_RADIUS; xx < p.width + PLUME_RADIUS; xx++) {
          const tx = p.x + xx;
          const ty = p.y + yy;
          if (world.map.inBounds(tx, ty)) emitters.push({ tile: world.map.idx(tx, ty), amount: amt });
        }
      }
    }
    setPlantEmitters(ambientState, emitters);
  };
  recomputePlantEmitters();

  // The city starts DECAYED: a century of car-culture has already trampled the urban ground
  // into desire paths and polluted the shorelines, before the player arrives to heal it.
  seedDecay(ambientState, world.map);

  // Dev / live-pass affordance: a small global to drive the camera and inspect live
  // state from outside the input layer (e.g. screenshot tooling that needs to focus a
  // location). `zoomTo` mirrors the input path — move the camera, then markDirty so
  // the cached base rebuilds at the new view. `camera`/`world`/`ambient` are exposed
  // read handles (the running app's actual objects) so a live pass need not rebuild
  // the world in-page.
  (window as unknown as Record<string, unknown>).bodhitropolis = {
    zoomTo: (wx: number, wy: number, zoom?: number): void => {
      camera.centerOn(wx, wy, zoom);
      markDirty();
    },
    camera,
    world,
    ambient: ambientState,
    tech,
    power: () => powerGrid,
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
    getContent: () => ({ effort: effortLine(tech), layout: techLayout(TECH_TREE, tech) }),
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
  // Which category flyout is open in the dock (null = none). Toggled by clicking a
  // category tile; the picked tool stays selected with the flyout left open.
  let openCategory: ToolCategory | null = null;

  // The single composite overlay (eco | civic | null). Declared HERE — before the
  // dock mount — because the dock's getMetaButtons reads it at mount time and on
  // every refreshMeta. applyOverlay / cycleOverlay below own the transitions.
  let activeOverlay: CompositeState = null;

  // Bottom tool dock: always on, derived from tech grants + selection + effort. The
  // meta row ([Tech][Eco][Civic]) mirrors the T/E/C keys: getMetaButtons derives
  // the active flags from the live panel/overlay state; onMeta routes a click to
  // the SAME closures the keys use (techPanel.toggle / cycleOverlay).
  const toolbar = mountToolbar(document.body, {
    getMenu: () => buildToolMenu(availableTools(tech), selectedToolId, tech.effort, openCategory),
    onSelect: (id) => {
      selectedToolId = id as ToolId;
      renderer.setPreview(null);
      toolbar.setStatus(null); // a prior inspect readout is stale on tool change
      markPreviewDirty(); // selection-only: the preview lives in the composite
      toolbar.refresh();
      snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
    },
    onToggleCategory: (id) => {
      openCategory = openCategory === id ? null : id;
      toolbar.refresh();
    },
    getMetaButtons: () =>
      metaButtons(techPanel.isOpen(), activeOverlay && { kind: activeOverlay.kind }, ambientOn),
    onMeta: (id) => {
      if (id === 'tech') techPanel.toggle();
      else if (id === 'life') setAmbient(!ambientOn); // same toggle the L key calls
      else cycleOverlay(id); // 'eco' | 'civic' | 'redline' — the SAME closure the E/C/R keys call
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
  // Visible colour KEY for the active overlay — a swatch per ramp endpoint / band with its label,
  // so the eco/civic/redline/police maps are legible at a glance (not just a one-line caption).
  const legendEl = document.createElement('div');
  legendEl.className = 'overlay-legend';
  legendEl.hidden = true;
  legendEl.style.cssText =
    'position:fixed;left:12px;top:12px;z-index:50;background:rgba(20,22,30,0.82);color:#e8e6e0;' +
    'font:12px monospace;padding:6px 9px;border-radius:6px;pointer-events:none;line-height:1.5;';
  document.body.appendChild(legendEl);
  const updateLegend = (legend: OverlayLegend | null): void => {
    if (!legend) {
      legendEl.hidden = true;
      legendEl.textContent = '';
      return;
    }
    legendEl.hidden = false;
    legendEl.textContent = '';
    const title = document.createElement('div');
    title.textContent = legend.title;
    title.style.cssText = 'font-weight:bold;margin-bottom:3px;';
    legendEl.appendChild(title);
    for (const stop of legend.stops) {
      const row = document.createElement('div');
      const sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle;background:rgb(${stop.color[0]},${stop.color[1]},${stop.color[2]});`;
      const lbl = document.createElement('span');
      lbl.textContent = stop.label;
      row.append(sw, lbl);
      legendEl.appendChild(row);
    }
  };

  const overlayWater = world.map.water;
  const applyOverlay = (): void => {
    // Police violence is a LIVE field, drawn per-frame (not in the cached base) so it tracks
    // arrests + decay; every other kind clears that flag and uses the base overlay source.
    renderer.setLiveOverlay(activeOverlay?.kind === 'police' ? 'police' : null);
    if (activeOverlay === null || activeOverlay.kind === 'police') {
      renderer.setOverlay(null);
      return;
    }
    if (activeOverlay.kind === 'redline') {
      // The HOLC grade is a hashed map layer — tint land tiles by it directly.
      // Water carries a grade too (the near-water "cover" nudge), but tinting the
      // river/ocean red reads wrong, so land only — like the eco overlays.
      const redline = world.map.redline;
      renderer.setOverlay({
        tint: (i) => (overlayWater[i] !== Water.None ? null : redlineOverlayTint(redline[i]!)),
      });
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
          : activeOverlay.kind === 'redline'
            ? redlineLegendLine('grade')
            : activeOverlay.kind === 'police'
              ? policeLegendLine('violence')
              : civicLegendLine(activeOverlay.view as CivicOverlayView);
    toolbar.setStatus(legend);
    // The visible colour key for the active overlay (eco/civic ramps, redline bands, police ramp).
    updateLegend(
      activeOverlay === null
        ? null
        : activeOverlay.kind === 'eco'
          ? ecoLegend(activeOverlay.view as OverlayView)
          : activeOverlay.kind === 'civic'
            ? civicLegend(activeOverlay.view as CivicOverlayView)
            : activeOverlay.kind === 'redline'
              ? redlineLegend()
              : policeLegend(),
    );
    markDirty(); // the overlay tint lives in the cached base → invalidate it
    toolbar.refreshMeta(); // the active overlay changed → dock [Eco]/[Civic] state
  };

  // The [Life] ambient toggle — one closure for the L key AND (Task 4) the dock
  // [Life] button. Flips ambientOn, resets ONLY the ambient clock when turning ON
  // (so the first dt after a dormant period is small — also clamp-guarded), repaints
  // via markDirty, and refreshes the dock meta active-state.
  const setAmbient = (on: boolean): void => {
    ambientOn = on;
    if (on) lastAmbient = performance.now();
    markDirty();
    toolbar.refreshMeta();
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

  // L toggles ambient life, gated like E/C (suppressed while the opening overlay is
  // up so it never fires beneath it).
  window.addEventListener('keydown', (event) => {
    if (overlayActive) return;
    if (event.key !== 'l' && event.key !== 'L') return;
    event.preventDefault();
    setAmbient(!ambientOn);
  });

  const previewAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const p = previewTool(world, tech, def, tx, ty);
    renderer.setPreview([{ x: tx, y: ty, valid: p.valid }]);
    markPreviewDirty(); // hover tile-change: preview only, never a base rebuild
  };

  const applyAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const r = applyTool(world, tech, def, tx, ty);
    // Inspect is free + non-mutating: surface its readout to the dock status line
    // (PRD: a minimal console-free line in the dock) without the mutate-path churn.
    if (def.id === 'inspect') {
      // The pure readout NAMES the seeded tile; append the LIVE samples the ambient
      // layer carries. Population/health/land-value are keyed by the parcel ANCHOR
      // (resolve through the parcel store); traffic/smog by the clicked tile itself.
      let line = r.info ?? '';
      const i = world.map.idx(tx, ty);
      const pid = world.map.parcel[i];
      let anchor = i;
      if (pid) {
        const p = world.parcels.get(pid - 1);
        anchor = world.map.idx(p.x, p.y);
      }
      const live = liveInspectLine({
        occupancy: ambientState.occupancy.get(anchor),
        landValue: ambientState.landValue.get(anchor),
        health: ambientState.buildingHealth.get(anchor),
        traffic: ambientState.traffic.get(i),
        pollution: ambientState.pollution.get(i),
        // On a water tile, surface its contamination (the poisoned creek made legible).
        water: world.map.water[i] !== Water.None ? ambientState.waterPollution.get(i) : undefined,
        // On a road tile, surface its disrepair (redlined roads crumble).
        road: isRoadKind(world.map.built[i]!) ? ambientState.roadDecay.get(i) : undefined,
        // Where the police have done violence (arrests) — surfaced on any tile that carries it.
        violence: ambientState.policeViolence.get(i),
        // Fire/health service: is this inhabited plot within reach of a station?
        served: pid ? ambientState.coverage.has(anchor) : undefined,
      });
      if (live) line += ` · ${live}`;
      // Power status: a plant shows its output; a consumer shows powered/unpowered.
      const builtHere = world.map.built[i];
      const out = builtHere ? plantOutput(builtHere) : 0;
      if (out > 0) line += ` · output ${out}`;
      else if (pid && isPowerConsumer(world.parcels.kindAt(pid - 1))) {
        line += powerGrid.poweredAnchors.has(anchor) ? ' · powered' : ' · UNPOWERED';
      }
      // The HOLC redline grade of this ground — the apparatus's classification that
      // sited the burdens here. Land only (water carries a grade but it reads wrong).
      if (world.map.water[i] === Water.None) line += ` · redline ${gradeLetter(world.map.redline[i]!)}`;
      toolbar.setStatus(line);
      return;
    }
    if (r.ok) {
      recomputePower(); // built layer changed → re-derive the grid (a new plant lights its district)
      recomputePlantEmitters(); // a placed/bulldozed dirty plant changes the smog sources
      markDirty(); // mutated the built/parcel layer → rebuild the cached base
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
      markPreviewDirty(); // cleared the preview only — no base change
    },
    onHotkey: (action) => {
      selectedToolId = action === 'inspect' ? 'inspect' : action === 'bulldoze' ? 'bulldoze' : null;
      renderer.setPreview(null);
      toolbar.setStatus(null);
      markPreviewDirty(); // selection/preview only — preview is in the composite
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

  // Tab visibility: on becoming visible, reset ONLY the ambient clock (so the
  // ambient dt doesn't jump) and request a repaint. The sim's `last` is deliberately
  // NOT reset — its FixedTickLoop catch-up (a long hidden gap clamped to maxFrameMs)
  // must run exactly as today, keeping sim output byte-identical whether ambient is
  // on or off (AC#7). The ambient clamp already makes a missed reset harmless, so
  // this handler is for smoothness, not safety.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    lastAmbient = performance.now();
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
    // NOTE: the sim's abstract O-D trips (deps.trips) still lay the deterministic traffic-density
    // field that feeds growth/pollution/ped-routing, but they are NO LONGER visualised as ambient
    // cars. The visible traffic is the CITIZENS (owned cars + walkers/cyclists/transit riders), which
    // are persistent — they park and are walked to, never popping out of existence at a destination.
    // (ingestTrips is retained + tested for the trip→ambient path, just not driven from the sim here.)
    if (r.ecoTicked && activeOverlay?.kind === 'eco') {
      // biodiversity is derived → recompute + re-push; soil/flora/fauna read the
      // live layers and need no recompute.
      if (activeOverlay.view === 'biodiversity') applyOverlay();
      markDirty(); // eco overlay re-push changes the base tint → invalidate base
    }
    if (r.civicTicked) {
      // the partition was refreshed/remapped and values changed → rebuild the
      // civic overlay against the new partition + values.
      if (activeOverlay?.kind === 'civic') {
        applyOverlay();
        markDirty(); // civic overlay re-push changes the base tint → invalidate base
      }
      const wb = wellbeingNow();
      pulseDock.set(pulseLine(wb, prevWellbeing));
      prevWellbeing = wb;
      // Revival/decay seam: sample the LIVE occupancy into the hashed stock — thriving
      // homes heal + densify (R1→R2→R3), struggling ones crumble toward a derelict
      // ruin (reversibly). Runs HERE on the slow civic cadence (sim side), never in
      // stepAmbient (which must leave the world hash untouched) and never in simTick
      // (the N=120 gate pins its stock byte-stable). markDirty only on a real change.
      // Re-derive the grid FIRST so revival reads the current power state, then run
      // the seam: a powered home heals/densifies by occupancy; an unpowered one is
      // hard-gated (no growth, slow decay) until the player restores power.
      const powerChanged = recomputePower();
      const revived = stepRevival(
        world,
        (tile) => ambientState.occupancy.get(tile),
        revivalRng,
        (tile) => powerGrid.poweredAnchors.has(tile),
      );
      refreshParkingLots(); // the player may have rezoned a lot → refresh the storage set
      refreshHouseholds(); // homes may have grown/decayed → refresh who's out living their day
      if (revived > 0 || powerChanged) markDirty(); // stock/grid changed → rebuild base
    }
  });
  let last = performance.now();
  const frame = (now: number): void => {
    // Sim path is VERBATIM today's — two independent clocks (YP3): `last` drives the
    // sim (its FixedTickLoop clamp owns catch-up); never fold the ambient dt into it.
    sim.advance(now - last);
    last = now;
    if (ambientOn && !document.hidden) {
      // Continuous ambient path: step the ambient sim on its OWN clock (its Task-1
      // clamp owns catch-up), then composite + sprites. The base rebuilds inside
      // renderFrame iff invalidated, so this stays cheap.
      stepAmbient(ambientState, world.map, ambientRng, now - lastAmbient);
      lastAmbient = now;
      renderer.renderFrame(world, camera, ambientState);
      dirty = false;
    } else if (dirty) {
      // Legacy ambient-OFF path: repaint only when something changed (byte-identical
      // to today's render path).
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
