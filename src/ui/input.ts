// Input handling: pointer drag → pan, wheel → zoom-at-cursor, arrows → pan.
// A thin DOM shell; all camera state changes go through Camera (tested).

import { Camera } from './camera';

const ARROW_PAN_PX = 48;

export function attachInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  onChange: () => void,
): void {
  let dragging = false;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camera.pan(e.movementX, e.movementY);
    onChange();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? +1 : -1);
      onChange();
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
      default:
        return;
    }
    onChange();
  });
}
