// Input handling: pointer → pan / tool-apply, wheel → zoom-at-cursor, arrows →
// pan, hotkeys for tools. A thin DOM shell: it reads pointer events, calls the
// pure geometry (classifyPointer / lineTiles) and Camera, and dispatches to the
// host's tool hooks — it holds NO geometry of its own. All the determinism-
// sensitive logic lives in src/tools/inputGeometry.ts (tested) and the engine.
//
// Pan-vs-tool precedence (resolves the "drag still pans" vs "transport drag
// paints" tension): with no tool — or a non-line tool — selected, a drag PANS and
// a click applies at the tile; with a LINE tool (transport build / convert)
// selected, a drag PAINTS lineTiles (pan suppressed) and a click applies one tile.
// To pan with a line tool held, deselect (Escape) or hold the middle button.

import { Camera } from './camera';
import { classifyPointer, lineTiles } from '../tools/inputGeometry';

const ARROW_PAN_PX = 48;
const MIDDLE_BUTTON = 1;

export interface InputHandlers {
  /** Mark the view dirty after a pan/zoom. */
  onChange(): void;
  /** True iff a tool is currently selected (so clicks apply / hovers preview). */
  hasTool(): boolean;
  /** True iff the selected tool paints transport lines (drag paints, pan suppressed). */
  isLineTool(): boolean;
  /** Apply the selected tool at world tile (tx, ty). */
  applyAt(tx: number, ty: number): void;
  /** Preview the selected tool at the hovered world tile. */
  hover(tx: number, ty: number): void;
  /** Clear any hover preview (pointer left the canvas / tool deselected). */
  clearHover(): void;
  /** A tool hotkey was pressed (i = inspect, x = bulldoze, Escape = deselect). */
  onHotkey(action: 'inspect' | 'bulldoze' | 'deselect'): void;
}

export function attachInput(canvas: HTMLCanvasElement, camera: Camera, handlers: InputHandlers): void {
  let dragging = false;
  let suppressPan = false; // true during a line-tool drag (paint, don't pan)
  // The whole captured drag/click path is sourced from clientX/clientY, NOT
  // offsetX/offsetY: at pointerup the event is DISPATCHED while the pointer is
  // still captured (releasePointerCapture runs after, in-handler), and WebKit's
  // offset-under-capture behavior is the exact untested Safari risk — a mis-read
  // there would place a parcel on the WRONG tile, not just mis-pan. clientX/Y are
  // populated regardless of capture; classification needs only a delta (origin
  // cancels) and tile resolution converts client→canvas via getBoundingClientRect.
  // offsetX/Y survive only in the non-captured paths — the hover branch of
  // pointermove and the wheel handler — neither of which runs under pointer
  // capture, so offset is reliable there. downClientX/Y is the press anchor;
  // lastClientX/Y is the running pan reference.
  let downClientX = 0;
  let downClientY = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let hoverX = Number.NaN;
  let hoverY = Number.NaN;

  const tileUnder = (sx: number, sy: number): { tx: number; ty: number } => {
    const { wx, wy } = camera.screenToWorld(sx, sy);
    return { tx: Math.floor(wx), ty: Math.floor(wy) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    // Anchor both the press point (for click/drag classification + the line-tool
    // start tile) and the pan reference in client space — pointerdown is pre-capture
    // here, but keeping the pair client-relative makes classification compare like
    // with like against the (captured) pointerup point.
    downClientX = e.clientX;
    downClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    // A line tool paints on drag (pan suppressed); the middle button always pans.
    suppressPan = handlers.isLineTool() && e.button !== MIDDLE_BUTTON;
    // Pointer capture can throw (e.g. an invalid/stale pointerId in some browsers);
    // a failed capture must not abort the drag — pan still works off clientX/Y.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort; the drag proceeds regardless */
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* release is best-effort (capture may never have been granted) */
    }

    if (handlers.hasTool()) {
      // Classify from raw client deltas (origin-invariant, so capture can't skew it)
      // and resolve tiles from client→canvas coordinates via the bounding rect —
      // NOT offsetX/offsetY, which is unreliable while the pointer is still captured
      // at pointerup dispatch (the WebKit wrong-tile risk).
      const kind = classifyPointer(downClientX, downClientY, e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      const end = tileUnder(e.clientX - rect.left, e.clientY - rect.top);
      if (kind === 'click') {
        handlers.applyAt(end.tx, end.ty);
      } else if (suppressPan) {
        // Line-tool drag: paint every tile from the down tile to the up tile.
        const start = tileUnder(downClientX - rect.left, downClientY - rect.top);
        for (const t of lineTiles(start.tx, start.ty, end.tx, end.ty)) handlers.applyAt(t.x, t.y);
      }
      // A non-line tool drag was a pan (handled live in pointermove); nothing to apply.
    }
    suppressPan = false;
  });

  // Safety net: a window-level release clears the drag even if the canvas pointerup is missed (capture
  // not granted + released off-canvas). Fires AFTER the canvas handler for captured pointers, so it's a
  // no-op in the normal case and never applies a tool on its own.
  const endDrag = (): void => {
    dragging = false;
    suppressPan = false;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      // If a move arrives with NO button held, the pointerup was missed (capture failed + released
      // off-canvas) — stop the drag instead of panning forever with the cursor (Maddy playtest bug).
      if (e.buttons === 0) {
        dragging = false;
        suppressPan = false;
        return;
      }
      if (suppressPan) return; // line-tool paint drag: no pan
      // Capture-stable pan: delta from the last clientX/Y (NOT e.movementX/Y, which
      // is unreliable under capture in WebKit). camera.pan takes screen-pixel deltas.
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      camera.pan(dx, dy);
      // Drop the stale hover tint while panning — the world is sliding under the
      // cursor, so the last hovered tile is no longer where the pointer is. It
      // re-previews on the next (non-drag) move. Resetting hoverX/Y forces that
      // recompute even if the pointer lands back on the pre-pan tile.
      handlers.clearHover();
      hoverX = Number.NaN;
      hoverY = Number.NaN;
      handlers.onChange();
      return;
    }
    // Hover preview while a tool is selected, throttled to tile changes.
    if (!handlers.hasTool()) return;
    const { tx, ty } = tileUnder(e.offsetX, e.offsetY);
    if (tx !== hoverX || ty !== hoverY) {
      hoverX = tx;
      hoverY = ty;
      handlers.hover(tx, ty);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    hoverX = Number.NaN;
    hoverY = Number.NaN;
    handlers.clearHover();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? +1 : -1);
      handlers.onChange();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't shadow browser/OS shortcuts
    switch (e.key) {
      case 'ArrowLeft':
        camera.pan(ARROW_PAN_PX, 0);
        break;
      case 'ArrowRight':
        camera.pan(-ARROW_PAN_PX, 0);
        break;
      case 'ArrowUp':
        camera.pan(0, ARROW_PAN_PX);
        break;
      case 'ArrowDown':
        camera.pan(0, -ARROW_PAN_PX);
        break;
      case 'i':
      case 'I':
        handlers.onHotkey('inspect');
        return;
      case 'x':
      case 'X':
        handlers.onHotkey('bulldoze');
        return;
      case 'Escape':
        handlers.onHotkey('deselect');
        return;
      default:
        return;
    }
    handlers.onChange();
  });
}
