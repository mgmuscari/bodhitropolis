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
  let downSx = 0;
  let downSy = 0;
  let hoverX = Number.NaN;
  let hoverY = Number.NaN;

  const tileUnder = (sx: number, sy: number): { tx: number; ty: number } => {
    const { wx, wy } = camera.screenToWorld(sx, sy);
    return { tx: Math.floor(wx), ty: Math.floor(wy) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    downSx = e.offsetX;
    downSy = e.offsetY;
    // A line tool paints on drag (pan suppressed); the middle button always pans.
    suppressPan = handlers.isLineTool() && e.button !== MIDDLE_BUTTON;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);

    if (handlers.hasTool()) {
      const kind = classifyPointer(downSx, downSy, e.offsetX, e.offsetY);
      const end = tileUnder(e.offsetX, e.offsetY);
      if (kind === 'click') {
        handlers.applyAt(end.tx, end.ty);
      } else if (suppressPan) {
        // Line-tool drag: paint every tile from the down tile to the up tile.
        const start = tileUnder(downSx, downSy);
        for (const t of lineTiles(start.tx, start.ty, end.tx, end.ty)) handlers.applyAt(t.x, t.y);
      }
      // A non-line tool drag was a pan (handled live in pointermove); nothing to apply.
    }
    suppressPan = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      if (suppressPan) return; // line-tool paint drag: no pan
      camera.pan(e.movementX, e.movementY);
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
