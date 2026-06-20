// Hybrid satellite renderer — WebGL2 procedural pass (see docs/art/satellite-shader.md §2–3).
//
// "Tiles own identity, the shader owns life." This is the SHADER half: a single 60 FPS
// fragment pass that samples the packed world (GridTextureBridge → u_data) and synthesizes
// what static tiles can't — terrain colour broken by noise (anti-plaid), time-animated water,
// procedural road centerlines from the adjacency mask, and single-pass raymarched drop shadows
// from per-cell building height. The baked diffusion tiles (the albedo atlas) compose ON TOP in
// phase 2 (after the bake); until then this is the pure-procedural fallback, which is exactly the
// part that has no dependency on the bake — so it's where we break ground.
//
// Not allowlisted as pure-UI: it holds the WebGL2 program. The GLSL *source builders* below are
// pure (no GL/DOM) so the CPU↔GPU enum contract is unit-testable; the GL class + demo are
// browser-only (smoke-tested via the ?shaderdemo route).
import { GameMap, Water, LandCover } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { SatType } from './satelliteFormat';
import { GridTextureBridge } from './gridTextureBridge';

/** `#define SAT_<NAME> <value>` for every SatType — keeps the GLSL switch in sync with the TS enum. */
export function glslDefines(): string {
  return Object.entries(SatType)
    .map(([name, value]) => `#define SAT_${name.toUpperCase()} ${value}`)
    .join('\n');
}

/** Fullscreen-triangle vertex stage (no attributes; gl_VertexID drives it). v_uv spans 0..1. */
export function buildVertexSource(): string {
  return `#version 300 es
out vec2 v_uv;
const vec2 VERTS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  vec2 p = VERTS[gl_VertexID];
  v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // flip Y so cell (0,0) is top-left
  gl_Position = vec4(p, 0.0, 1.0);
}`;
}

