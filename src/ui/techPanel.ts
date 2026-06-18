// Tech panel: the thin DOM shell that mounts the Civ-style tech TREE over the live
// map, toggled by `T` or the dock's [Tech] meta button. The structural decisions —
// node status, and the depth-column layout + prereq edges — are pure and tested in
// ui/techContent.ts and ui/techLayout.ts; this shell only positions the nodes and
// draws the connector lines. ZERO game imports: content arrives as plain data.
//
// APPLY, don't rebuild: the tree's node SET and POSITIONS are STATIC (the tree
// doesn't change shape mid-game — only each node's status flips), so the nodes +
// edges are built ONCE and every refresh REUSES them, setting el.className wholesale
// and recoloring each edge by whether its prereq is unlocked. ONE delegated click
// listener routes unlocks via closest('[data-node-id]').

import { techNodeClass } from './techContent';
import type { TechLayout } from './techLayout';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Grid metrics (px). Node cells flow left→right by depth; edges connect prereq
// right-center → dependent left-center.
const COL_W = 215;
const ROW_H = 98;
const NODE_W = 184;
const NODE_H = 76;
const PAD = 18;

/** Plain-data content for the panel (assembled in main.ts from pure modules). */
export interface TechPanelContent {
  effort: string;
  layout: TechLayout;
}

export interface TechPanelDeps {
  getContent(): TechPanelContent;
  /** Cheap header source: just the effort line, for refreshHeader each tick. Optional. */
  getEffort?(): string;
  /** Attempt to unlock a node; returns true if it succeeded (state changed). */
  onUnlock(id: string): boolean;
  /** Whether the opening overlay is currently up (suppresses the `T` toggle). */
  isOverlayActive(): boolean;
  /** Fired for every toggle so the host keeps the dock [Tech] active-state in sync. Optional. */
  onToggle?(open: boolean): void;
}

export interface TechPanelHandle {
  isOpen(): boolean;
  refresh(): void;
  toggle(): void;
  refreshHeader(): void;
}

interface NodeEls {
  nodeEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  flavorEl: HTMLDivElement;
  missingEl: HTMLDivElement | null;
}

/**
 * Build and mount the tech-tree panel into `container`, hidden until toggled. The
 * tree is a left→right DAG: roots on the left, each tech right of its prereqs, with
 * connector lines drawn under the nodes. Clicking an affordable node unlocks it and
 * the panel re-applies so status + edge colors flip live.
 */
