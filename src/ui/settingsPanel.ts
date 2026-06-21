// Settings panel: the interactive DOM shell (toggled by the ',' key). Like techPanel/restorationPanel
// it owns DOM only — all data + clamping live in the pure settings.ts (presets, bounds), so there is
// no logic here worth unit-testing. Two setting classes, mirroring the determinism split:
//   • Performance (live caps) — applied INSTANTLY via onLiveChange (no regen);
//   • World (map size) — persisted via onWorldChange and applied on the NEXT load (regenerate), behind
//     an explicit confirm because reloading discards the in-progress city (there is no save).

import {
  CAP_PRESETS,
  MAP_SIZES,
  type LiveCaps,
  type MapSizeKey,
  type PresetTier,
  type RendererMode,
  type Settings,
  type WorldSettings,
} from './settings';
import { tilesetMetas } from './tileset';

export interface SettingsPanelHandle {
  /** Show/hide; returns the new visibility (the host refreshes nothing while hidden). */
  toggle(): boolean;
  visible(): boolean;
}

export interface SettingsPanelCallbacks {
  /** The current (already-clamped) settings, read fresh each time the panel opens. */
  getSettings(): Settings;
  /** A live-cap change to apply IMMEDIATELY (and persist). No world regen. */
  onLiveChange(live: LiveCaps): void;
  /** A world-setting change to persist; it takes effect on the next world load (regenerate). */
  onWorldChange(world: WorldSettings): void;
  /** A tileset (skin) change to apply IMMEDIATELY (hot-swap, no regen) and persist. */
  onTilesetChange(tileset: string): void;
  /** A render-path change (cpu ⇄ gpu) to apply IMMEDIATELY (mount/unmount the WebGL layer) and persist. */
  onRendererChange(renderer: RendererMode): void;
}

const PRESET_TIERS: PresetTier[] = ['low', 'medium', 'high'];
const MAP_KEYS: MapSizeKey[] = ['small', 'medium', 'large', 'huge'];

/** Which cap preset (if any) the live caps currently equal — drives the active-button highlight. */
function activeTier(live: LiveCaps): PresetTier | null {
  return PRESET_TIERS.find((t) => keysEqual(CAP_PRESETS[t], live)) ?? null;
}
function keysEqual(a: LiveCaps, b: LiveCaps): boolean {
  return (Object.keys(a) as (keyof LiveCaps)[]).every((k) => a[k] === b[k]);
}
/** The map-size key for a square width, or null when it's a custom/non-preset size. */
function mapKeyFor(width: number): MapSizeKey | null {
  return MAP_KEYS.find((k) => MAP_SIZES[k] === width) ?? null;
}

