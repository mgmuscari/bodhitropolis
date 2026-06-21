// GPU render path (Increment 1 of the hybrid shader): a WebGL2 canvas stacked UNDER the Canvas2D
// sprite/UI canvas. It renders the MAP via the SatelliteShader (procedural pass for now; baked-tile
// albedo is Increment 2), driven by the LIVE camera so it pans/zooms with the game. The Canvas2D
// layer goes transparent (renderer.setGpuMode) and draws only sprites/decorations/UI on top. The CPU
// path stays the no-WebGL fallback. Animations (water/grass/clouds/shadows) run on the GPU here, so
// the per-frame CPU water cost (Maddy's perf hit over large seas) goes away when GPU mode is on.
//
// IO module (touches WebGL/DOM) — not on the pure-ui allowlist.
import { GridTextureBridge } from './gridTextureBridge';
import { SatelliteShader } from './satelliteShader';
import type { GameMap } from '../engine/map';
import type { Camera } from './camera';

const SUN: readonly [number, number] = [0.65, 0.78]; // sun direction in tile space (shadows trace toward it)
const SHADOW = 0.45;
const DAYSPEED = 0.04; // slow sun rotation → a day/night shadow sweep (Maddy loved it); 0 = fixed

/** The live world→shader view: the visible window in world cells (matches the Canvas2D camera). */
export function cameraToShaderView(
  camera: Camera,
  cssWidth: number,
  cssHeight: number,
): { origin: [number, number]; view: [number, number] } {
  const ts = camera.tileSize;
  const o = camera.worldToScreen(0, 0); // screen px of world tile (0,0)
  return { origin: [-o.sx / ts, -o.sy / ts], view: [cssWidth / ts, cssHeight / ts] };
}

export class GpuRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private shader: SatelliteShader | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly bridge: GridTextureBridge;

  constructor(private readonly map: GameMap) {
    this.bridge = new GridTextureBridge(map.width, map.height);
    this.bridge.repackAll(map);
  }

  /** Create the WebGL2 canvas UNDER everything (z-index 0) and compile the shader. Throws if WebGL2
   *  is unavailable so the caller can fall back to the CPU path. */
  mount(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'gpu-base';
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0;';
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    document.body.prepend(canvas);
    this.canvas = canvas;
    this.gl = gl;
    this.shader = new SatelliteShader(gl);
    this.shader.uploadFull(this.bridge);
    return canvas;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (!this.canvas || !this.gl) return;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Re-pack the world grid (call on a built-layer change / markDirty). The upload happens lazily in
   *  render() via the bridge's dirty-rect; animation needs no repack (it's driven by u_time). */
  invalidate(): void {
    this.bridge.repackAll(this.map);
  }

  render(camera: Camera, cssWidth: number, cssHeight: number, timeSec: number): void {
    if (!this.shader || !this.gl) return;
    this.shader.uploadDirty(this.bridge);
    this.gl.clearColor(0.078, 0.071, 0.122, 1); // #14121f — matches the Canvas2D base bg out-of-map
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.shader.render({ time: timeSec, sun: SUN, shadow: SHADOW, origin, view, dayspeed: DAYSPEED });
  }

  dispose(): void {
    this.shader?.dispose();
    this.canvas?.remove();
    this.shader = null;
    this.gl = null;
    this.canvas = null;
  }
}