export function mountTechPanel(container: HTMLElement, deps: TechPanelDeps): TechPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'tech-panel';
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'tech-panel-header';
  // Effort text + an always-visible CLOSE button. The button lives in the header (the panel's
  // top, which never scrolls), so the tree can be dismissed even when the panel covers the dock's
  // Tech toggle. Text goes in its own span so refreshing the effort never wipes the button.
  const effortText = document.createElement('span');
  effortText.className = 'tech-panel-effort';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tech-panel-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close tech tree');
  closeBtn.style.cssText = 'float:right; cursor:pointer; font-weight:bold; margin-left:12px;';
  closeBtn.addEventListener('click', () => setOpen(false));
  header.append(effortText, closeBtn);
  panel.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'tech-tree-wrap';
  panel.appendChild(wrap);

  const tree = document.createElement('div');
  tree.className = 'tech-tree';
  wrap.appendChild(tree);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'tech-edges');
  tree.appendChild(svg);

  container.appendChild(panel);

  let open = false;
  let built = false;
  const nodeMap = new Map<string, NodeEls>();
  const edgeMap = new Map<string, SVGLineElement>();

  // Cell geometry helpers.
  const leftOf = (col: number): number => PAD + col * COL_W;
  const topOf = (row: number): number => PAD + row * ROW_H;

  function buildTree(layout: TechLayout): void {
    const width = PAD * 2 + layout.cols * COL_W;
    const height = PAD * 2 + layout.rows * ROW_H;
    tree.style.width = `${width}px`;
    tree.style.height = `${height}px`;
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const cell = new Map(layout.nodes.map((n) => [n.view.id, n]));

    // Edges first (under the nodes): prereq right-center → dependent left-center.
    for (const e of layout.edges) {
      const a = cell.get(e.from);
      const b = cell.get(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', `${leftOf(a.col) + NODE_W}`);
      line.setAttribute('y1', `${topOf(a.row) + NODE_H / 2}`);
      line.setAttribute('x2', `${leftOf(b.col)}`);
      line.setAttribute('y2', `${topOf(b.row) + NODE_H / 2}`);
      line.setAttribute('class', 'tech-edge');
      svg.appendChild(line);
      edgeMap.set(`${e.from}->${e.to}`, line);
    }

    // Nodes, absolutely positioned by their grid cell.
    for (const n of layout.nodes) {
      const nodeEl = document.createElement('div');
      nodeEl.dataset.nodeId = n.view.id;
      nodeEl.style.position = 'absolute';
      nodeEl.style.left = `${leftOf(n.col)}px`;
      nodeEl.style.top = `${topOf(n.row)}px`;
      nodeEl.style.width = `${NODE_W}px`;

      const nameEl = document.createElement('div');
      nameEl.className = 'tech-node-name';
      const flavorEl = document.createElement('div');
      flavorEl.className = 'tech-node-flavor';
      nodeEl.append(nameEl, flavorEl);
      tree.appendChild(nodeEl);
      nodeMap.set(n.view.id, { nodeEl, nameEl, flavorEl, missingEl: null });
    }
    built = true;
  }

  function applyTree(layout: TechLayout): void {
    if (!built) buildTree(layout);
    const unlocked = new Set(
      layout.nodes.filter((n) => n.view.status === 'unlocked').map((n) => n.view.id),
    );
    for (const n of layout.nodes) {
      const els = nodeMap.get(n.view.id);
      if (!els) continue;
      els.nodeEl.className = techNodeClass(n.view);
      els.nameEl.textContent = `${n.view.name} · ${n.view.cost}`;
      els.flavorEl.textContent = n.view.flavor;
      if (n.view.missing.length > 0) {
        if (!els.missingEl) {
          const missEl = document.createElement('div');
          missEl.className = 'tech-node-missing';
          els.missingEl = missEl;
          els.nodeEl.appendChild(missEl);
        }
        els.missingEl.textContent = `Needs: ${n.view.missing.join(', ')}`;
      } else if (els.missingEl) {
        els.missingEl.remove();
        els.missingEl = null;
      }
    }
    // Recolor edges: a satisfied prereq (unlocked) reads as a live gold connection.
    for (const [key, line] of edgeMap) {
      const from = key.slice(0, key.indexOf('->'));
      line.setAttribute('class', unlocked.has(from) ? 'tech-edge tech-edge-active' : 'tech-edge');
    }
  }

  function render(): void {
    const content = deps.getContent();
    effortText.textContent = content.effort;
    applyTree(content.layout);
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !open;
    if (open) render();
    deps.onToggle?.(open);
  }

  function onKey(event: KeyboardEvent): void {
    const k = event.key;
    if ((k === 't' || k === 'T') && !deps.isOverlayActive()) {
      event.preventDefault();
      setOpen(!open);
    } else if (k === 'Escape' && open) {
      event.preventDefault();
      setOpen(false); // Escape always dismisses the panel, even when it covers the dock
    }
  }

  tree.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
    const id = el?.dataset.nodeId;
    if (id !== undefined && deps.onUnlock(id)) render();
  });

  window.addEventListener('keydown', onKey);

  return {
    isOpen: () => open,
    refresh: () => {
      if (open) render();
    },
    toggle: () => setOpen(!open),
    refreshHeader: () => {
      if (open) effortText.textContent = deps.getEffort ? deps.getEffort() : deps.getContent().effort;
    },
  };
}
