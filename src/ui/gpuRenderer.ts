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
import { SpriteBatch, buildSpriteAtlas, FLOATS_PER_INSTANCE } from './spriteBatch';
import { DAYSPEED, dayNightBrightness } from './lighting';
import { laneOffset, dirVector } from './ambientContent';
import type { AmbientState } from './ambientContent';
import type { AmbientSprites } from './ambientSprites';
import type { GameMap } from '../engine/map';
import type { Camera } from './camera';

type Rect = readonly [number, number, number, number];

const SUN: readonly [number, number] = [0.65, 0.78]; // sun direction in tile space (shadows trace toward it)
const SHADOW = 0.45;

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
  private lastBaseVersion = -1;
  private readonly bridge: GridTextureBridge;
  // GPU sprite layer (the moving agents, lit by the SAME pass as the ground — Maddy).
  private batch: SpriteBatch | null = null;
  private carRects: (Rect | null)[] = [];
  private carLightRects: (Rect | null)[] = [];
  private instData = new Float32Array(0);

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
    this.batch = new SpriteBatch(gl);
    return canvas;
  }

  /** Build the GPU agent atlas from the loaded sprites (cars + their emission maps). Index-aligned with
   *  ambient car `tint`. Called when the sprite catalog loads/changes. */
  setAgentSprites(sprites: AmbientSprites): void {
    if (!this.batch) return;
    const entries: { name: string; img: CanvasImageSource }[] = [];
    sprites.cars.forEach((img, i) => entries.push({ name: `car${i}`, img }));
    sprites.carLights.forEach((img, i) => { if (img) entries.push({ name: `carL${i}`, img }); });
    if (entries.length === 0) return;
    const atlas = buildSpriteAtlas(entries);
    this.batch.setAtlas(atlas.canvas);
    this.carRects = sprites.cars.map((_, i) => atlas.rects.get(`car${i}`) ?? null);
    this.carLightRects = sprites.cars.map((_, i) => atlas.rects.get(`carL${i}`) ?? null);
  }

  /** Draw the moving agents as instanced quads in the base canvas (AFTER render()), lit by the shared
   *  lighting. Headlights/taillights are emission, night-gated; parked cars are off. */
  renderAgents(ambient: AmbientState, camera: Camera, cssWidth: number, cssHeight: number, timeSec: number): void {
    const gl = this.gl;
    if (!gl || !this.batch || this.carRects.length === 0) return;
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(timeSec)) / 0.3));
    const n = ambient.cars.length;
    if (this.instData.length < n * FLOATS_PER_INSTANCE) this.instData = new Float32Array(n * FLOATS_PER_INSTANCE);
    const data = this.instData;
    let count = 0;
    const nCars = this.carRects.length;
    for (const c of ambient.cars) {
      const ci = ((c.tint ?? 0) % nCars + nCars) % nCars;
      const rect = this.carRects[ci];
      if (!rect) continue;
      const off = c.parked ? { dx: 0, dy: 0 } : laneOffset(c.dir);
      const headingDir = c.parked && c.curbDir !== undefined ? (c.curbDir % 2 === 0 ? 1 : 0) : c.dir;
      const hv = dirVector(headingDir);
      const rot = Math.atan2(hv.dx, -hv.dy);
      const lightRect = c.parked ? null : this.carLightRects[ci];
      const emit = lightRect ? night : 0;
      const er = lightRect ?? rect;
      const o = count * FLOATS_PER_INSTANCE;
      data[o] = c.x + 0.5 + off.dx;
      data[o + 1] = c.y + 0.5 + off.dy;
      data[o + 2] = rot;
      data[o + 3] = 0.58;
      data[o + 4] = 0.58;
      data[o + 5] = rect[0]; data[o + 6] = rect[1]; data[o + 7] = rect[2]; data[o + 8] = rect[3];
      data[o + 9] = er[0]; data[o + 10] = er[1]; data[o + 11] = er[2]; data[o + 12] = er[3];
      data[o + 13] = emit;
      count++;
    }
    if (count === 0) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.batch.render(data, count, origin, view, timeSec, DAYSPEED);
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

  render(
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    base: TexImageSource,
    baseVersion: number,
  ): void {
    if (!this.shader || !this.gl) return;
    this.shader.uploadDirty(this.bridge);
    // Re-upload the CPU base (the baked per-cell tiles) as the albedo ONLY when it changed (camera
    // move / built edit) — not every frame. The animation runs on the GPU via u_time over this base.
    if (baseVersion !== this.lastBaseVersion) {
      this.shader.uploadBase(base);
      this.lastBaseVersion = baseVersion;
    }
    this.gl.clearColor(0.078, 0.071, 0.122, 1); // #14121f — matches the Canvas2D base bg out-of-map
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.shader.render({ time: timeSec, sun: SUN, shadow: SHADOW, origin, view, dayspeed: DAYSPEED });
  }

  /** Force a base re-upload on the next render (e.g. after a resize changes the base canvas size). */
  invalidateBase(): void {
    this.lastBaseVersion = -1;
  }


  dispose(): void {
    this.shader?.dispose();
    this.batch?.dispose();
    this.canvas?.remove();
    this.shader = null;
    this.batch = null;
    this.gl = null;
    this.canvas = null;
  }
}
