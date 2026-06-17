// Toolbar dock: the thin DOM shell that renders the always-on tool dock. It holds
// NO logic worth unit-testing — the category bucketing, icon mapping, and the
// menu view-model are all PURE and tested in ui/toolMenuContent.ts; the meta-button
// flags in ui/dockContent.ts. This shell only APPLIES those.
//
// Layout (top→bottom): an open category's FLYOUT of tool tiles, then a main row of
// top-level MODES (inspect/bulldoze) + CATEGORY tiles (Transit … Energy), then the
// meta row ([Tech][Eco][Civic][Life]), then the status line. Clicking a category
// tile toggles its flyout; clicking a tool/mode selects it.
//
// Render discipline: render() runs only on discrete events (select / category
// toggle / unlock) and the sim-gated dirty check — NOT per frame — so it rebuilds
// the modes/categories/flyout content with replaceChildren. The click listeners are
// delegated to the STABLE containers (bound once at mount), so rebuilding their
// children never loses a click. ZERO game imports: content arrives as plain data.

import type { ToolMenuView, ToolCategory } from './toolMenuContent';
import type { MetaButton } from './dockContent';
import { clampDockPosition } from './dockLayout';

export interface ToolbarDeps {
  /** Re-derive the current dock view (assembled in main.ts from pure modules). */
  getMenu(): ToolMenuView;
  /** A tool/mode tile was clicked; the host updates selection then refreshes. */
  onSelect(id: string): void;
  /** A category tile was clicked; the host toggles which flyout is open then refreshes. */
  onToggleCategory(id: ToolCategory): void;
  /** Re-derive the meta buttons ([Tech][Eco][Civic][Life] + active flags). Optional. */
  getMetaButtons?(): MetaButton[];
  /** A meta button was clicked. Optional (wired in main's wiring task). */
  onMeta?(id: MetaButton['id']): void;
}

export interface ToolbarHandle {
  /** Re-derive and re-render the dock from getMenu(). */
  refresh(): void;
  /** Show (or clear with null) the minimal status line — e.g. the inspect readout. */
  setStatus(text: string | null): void;
  /** Re-derive and re-apply the meta buttons' labels + active state. */
  refreshMeta(): void;
  /** Pulse the dock to announce a freshly-unlocked tool. */
  flash(): void;
}

const FLASH_CLASS = 'toolbar-tool-flash';
const FLASH_MS = 1000;
const META_IDS: ReadonlySet<string> = new Set(['tech', 'eco', 'civic', 'life']);
const DOCK_POS_KEY = 'bodhi-dock-pos';

function modeButton(icon: string, label: string, selected: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = selected ? 'toolbar-mode toolbar-mode-selected' : 'toolbar-mode';
  btn.textContent = `${icon} ${label}`;
  return btn;
}

/**
 * Build and mount the tool dock into `container`. Returns a handle so the host can
 * refresh the dock (selection / affordability / open-category changes), refresh the
 * meta buttons, flash on an unlock, and set the status line. Clicking a tool calls
 * deps.onSelect(id); a category calls deps.onToggleCategory(id); a meta button
 * deps.onMeta(id). The status line is a sibling, so refresh never wipes it.
 */