/** The procedural-synthesis + raymarched-shadow fragment stage. */
export function buildFragmentSource(): string {
  return `#version 300 es
precision highp float;
${glslDefines()}

uniform sampler2D u_data; // packed world: R=type G=height/band/class B=adjacency A=sim
uniform vec2 u_grid;      // data-texture size in cells (for sampling normalization)
uniform vec2 u_origin;    // top-left visible world cell (camera pan)
uniform vec2 u_view;      // visible window size in cells (camera zoom)
uniform float u_time;     // seconds, for animated water
uniform vec2 u_sun;       // sun direction in tile space (shadows trace toward it)
uniform float u_shadow;   // shadow strength 0..1

in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}
vec4 cell(vec2 c) { return texture(u_data, (c + 0.5) / u_grid); }
float isLand(vec2 c) { return int(cell(c).r * 255.0 + 0.5) == SAT_WATER ? 0.0 : 1.0; }

void main() {
  vec2 g = u_origin + v_uv * u_view; // screen UV → world cell space (camera pan/zoom)
  if (g.x < 0.0 || g.y < 0.0 || g.x >= u_grid.x || g.y >= u_grid.y) {
    fragColor = vec4(0.04, 0.05, 0.06, 1.0); // letterbox backdrop outside the world
    return;
  }
  vec2 ci = floor(g);
  vec2 lf = fract(g);
  vec4 d = cell(ci);
  int type = int(d.r * 255.0 + 0.5);
  float G = d.g * 255.0;
  int mask = int(d.b * 255.0 + 0.5);
  float sim = d.a;
  float h = hash21(ci + 0.5); // per-tile hash → anti-plaid jitter

  vec3 col;
  if (type == SAT_WATER) {
    // two flowing octaves + a moving specular glint — the one thing a static tile can't do
    float wn = fbm(g * 0.6 + vec2(u_time * 0.04, u_time * 0.03));
    float wn2 = fbm(g * 1.7 - vec2(u_time * 0.07, u_time * 0.05));
    float spec = pow(max(wn, wn2), 4.0);
    vec3 deep = vec3(0.05, 0.18, 0.32), shallow = vec3(0.11, 0.33, 0.45);
    col = mix(deep, shallow, wn * 0.7 + wn2 * 0.3) + spec * 0.3;
    // SDF-ish shoreline: an animated foam band wherever a 4-neighbour is land
    float land = isLand(ci + vec2(1, 0)) + isLand(ci + vec2(-1, 0)) + isLand(ci + vec2(0, 1)) + isLand(ci + vec2(0, -1));
    if (land > 0.0) {
      float foam = (0.5 + 0.5 * sin(u_time * 2.0 + (g.x + g.y) * 3.0)) * clamp(land, 0.0, 1.0);
      col = mix(col, vec3(0.72, 0.85, 0.90), foam * 0.32);
    }
  } else if (type == SAT_ROAD) {
    col = vec3(0.21, 0.21, 0.23) + (h - 0.5) * 0.03;
    // centerlines branch on the B-channel adjacency mask (N=1 E=2 S=4 W=8)
    vec2 cc = abs(lf - 0.5);
    float line = 0.0;
    if ((mask & 2) != 0 || (mask & 8) != 0) line = max(line, 1.0 - smoothstep(0.03, 0.05, cc.y));
    if ((mask & 1) != 0 || (mask & 4) != 0) line = max(line, 1.0 - smoothstep(0.03, 0.05, cc.x));
    col = mix(col, vec3(0.78, 0.66, 0.28), line * 0.7);
    col += vec3(0.6, 0.35, 0.12) * sim * 0.5; // traffic glow
  } else if (type == SAT_TERRAIN) {
    int band = int(mod(G, 4.0));
    float elev = floor(G / 4.0) / 63.0;
    vec3 bare = vec3(0.46, 0.39, 0.28), meadow = vec3(0.55, 0.55, 0.31);
    vec3 grass = vec3(0.30, 0.46, 0.22), forest = vec3(0.16, 0.31, 0.15);
    vec3 base = band == 0 ? bare : band == 1 ? meadow : band == 2 ? grass : forest;
    // wavy grass: vegetated bands ripple in the wind (bare earth stays still)
    float veg = band == 0 ? 0.0 : 1.0;
    vec2 wind = veg * vec2(sin(u_time * 0.8 + g.y * 1.5), cos(u_time * 0.6 + g.x * 1.3)) * 0.05;
    float n = fbm(g * 1.8 + h * 10.0 + wind);
    col = base * (0.78 + 0.44 * n);
    col += base * veg * 0.07 * sin(dot(g, vec2(0.6, 0.8)) - u_time * 1.2); // moving wind gust sheen
    col *= 0.72 + 0.56 * elev; // relief shading from packed elevation
  } else if (type == SAT_GREEN) {
    vec2 wind = vec2(sin(u_time * 0.9 + g.y * 1.6), cos(u_time * 0.7 + g.x * 1.4)) * 0.06;
    col = vec3(0.20, 0.44, 0.19) * (0.8 + 0.4 * fbm(g * 2.0 + h * 7.0 + wind));
  } else {
    vec3 roof;
    if (type == SAT_RESIDENTIAL) roof = vec3(0.46, 0.23, 0.18);
    else if (type == SAT_COMMERCIAL) roof = vec3(0.30, 0.37, 0.46);
    else if (type == SAT_INDUSTRIAL) roof = vec3(0.41, 0.31, 0.20);
    else if (type == SAT_CIVIC) roof = vec3(0.56, 0.51, 0.41);
    else roof = vec3(0.27, 0.27, 0.30); // power
    roof *= 0.82 + 0.34 * h;
    float edge = step(0.07, min(min(lf.x, lf.y), min(1.0 - lf.x, 1.0 - lf.y)));
    col = mix(roof * 0.6, roof, edge); // roof inset / parapet
  }

  // single-pass raymarched drop shadows: step toward the sun, occlude under taller neighbours
  float shadow = 1.0;
  vec2 stepv = normalize(u_sun);
  for (int i = 1; i <= 12; i++) {
    vec2 sc = floor(ci + stepv * float(i));
    if (sc.x < 0.0 || sc.y < 0.0 || sc.x >= u_grid.x || sc.y >= u_grid.y) break;
    vec4 nd = cell(sc);
    int nt = int(nd.r * 255.0 + 0.5);
    bool building = nt >= SAT_RESIDENTIAL && nt <= SAT_POWER;
    if (building && nd.g * 255.0 > float(i) * 22.0) { shadow = 1.0 - u_shadow; break; }
  }
  col *= shadow;

  fragColor = vec4(col, 1.0);
}`;
}

