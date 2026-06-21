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
import { SpriteBatch, buildSpriteAtlas, FLOATS_PER_INSTANCE, GlowBatch, GLOW_FLOATS, extractLightPoints } from './spriteBatch';
import type { LightPoint } from './spriteBatch';
import { DAYSPEED, dayNightBrightness } from './lighting';
import { laneOffset, dirVector, pedCurbOffset } from './ambientContent';
import { isRoadKind } from '../engine/fabric';
import { TravelMode } from '../citizens/modes';
import type { AmbientState } from './ambientContent';
import type { AmbientSprites } from './ambientSprites';
import type { GameMap } from '../engine/map';
import type { Camera } from './camera';

type Rect = readonly [number, number, number, number];
/** A light-bearing building footprint (world coords) — the renderer collects these; the glow pass casts
 *  a faint window/beacon glow from each (Maddy: windows/hazard blinkies should cast glows too). */
export type EmissiveBuilding = { x: number; y: number; w: number; h: number; kind: number };

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
  private pedRects: (Rect | null)[] = [];
  private cycRects: (Rect | null)[] = [];
  private cycLightRects: (Rect | null)[] = [];
  private cruiserRect: Rect | null = null;
  private cruiserLightRect: Rect | null = null;
  private instData = new Float32Array(0);
  private glow: GlowBatch | null = null;
  private glowData = new Float32Array(0);
  // Emissive light POINTS (the actual lit pixels) per asset, so glow casts from real lights not centers.
  private carPoints: (LightPoint[] | null)[] = [];
  private cruiserPoints: LightPoint[] = [];
  private buildingPoints = new Map<string, { lights: LightPoint[]; blink: LightPoint[] }>();

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
    this.glow = new GlowBatch(gl);
    return canvas;
  }

  /** Build the GPU agent atlas from the loaded sprites (cars + their emission maps). Index-aligned with
   *  ambient car `tint`. Called when the sprite catalog loads/changes. */
  setAgentSprites(sprites: AmbientSprites): void {
    if (!this.batch) return;
    const entries: { name: string; img: CanvasImageSource }[] = [];
    sprites.cars.forEach((img, i) => entries.push({ name: `car${i}`, img }));
    sprites.carLights.forEach((img, i) => { if (img) entries.push({ name: `carL${i}`, img }); });
    sprites.peds.forEach((img, i) => entries.push({ name: `ped${i}`, img }));
    sprites.cyclists.forEach((img, i) => entries.push({ name: `cyc${i}`, img }));
    sprites.cyclistLights.forEach((img, i) => { if (img) entries.push({ name: `cycL${i}`, img }); });
    if (sprites.police[0]) entries.push({ name: 'cruiser', img: sprites.police[0] });
    if (sprites.emission['police/cruiser']) entries.push({ name: 'cruiserL', img: sprites.emission['police/cruiser'] });
    if (entries.length === 0) return;
    const atlas = buildSpriteAtlas(entries);
    this.batch.setAtlas(atlas.canvas);
    this.carRects = sprites.cars.map((_, i) => atlas.rects.get(`car${i}`) ?? null);
    this.carLightRects = sprites.cars.map((_, i) => atlas.rects.get(`carL${i}`) ?? null);
    this.pedRects = sprites.peds.map((_, i) => atlas.rects.get(`ped${i}`) ?? null);
    this.cycRects = sprites.cyclists.map((_, i) => atlas.rects.get(`cyc${i}`) ?? null);
    this.cycLightRects = sprites.cyclists.map((_, i) => atlas.rects.get(`cycL${i}`) ?? null);
    this.cruiserRect = atlas.rects.get('cruiser') ?? null;
    this.cruiserLightRect = atlas.rects.get('cruiserL') ?? null;
    // Extract the bright light POINTS so glow casts from the real lit pixels (Maddy: movers get forward
    // cones for their static headlights; buildings get radial glow from the light map).
    this.carPoints = sprites.cars.map((_, i) => { const im = sprites.carLights[i]; return im ? extractLightPoints(im) : null; });
    this.cruiserPoints = sprites.emission['police/cruiser'] ? extractLightPoints(sprites.emission['police/cruiser']) : [];
    this.buildingPoints.clear();
    for (const [key, img] of Object.entries(sprites.emission)) {
      if (!key.startsWith('building/')) continue;
      const isBlink = key.endsWith('/blink');
      const stem = key.slice('building/'.length).replace(/\/blink$/, '');
      const e = this.buildingPoints.get(stem) ?? { lights: [], blink: [] };
      const pts = extractLightPoints(img, 8, 0.26, 8); // buildings: more windows
      if (isBlink) e.blink = pts; else e.lights = pts;
      this.buildingPoints.set(stem, e);
    }
  }

  /** Draw the moving agents as instanced quads in the base canvas (AFTER render()), lit by the shared
   *  lighting. Headlights/taillights are emission, night-gated; parked cars are off. */
  renderAgents(ambient: AmbientState, camera: Camera, cssWidth: number, cssHeight: number, timeSec: number, buildings: readonly EmissiveBuilding[] = []): void {
    const gl = this.gl;
    if (!gl || !this.batch || this.carRects.length === 0) return;
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(timeSec)) / 0.3));
    const map = this.map;
    const total = ambient.cars.length + ambient.peds.length + ambient.cruisers.length;
    if (this.instData.length < total * FLOATS_PER_INSTANCE) this.instData = new Float32Array(total * FLOATS_PER_INSTANCE);
    const data = this.instData;
    let count = 0;
    const push = (px: number, py: number, rot: number, sz: number, rect: Rect, er: Rect, emit: number): void => {
      const o = count * FLOATS_PER_INSTANCE;
      data[o] = px; data[o + 1] = py; data[o + 2] = rot; data[o + 3] = sz; data[o + 4] = sz;
      data[o + 5] = rect[0]; data[o + 6] = rect[1]; data[o + 7] = rect[2]; data[o + 8] = rect[3];
      data[o + 9] = er[0]; data[o + 10] = er[1]; data[o + 11] = er[2]; data[o + 12] = er[3];
      data[o + 13] = emit;
      count++;
    };
    // Cars: headlights/taillights emission, night-gated; parked = off.
    const nCars = this.carRects.length;
    for (const c of ambient.cars) {
      const ci = (((c.tint ?? 0) % nCars) + nCars) % nCars;
      const rect = this.carRects[ci];
      if (!rect) continue;
      const off = c.parked ? { dx: 0, dy: 0 } : laneOffset(c.dir);
      const headingDir = c.parked && c.curbDir !== undefined ? (c.curbDir % 2 === 0 ? 1 : 0) : c.dir;
      const hv = dirVector(headingDir);
      const lr = c.parked ? null : this.carLightRects[ci];
      push(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy, Math.atan2(hv.dx, -hv.dy), 0.58, rect, lr ?? rect, lr ? night : 0);
    }
    // Pedestrians + cyclists (cyclists = bike-mode peds): a STABLE per-person sprite pick; cyclists get
    // a small headlight (night). Skip those inside a building / riding a car.
    const nPed = this.pedRects.length;
    const nCyc = this.cycRects.length;
    for (const p of ambient.peds) {
      if (p.phase === 'inside' || p.phase === 'driving') continue;
      const seed = ((p.homeTile ?? p.carId ?? Math.round(p.x) * 131 + Math.round(p.y)) >>> 0);
      const isBike = (p.mode ?? TravelMode.Walk) === TravelMode.Bike;
      let ox = 0.5;
      let oy = 0.5;
      if (isRoadKind(map.built[map.idx(Math.round(p.x), Math.round(p.y))]!)) {
        const o = pedCurbOffset(p.dir); ox += o.dx; oy += o.dy;
      }
      const hv = dirVector(p.dir);
      const rot = Math.atan2(hv.dx, -hv.dy);
      if (isBike && nCyc > 0) {
        const i = (Math.imul(seed, 2654435761) >>> 0) % nCyc;
        const rect = this.cycRects[i];
        if (!rect) continue;
        const lr = this.cycLightRects[i];
        push(p.x + ox, p.y + oy, rot, 0.46, rect, lr ?? rect, lr ? night : 0);
      } else if (nPed > 0) {
        const rect = this.pedRects[(Math.imul(seed, 2654435761) >>> 0) % nPed];
        if (!rect) continue;
        push(p.x + ox, p.y + oy, rot, 0.4, rect, rect, 0);
      }
    }
    // Cruisers: a black car (rotated to heading) with an ALWAYS-on flashing red/blue bar (emergency).
    if (this.cruiserRect) {
      const flash = Math.floor(timeSec * 1000 / 180) % 2 === 0 ? 1 : 0.45;
      for (const c of ambient.cruisers) {
        const off = laneOffset(c.dir);
        const hv = dirVector(c.dir);
        const lr = this.cruiserLightRect;
        push(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy, Math.atan2(hv.dx, -hv.dy), 0.55, this.cruiserRect, lr ?? this.cruiserRect, lr ? flash : 0);
      }
    }
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.batch.render(data, count, origin, view, timeSec, DAYSPEED);
    }
    this.renderGlow(ambient, origin, view, timeSec, night, buildings);
    gl.disable(gl.BLEND); // leave blend OFF so the next frame's opaque base pass isn't additive
  }

  /** Emissive GLOW: soft additive light cast onto the surrounding tiles (Maddy: "car headlights
   *  illuminating road in front" as a forward CONE; windows/hazard blinkies cast faint glows too).
   *  Headlights = forward cone (night); cruiser bars flash red/blue (radial); building windows a faint
   *  warm pool (night), power plants a faint warm glow + a blinking red beacon glow. Additive (ONE,ONE). */
  private renderGlow(ambient: AmbientState, origin: readonly [number, number], view: readonly [number, number], timeSec: number, night: number, buildings: readonly EmissiveBuilding[]): void {
    const gl = this.gl;
    if (!gl || !this.glow) return;
    const cap = ambient.cars.length + ambient.cruisers.length + buildings.length * 2;
    if (this.glowData.length < cap * GLOW_FLOATS) this.glowData = new Float32Array(cap * GLOW_FLOATS);
    const g = this.glowData;
    let n = 0;
    // pos(2) fwd(2) len(1) halfwidth(1) color(3) intensity(1)
    const cone = (x: number, y: number, fx: number, fy: number, len: number, hw: number, r: number, gr: number, b: number, inten: number): void => {
      const o = n * GLOW_FLOATS;
      g[o] = x; g[o + 1] = y; g[o + 2] = fx; g[o + 3] = fy; g[o + 4] = len; g[o + 5] = hw;
      g[o + 6] = r; g[o + 7] = gr; g[o + 8] = b; g[o + 9] = inten;
      n++;
    };
    const radial = (x: number, y: number, radius: number, r: number, gr: number, b: number, inten: number): void => cone(x, y, 0, 0, 0, radius, r, gr, b, inten);
    // A MOVER's lights: each light-point becomes a forward CONE if it's near the FRONT (a headlight),
    // else a small radial pool (taillight / roof bar). Points are in sprite-local space, rotated to the
    // mover's heading. `mul` scales intensity (e.g. cruiser flash). Falls back to one nose cone.
    const nCars = this.carRects.length;
    const mover = (bx: number, by: number, fwd: { dx: number; dy: number }, size: number, pts: LightPoint[] | null, mul: number): void => {
      const rot = Math.atan2(fwd.dx, -fwd.dy);
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      if (pts && pts.length) {
        for (const p of pts) {
          const wx = bx + (p.ox * cs - p.oy * sn) * size;
          const wy = by + (p.ox * sn + p.oy * cs) * size;
          if (p.oy < -0.05) cone(wx, wy, fwd.dx, fwd.dy, 1.9, 0.3, p.r, p.g, p.b, 0.13 * mul); // headlight → forward cone
          else radial(wx, wy, 0.5, p.r, p.g, p.b, 0.16 * mul); // taillight / roof bar → small pool
        }
      } else {
        cone(bx + fwd.dx * 0.3, by + fwd.dy * 0.3, fwd.dx, fwd.dy, 2.0, 0.55, 1.0, 0.9, 0.72, 0.13 * mul);
      }
    };
    if (night > 0.02) {
      for (const c of ambient.cars) {
        if (c.parked) continue;
        const ci = (((c.tint ?? 0) % nCars) + nCars) % nCars;
        const off = laneOffset(c.dir);
        mover(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy, dirVector(c.dir), 0.58, this.carPoints[ci] ?? null, night);
      }
    }
    // Cruisers: emergency lights flash, so the roof-bar pools pulse (always on, not night-gated).
    const flash = Math.floor(timeSec * 1000 / 180) % 2 === 0 ? 1 : 0.4;
    for (const c of ambient.cruisers) {
      const off = laneOffset(c.dir);
      mover(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy, dirVector(c.dir), 0.55, this.cruiserPoints, flash);
    }
    // Buildings: RADIAL glow from the light map's actual lit pixels (windows / beacons), not the center.
    for (const bld of buildings) {
      const span = Math.max(bld.w, bld.h);
      const isPower = bld.kind >= 24 && bld.kind <= 30;
      const pts = this.buildingPoints.get(`b-${bld.kind}-${bld.w === 1 && bld.h === 1 ? 'c' : `${bld.w}x${bld.h}`}`);
      const at = (p: LightPoint): [number, number] => [bld.x + (0.5 + p.ox) * bld.w, bld.y + (0.5 + p.oy) * bld.h];
      if (pts && (isPower || night > 0.02)) {
        for (const p of pts.lights) {
          const [wx, wy] = at(p);
          radial(wx, wy, 0.9, p.r, p.g, p.b, (isPower ? 0.12 : night * 0.16)); // window / furnace glow
        }
      }
      if (pts && isPower) { // blinking red beacon glow, per-building phase
        const hash = (((bld.x * 73856093) ^ (bld.y * 19349663)) >>> 0);
        const period = 420 + (hash % 6) * 90;
        if ((timeSec * 1000 + (hash % period)) % period < period * 0.45) {
          for (const p of pts.blink) { const [wx, wy] = at(p); radial(wx, wy, 1.0, p.r, p.g, p.b, 0.32); }
        }
      } else if (!pts && night > 0.02 && !isPower) {
        radial(bld.x + bld.w / 2, bld.y + bld.h / 2, span * 0.6, 1.0, 0.86, 0.62, night * 0.1); // fallback center glow
      }
    }
    if (n === 0) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive → glow brightens the ground/sprites around the source
    this.glow.render(g, n, origin, view);
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
    this.glow?.dispose();
    this.canvas?.remove();
    this.shader = null;
    this.batch = null;
    this.glow = null;
    this.gl = null;
    this.canvas = null;
  }
}
