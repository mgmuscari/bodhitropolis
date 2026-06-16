// Toolbar dock: the thin DOM shell that renders the always-on bottom tool dock.
// It holds NO logic worth unit-testing — the row derivation (label/selected/
// affordable), the structural reconcile DECISION, the wholesale class strings, and
// the meta-button active flags are all PURE and tested in ui/toolbarContent.ts,
// ui/reconcile.ts, and ui/dockContent.ts. This shell only APPLIES those:
//   - reconcilePlan decides which tool buttons to create/delete; a button whose id
//     is unchanged is REUSED from a persistent Map (its identity — and any
//     in-flight click — preserved). This is the fix for the old shell that did
//     tools.replaceChildren() + fresh listeners ~10×/s, so a click could land on a
//     detached node;
//   - it sets el.className = toolbarToolClass(row) WHOLESALE so stale state classes
//     drop by construction;
//   - ONE delegated click listener per container, bound ONCE at mount, routes
//     clicks via closest('[data-tool-id]') / closest('[data-meta-id]') — listeners
//     are never rebuilt, so there is no per-render listener churn.
// ZERO game imports: rows + meta arrive as plain data via deps; selection and meta
// actions report back as plain id strings. It touches the DOM only inside
// mountToolbar, which main() calls only when `document` exists.

import { reconcilePlan } from './reconcile';
import { toolbarToolClass, type ToolbarRow } from './toolbarContent';
import type { MetaButton } from './dockContent';

export interface ToolbarDeps {
  /** Re-derive the current dock rows (assembled in main.ts from pure modules). */
  getRows(): ToolbarRow[];
  /** A tool row was clicked; the host updates selection then refreshes. */
  onSelect(id: string): void;
  /**
   * Re-derive the meta buttons ([Tech][Eco][Civic] + active flags). Optional so
   * the toolbar mounts before main wires it (the meta row is inert until then);
   * main supplies it in the wiring task.
   */
  getMetaButtons?(): MetaButton[];
  /** A meta button was clicked: toggle the tech panel / cycle an overlay / toggle
   *  ambient life. Optional (see above). */
  onMeta?(id: MetaButton['id']): void;
}

export interface ToolbarHandle {
  /** Re-derive and re-render the dock rows from getRows(). */
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

/**
 * Build and mount the bottom tool dock into `container`. Returns a handle so the
 * host can refresh the rows (selection / affordability changes), refresh the meta
 * buttons (panel + overlay active-state), flash the dock on an unlock, and set the
 * status line (the inspect / legend readout). Clicking a tool row calls
 * deps.onSelect(id); clicking a meta button calls deps.onMeta(id). The status line
 * is a sibling of the tool row, so refresh() never wipes it.
 */
export function mountToolbar(container: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const dock = document.createElement('div');
  dock.className = 'toolbar';

  const tools = document.createElement('div');
  tools.className = 'toolbar-tools';

  const meta = document.createElement('div');
  meta.className = 'toolbar-meta';

  const status = document.createElement('div');
  status.className = 'toolbar-status';
  status.hidden = true;

  dock.append(tools, meta, status);
  container.appendChild(dock);

  // Persistent node identity: a tool button is created once and REUSED until its
  // id leaves the rows. reconcilePlan decides create/delete; everything else is an
  // in-place update + a re-append (append MOVES an existing node, preserving its
  // identity and any in-flight click).
  const buttons = new Map<string, HTMLButtonElement>();
  const metaButtonEls = new Map<string, HTMLButtonElement>();

  function render(): void {
    const rows = deps.getRows();
    const plan = reconcilePlan([...buttons.keys()], rows);

    for (const id of plan.remove) {
      buttons.get(id)?.remove();
      buttons.delete(id);
    }
    for (const id of plan.insert) {
      const btn = document.createElement('button');
      btn.dataset.toolId = id;
      buttons.set(id, btn);
    }
    // Update EVERY row in place: wholesale className (drops stale state classes) +
    // label. Then re-append in order — no node is recreated on a no-delta plan.
    for (const row of rows) {
      const btn = buttons.get(row.id)!;
      btn.className = toolbarToolClass(row);
      btn.textContent = row.label;
    }
    for (const id of plan.order) tools.appendChild(buttons.get(id)!);
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
      // Wholesale className so the active highlight drops by construction.
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

  // ONE delegated listener per container, bound ONCE at mount (never per render).
  tools.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-tool-id]') as HTMLElement | null;
    const id = el?.dataset.toolId;
    if (id !== undefined) deps.onSelect(id);
  });
  meta.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-meta-id]') as HTMLElement | null;
    const id = el?.dataset.metaId;
    if (id !== undefined && META_IDS.has(id)) deps.onMeta?.(id as MetaButton['id']);
  });

  render();
  refreshMeta();

  return {
    refresh: render,
    setStatus,
    refreshMeta,
    flash,
  };
}