/** Build and mount the (hidden) settings panel. */
export function mountSettingsPanel(
  container: HTMLElement,
  cb: SettingsPanelCallbacks,
): SettingsPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.style.display = 'none';

  // Rebuilt from the current settings each open, so the controls always reflect live state.
  const render = (): void => {
    const s = cb.getSettings();
    panel.replaceChildren();

    const close = document.createElement('div');
    close.className = 'settings-panel__close';
    close.textContent = '✕';
    close.title = 'Close (,)';
    close.addEventListener('click', () => hide());
    panel.appendChild(close);

    const title = document.createElement('div');
    title.className = 'settings-panel__title';
    title.textContent = 'Settings';
    panel.appendChild(title);

    panel.appendChild(performanceSection(s));
    panel.appendChild(worldSection(s));
    panel.appendChild(tilesetSection(s));
    panel.appendChild(rendererSection(s));
  };

  // — Renderer (GPU hybrid shader ⇄ CPU), instant —
  const webgl2 = (): boolean => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  };
  const rendererSection = (s: Settings): HTMLElement => {
    const sec = section('Renderer — applies instantly');
    const r = row('Mode');
    const select = document.createElement('select');
    const has = webgl2();
    for (const [val, label] of [['gpu', 'GPU shader (WebGL2)'], ['cpu', 'CPU (Canvas2D)']] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label + (val === 'gpu' && !has ? ' — unavailable' : '');
      o.selected = s.renderer === val;
      if (val === 'gpu' && !has) o.disabled = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => cb.onRendererChange(select.value as RendererMode));
    r.appendChild(select);
    sec.appendChild(r);
    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = has
      ? 'GPU jeujés the baked tiles with water, shadows, day/night + clouds. CPU is the fallback.'
      : 'WebGL2 unavailable in this browser — using the CPU renderer.';
    sec.appendChild(note);
    return sec;
  };

  // — Performance (live caps, instant) —
  const performanceSection = (s: Settings): HTMLElement => {
    const sec = section('Performance — applies instantly');
    const active = activeTier(s.live);

    const presetRow = row('Preset');
    for (const tier of PRESET_TIERS) {
      const b = document.createElement('button');
      b.textContent = tier[0]!.toUpperCase() + tier.slice(1);
      if (tier === active) b.classList.add('is-active');
      b.addEventListener('click', () => {
        cb.onLiveChange({ ...CAP_PRESETS[tier] });
        render();
      });
      presetRow.appendChild(b);
    }
    sec.appendChild(presetRow);

    // Two most-impactful caps as direct inputs (the rest follow the preset).
    sec.appendChild(capInput('Pedestrians', 'pedCap', s.live));
    sec.appendChild(capInput('Cars', 'carCap', s.live));

    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = 'Higher = busier streets, heavier on slow machines. Low/Med/High set sensible bundles.';
    sec.appendChild(note);
    return sec;
  };

  const capInput = (label: string, key: 'pedCap' | 'carCap', live: LiveCaps): HTMLElement => {
    const r = row(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(live[key]);
    input.style.width = '5rem';
    const commit = (): void => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      cb.onLiveChange({ ...cb.getSettings().live, [key]: v });
      render(); // re-clamp + refresh the active-preset highlight
    };
    input.addEventListener('change', commit);
    r.appendChild(input);
    return r;
  };

  // — World (map size, regenerate on next load) —
  const worldSection = (s: Settings): HTMLElement => {
    const sec = section('World — new game');
    const r = row('Map size');
    const select = document.createElement('select');
    for (const k of MAP_KEYS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = `${k[0]!.toUpperCase() + k.slice(1)} (${MAP_SIZES[k]}²)`;
      if (mapKeyFor(s.world.mapWidth) === k) o.selected = true;
      select.appendChild(o);
    }
    r.appendChild(select);
    sec.appendChild(r);

    const apply = document.createElement('button');
    apply.textContent = 'Apply & regenerate';
    apply.addEventListener('click', () => {
      const k = select.value as MapSizeKey;
      const size = MAP_SIZES[k];
      cb.onWorldChange({ mapWidth: size, mapHeight: size });
      // Reload discards the in-progress city (no save) — make that explicit.
      if (window.confirm('Generate a new world at this size? The current city will be lost.')) {
        window.location.reload();
      }
    });
    const applyRow = row('');
    applyRow.appendChild(apply);
    sec.appendChild(applyRow);

    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = 'A new size is a different (still seeded) world — it regenerates on apply.';
    sec.appendChild(note);
    return sec;
  };

  // — Tileset (skin) — applied instantly via a renderer hot-swap (no regen). A partial/empty
  // tileset still runs: its missing keys fall back to the procedural painter (so selecting a
  // skin whose art hasn't landed yet just shows procedural).
  const tilesetSection = (s: Settings): HTMLElement => {
    const metas = tilesetMetas();
    const sec = section('Tileset — applies instantly');
    const r = row('Skin');
    const select = document.createElement('select');
    for (const m of metas) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      o.selected = s.tileset === m.id;
      select.appendChild(o);
    }
    select.addEventListener('change', () => cb.onTilesetChange(select.value));
    r.appendChild(select);
    sec.appendChild(r);

    const active = metas.find((m) => m.id === s.tileset) ?? metas[0]!;
    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = active.description;
    sec.appendChild(note);
    return sec;
  };

  const section = (heading: string): HTMLElement => {
    const sec = document.createElement('div');
    sec.className = 'settings-panel__section';
    const h = document.createElement('div');
    h.className = 'settings-panel__heading';
    h.textContent = heading;
    sec.appendChild(h);
    return sec;
  };
  const row = (label: string): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'settings-panel__row';
    const l = document.createElement('span');
    l.textContent = label;
    r.appendChild(l);
    return r;
  };

  container.appendChild(panel);

  let shown = false;
  const hide = (): void => {
    shown = false;
    panel.style.display = 'none';
  };
  return {
    toggle(): boolean {
      shown = !shown;
      if (shown) render(); // rebuild from current settings on open
      panel.style.display = shown ? 'block' : 'none';
      return shown;
    },
    visible(): boolean {
      return shown;
    },
  };
}