export function mountToolbar(container: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const dock = document.createElement('div');
  dock.className = 'toolbar';

  // Drag grip: the dock's fixed bottom-center spot blocks the lower map once techs
  // unlock, so the player drags it out of the way. The grip is the only drag
  // surface (tool clicks must not move the dock); positioning math is the pure,
  // unit-tested clampDockPosition. The position persists across reloads.
  const grip = document.createElement('div');
  grip.className = 'toolbar-grip';
  grip.textContent = '⠿ drag';

  const flyout = document.createElement('div');
  flyout.className = 'toolbar-flyout';
  flyout.hidden = true;

  const mainRow = document.createElement('div');
  mainRow.className = 'toolbar-main';

  const modesEl = document.createElement('div');
  modesEl.className = 'toolbar-modes';

  const catsEl = document.createElement('div');
  catsEl.className = 'toolbar-cats';

  mainRow.append(modesEl, catsEl);

  const meta = document.createElement('div');
  meta.className = 'toolbar-meta';

  const status = document.createElement('div');
  status.className = 'toolbar-status';
  status.hidden = true;

  dock.append(grip, flyout, mainRow, meta, status);
  container.appendChild(dock);

  // Switch the dock from its default bottom-center anchor (CSS) to an absolute
  // top-left position. Called the first time it's dragged (or on restore).
  function applyPosition(x: number, y: number): void {
    dock.style.left = `${x}px`;
    dock.style.top = `${y}px`;
    dock.style.bottom = 'auto';
    dock.style.transform = 'none';
  }

  function persist(x: number, y: number): void {
    try {
      window.localStorage.setItem(DOCK_POS_KEY, JSON.stringify({ x, y }));
    } catch {
      /* storage may be unavailable (private mode) — dragging still works this session */
    }
  }

  // Grip drag: anchor the pointer offset within the dock, then move the dock to the
  // clamped pointer position on each move. window-level move/up so the drag survives
  // the pointer leaving the grip.
  let dragOffX = 0;
  let dragOffY = 0;
  const onMove = (e: PointerEvent): void => {
    const r = dock.getBoundingClientRect();
    const { x, y } = clampDockPosition(
      e.clientX - dragOffX,
      e.clientY - dragOffY,
      r.width,
      r.height,
      window.innerWidth,
      window.innerHeight,
    );
    applyPosition(x, y);
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const r = dock.getBoundingClientRect();
    persist(r.left, r.top);
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = dock.getBoundingClientRect();
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  const metaButtonEls = new Map<string, HTMLButtonElement>();

  function render(): void {
    const view = deps.getMenu();

    // Modes (inspect / bulldoze): always present, top-level.
    const modeEls = view.modes.map((m) => {
      const btn = modeButton(m.icon, m.label, m.selected);
      btn.dataset.toolId = m.id;
      return btn;
    });
    modesEl.replaceChildren(...modeEls);

    // Category tiles.
    const catEls = view.categories.map((c) => {
      const btn = document.createElement('button');
      let cls = 'toolbar-cat';
      if (c.active) cls += ' toolbar-cat-active';
      if (c.hasSelected) cls += ' toolbar-cat-hassel';
      btn.className = cls;
      btn.dataset.catId = c.id;
      btn.textContent = `${c.icon} ${c.label} (${c.count})`;
      return btn;
    });
    catsEl.replaceChildren(...catEls);

    // Flyout: the open category's tools (hidden when nothing is open).
    if (view.open === null || view.rows.length === 0) {
      flyout.replaceChildren();
      flyout.hidden = true;
    } else {
      const tiles = view.rows.map((r) => {
        const btn = document.createElement('button');
        let cls = 'toolbar-flyitem';
        if (r.selected) cls += ' toolbar-flyitem-selected';
        if (!r.affordable) cls += ' toolbar-flyitem-unaffordable';
        btn.className = cls;
        btn.dataset.toolId = r.id;
        btn.textContent = `${r.icon} ${r.label}`;
        return btn;
      });
      flyout.replaceChildren(...tiles);
      flyout.hidden = false;
    }
  }

  function refreshMeta(): void {
    const items = deps.getMetaButtons?.() ?? [];
    for (const m of items) {
      let btn = metaButtonEls.get(m.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.dataset.metaId = m.id;
        metaButtonEls.set(m.id, btn);
      }
      btn.className = m.active ? 'toolbar-meta-button toolbar-meta-active' : 'toolbar-meta-button';
      btn.textContent = m.label;
      meta.appendChild(btn);
    }
  }

  function setStatus(text: string | null): void {
    if (text === null) {
      status.hidden = true;
      status.textContent = '';
    } else {
      status.textContent = text;
      status.hidden = false;
    }
  }

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(): void {
    dock.classList.add(FLASH_CLASS);
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      dock.classList.remove(FLASH_CLASS);
      flashTimer = null;
    }, FLASH_MS);
  }

  // Delegated listeners on the STABLE containers (bound once). Rebuilding their
  // children via replaceChildren never detaches these, so no click is ever lost.
  const onToolClick = (e: Event): void => {
    const el = (e.target as HTMLElement).closest('[data-tool-id]') as HTMLElement | null;
    const id = el?.dataset.toolId;
    if (id !== undefined) deps.onSelect(id);
  };
  modesEl.addEventListener('click', onToolClick);
  flyout.addEventListener('click', onToolClick);
  catsEl.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null;
    const id = el?.dataset.catId;
    if (id !== undefined) deps.onToggleCategory(id as ToolCategory);
  });
  meta.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-meta-id]') as HTMLElement | null;
    const id = el?.dataset.metaId;
    if (id !== undefined && META_IDS.has(id)) deps.onMeta?.(id as MetaButton['id']);
  });

  render();
  refreshMeta();

  // Restore a persisted position (clamped to the current viewport — the window may
  // have been resized since). Done after the first render so the dock has a size.
  try {
    const saved = window.localStorage.getItem(DOCK_POS_KEY);
    if (saved) {
      const { x, y } = JSON.parse(saved) as { x: number; y: number };
      const r = dock.getBoundingClientRect();
      const c = clampDockPosition(x, y, r.width, r.height, window.innerWidth, window.innerHeight);
      applyPosition(c.x, c.y);
    }
  } catch {
    /* malformed/unavailable storage — keep the default bottom-center anchor */
  }

  return { refresh: render, setStatus, refreshMeta, flash };
}