// ── WebGL2 program ───────────────────────────────────────────────────────────

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`satellite shader compile failed: ${log}`);
  }
  return sh;
}

/** Owns the WebGL2 program, the empty VAO (gl_VertexID), and the RGBA8 data texture. */
export class SatelliteShader {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly tex: WebGLTexture;
  private readonly uGrid: WebGLUniformLocation | null;
  private readonly uOrigin: WebGLUniformLocation | null;
  private readonly uView: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uSun: WebGLUniformLocation | null;
  private readonly uShadow: WebGLUniformLocation | null;
  private gridW = 0;
  private gridH = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, buildVertexSource());
    const fs = compile(gl, gl.FRAGMENT_SHADER, buildFragmentSource());
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`satellite shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    this.vao = gl.createVertexArray()!;
    this.tex = gl.createTexture()!;
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_data'), 0);
    this.uGrid = gl.getUniformLocation(program, 'u_grid');
    this.uOrigin = gl.getUniformLocation(program, 'u_origin');
    this.uView = gl.getUniformLocation(program, 'u_view');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uSun = gl.getUniformLocation(program, 'u_sun');
    this.uShadow = gl.getUniformLocation(program, 'u_shadow');
  }

  /** (Re)upload the entire packed grid as the data texture. Sizes the texture on first call. */
  uploadFull(bridge: GridTextureBridge): void {
    const gl = this.gl;
    this.gridW = bridge.width;
    this.gridH = bridge.height;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bridge.width, bridge.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bridge.data);
    bridge.consumeDirty();
  }

  /** Upload only the bridge's dirty sub-rectangle via texSubImage2D (UNPACK_* offsets into the full buffer). */
  uploadDirty(bridge: GridTextureBridge): void {
    const rect = bridge.consumeDirty();
    if (!rect) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, bridge.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, bridge.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /**
   * Draw the full-screen procedural pass. `origin`/`view` are the visible world window in cells
   * (camera pan/zoom); both default to the full grid. `sun` need not be normalized.
   */
  render(opts: {
    time: number;
    sun: readonly [number, number];
    shadow?: number;
    origin?: readonly [number, number];
    view?: readonly [number, number];
  }): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.uGrid) gl.uniform2f(this.uGrid, this.gridW, this.gridH);
    if (this.uOrigin) gl.uniform2f(this.uOrigin, opts.origin?.[0] ?? 0, opts.origin?.[1] ?? 0);
    if (this.uView) gl.uniform2f(this.uView, opts.view?.[0] ?? this.gridW, opts.view?.[1] ?? this.gridH);
    if (this.uTime) gl.uniform1f(this.uTime, opts.time);
    if (this.uSun) gl.uniform2f(this.uSun, opts.sun[0], opts.sun[1]);
    if (this.uShadow) gl.uniform1f(this.uShadow, opts.shadow ?? 0.45);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

// ── Dev harness: prove the pass at 60 FPS on a dummy grid (deliverable 3) ─────

export interface SatelliteDemoHandle {
  stop(): void;
  /** Most recent measured frames-per-second. */
  fps(): number;
}

/**
 * A synthetic world that exercises every branch: terrain bands + elevation, a water body, a road
 * grid with traffic, and buildings of contrasting height (a coal plant + offices to throw long
 * shadows over their neighbours). Deterministic — uses tile-coordinate hashing, no RNG.
 */
export function buildDemoWorld(size = 64): GameMap {
  const m = new GameMap(size, size);
  const h = (x: number, y: number): number => {
    let v = (x * 374761393 + y * 668265263) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
    return (v >>> 0) / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // terrain bands in quadrants, with an elevation gradient for relief
      const band =
        x < size / 2 && y < size / 2
          ? LandCover.Grass
          : x >= size / 2 && y < size / 2
            ? LandCover.Meadow
            : x < size / 2
              ? LandCover.Forest
              : LandCover.Bare;
      m.setLandCover(x, y, band);
      m.setElevation(x, y, (x + y) / (2 * size));
    }
  }
  // a lake blob in the lower-right
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size * 0.72;
      const dy = y - size * 0.72;
      if (dx * dx + dy * dy < (size * 0.13) * (size * 0.13)) m.setWater(x, y, Water.Lake);
    }
  }
  // a road grid every 8 cells, with traffic
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m.getWater(x, y) !== Water.None) continue;
      if (x % 8 === 0 || y % 8 === 0) {
        m.setBuilt(x, y, BuiltKind.RoadStreet);
        m.traffic[m.idx(x, y)] = Math.round(h(x, y) * 200);
      }
    }
  }
  // buildings flanking the roads: tall ones interleaved to cast shadows
  const kinds = [
    BuiltKind.HouseSingle,
    BuiltKind.Apartments,
    BuiltKind.Offices,
    BuiltKind.Industrial,
    BuiltKind.CoalPlant,
    BuiltKind.Civic,
    BuiltKind.CommunityGarden,
  ];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (m.getBuilt(x, y) !== 0 || m.getWater(x, y) !== Water.None) continue;
      // place a building just off the road grid (adjacent to a road tile)
      const nearRoad = x % 8 === 1 || y % 8 === 1;
      if (nearRoad && h(x, y) > 0.45) {
        m.setBuilt(x, y, kinds[Math.floor(h(x * 3, y * 7) * kinds.length) % kinds.length]!);
      }
    }
  }
  // a few solid tower blocks on open ground so the raymarched drop-shadows are unmistakable
  // (the headline feature: tall structures cast real volume over their neighbours and the street)
  const towers: ReadonlyArray<readonly [number, number, number, number]> = [
    [Math.floor(size * 0.33), Math.floor(size * 0.32), 3, BuiltKind.CoalPlant],
    [Math.floor(size * 0.6), Math.floor(size * 0.55), 3, BuiltKind.Offices],
    [Math.floor(size * 0.42), Math.floor(size * 0.7), 2, BuiltKind.Apartments],
  ];
  for (const [tx, ty, tw, kind] of towers) {
    for (let dy = 0; dy < tw; dy++) {
      for (let dx = 0; dx < tw; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < size && y < size && m.getWater(x, y) === Water.None) m.setBuilt(x, y, kind);
      }
    }
  }
  return m;
}

/**
 * Mount the procedural pass on a canvas, animating u_time at the display refresh. Pass a live
 * GameMap via `opts.map`, else a synthetic demo world is built. Returns a handle to stop it and
 * read the measured FPS. Browser-only (WebGL2 + rAF).
 */
export function mountSatelliteDemo(
  canvas: HTMLCanvasElement,
  opts?: { map?: GameMap; size?: number; sun?: readonly [number, number]; shadow?: number },
): SatelliteDemoHandle {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is unavailable in this browser');

  const map = opts?.map ?? buildDemoWorld(opts?.size ?? 64);
  const bridge = new GridTextureBridge(map.width, map.height);
  bridge.repackAll(map);
  const shader = new SatelliteShader(gl);
  shader.uploadFull(bridge);

  const sun = opts?.sun ?? [0.65, 0.78];
  const shadow = opts?.shadow ?? 0.5;
  const t0 = performance.now();
  let raf = 0;
  let frames = 0;
  let fpsWindowStart = t0;
  let fps = 0;

  // Pin the canvas to the viewport so its DISPLAY size is independent of the drawing-buffer
  // attribute — otherwise setting canvas.width feeds back into clientWidth and the view "zooms"
  // into a degenerate buffer (the all-zero texture reads as flat bare-terrain beige). Size the
  // buffer from innerWidth, never from clientWidth.
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';

  const frame = (now: number) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const hgt = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Fit the grid to the viewport keeping cells square (letterbox by widening the view on the
    // longer axis), centred — so the world isn't stretched and you see all of it.
    const aspect = w / hgt;
    let viewW = map.width;
    let viewH = map.height;
    if (aspect >= 1) viewW = map.height * aspect;
    else viewH = map.width / aspect;
    const origin: [number, number] = [(map.width - viewW) / 2, (map.height - viewH) / 2];

    shader.render({ time: (now - t0) / 1000, sun, shadow, origin, view: [viewW, viewH] });

    frames++;
    if (now - fpsWindowStart >= 500) {
      fps = (frames * 1000) / (now - fpsWindowStart);
      frames = 0;
      fpsWindowStart = now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      shader.dispose();
    },
    fps: () => fps,
  };
}
