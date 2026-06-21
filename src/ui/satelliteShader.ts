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
uniform sampler2D u_base; // the CPU-rendered base (terrain+buildings+roads+all markings) — the albedo
uniform vec2 u_grid;      // data-texture size in cells (for sampling normalization)
uniform vec2 u_origin;    // top-left visible world cell (camera pan)
uniform vec2 u_view;      // visible window size in cells (camera zoom)
uniform float u_time;     // seconds, for animated water
uniform vec2 u_sun;       // sun direction in tile space (shadows trace toward it)
uniform float u_shadow;   // shadow strength 0..1
uniform float u_dayspeed; // >0 slowly rotates the sun (day/night sweep); 0 = fixed

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
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * v; }

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
  float h = hash21(ci + 0.5); // per-tile hash → phase variety

  // ALBEDO = the CPU-baked per-cell tile (terrain + building + lines/dividers/markings/props already
  // composited by the CPU base pass). The GPU is then free to do "affine nonsense + lighting" on it
  // (Maddy). Water cells get an AFFINE slosh: displace the sample by flowing noise so the baked water
  // tiles undulate — the wang-tiled base + this displacement = the slosh, now per-pixel on the GPU.
  vec2 baseUv = v_uv;
  if (type == SAT_WATER) {
    // AFFINE slosh: warp the sampled UV by flowing noise so the baked water tiles ripple/distort
    // (the dynamic-water transform Maddy wants, now per-pixel on the GPU). ~0.5 tile of displacement.
    vec2 flow = vec2(
      fbm(g * 0.9 + vec2(u_time * 0.10, u_time * 0.07)),
      fbm(g * 0.9 + vec2(40.0 - u_time * 0.08, 9.0 + u_time * 0.11))
    ) - 0.5;
    baseUv += (flow * 0.5) / u_view;
  }
  vec3 col = texture(u_base, baseUv).rgb;

  if (type == SAT_WATER) {
    // DEEP water must read alive everywhere (not just the shore): a moving two-octave swell modulates
    // brightness, whitecap crests pop on the wave peaks, and a slow sun-glint sheen drifts across.
    float w1 = fbm(g * 0.8 + vec2(u_time * 0.09, u_time * 0.06));
    float w2 = fbm(g * 2.0 + vec2(-u_time * 0.07, u_time * 0.10));
    float wave = w1 * 0.6 + w2 * 0.4;
    col *= 0.80 + 0.42 * wave;                                   // visible moving light/dark swell
    float crest = smoothstep(0.62, 0.86, wave);                 // whitecaps on the peaks
    col = mix(col, vec3(0.78, 0.86, 0.92), crest * 0.5);
    float glint = pow(0.5 + 0.5 * sin((g.x * 0.7 + g.y * 0.5) * 2.4 - u_time * 1.1 + wave * 6.0), 6.0);
    col += vec3(0.85, 0.9, 0.96) * glint * 0.22;                // drifting sun-glint
    float land = isLand(ci + vec2(1, 0)) + isLand(ci + vec2(-1, 0)) + isLand(ci + vec2(0, 1)) + isLand(ci + vec2(0, -1));
    if (land > 0.0) {
      float foam = (0.5 + 0.5 * sin(u_time * 2.0 + (g.x + g.y) * 3.0)) * clamp(land, 0.0, 1.0);
      col = mix(col, vec3(0.84, 0.90, 0.94), foam * 0.30);       // shoreline foam band
    }
  } else if (type == SAT_TERRAIN || type == SAT_GREEN) {
    // grass sheen: a travelling wind-gust shimmer over the baked green (bare band 0 stays still)
    int band = int(mod(G, 4.0));
    float veg = (type == SAT_GREEN || band > 0) ? 1.0 : 0.0;
    col += col * veg * 0.06 * sin(dot(g, vec2(0.6, 0.8)) - u_time * 1.2);
  } else if (type == SAT_ROAD) {
    // traffic FLOW: a travelling headlight pulse along the road axis, scaled by density (A channel)
    vec2 dir = vec2((mask & 2) != 0 || (mask & 8) != 0 ? 1.0 : 0.0, (mask & 1) != 0 || (mask & 4) != 0 ? 1.0 : 0.0);
    float along = dot(g, normalize(dir + vec2(0.001)));
    float pulse = 0.5 + 0.5 * sin(along * 6.2832 - u_time * 3.0);
    col += vec3(0.95, 0.78, 0.35) * sim * (0.12 + 0.4 * pulse);
  } else if (type >= SAT_RESIDENTIAL && type <= SAT_POWER) {
    // a slow specular glint sweeping across rooftops (HVAC/skylight catching the sun)
    float glint = pow(0.5 + 0.5 * sin((g.x + g.y) * 1.3 - u_time * 0.6 + h * 6.28), 8.0);
    col += vec3(0.9, 0.88, 0.8) * glint * 0.12;
  }

  // Clouds: non-repeating fBm drifting with time casts a soft moving shadow over the ground.
  float cloud = fbm(g * 0.35 + vec2(u_time * 0.02, u_time * 0.015));
  col *= 1.0 - smoothstep(0.55, 0.82, cloud) * 0.20;

  // Day/night: the sun ARCS east→west across the sky (NOT a full orbit around the map — that read as
  // flat-earth, Maddy). Altitude = sin(day): >0 daytime, <0 night. Azimuth sweeps via cos(day), with a
  // fixed downward bias so shadows fall consistently. Shadows lengthen at dawn/dusk + vanish at night;
  // the scene dims + cools toward night. With dayspeed 0 the sun is a fixed mid-morning (no cycle).
  vec2 sun = u_sun;
  float shadowStrength = u_shadow;
  float shadowLen = 1.0;
  float alt = 1.0;
  if (u_dayspeed > 0.0) {
    float day = u_time * u_dayspeed;
    alt = sin(day);
    float dayAmt = clamp(alt, 0.0, 1.0);
    sun = vec2(cos(day), -0.55);                 // azimuth arcs E↔W; downward bias
    shadowStrength = u_shadow * dayAmt;          // soft → none at night
    shadowLen = mix(1.0, 2.4, 1.0 - dayAmt);     // long shadows when the sun is low
  }
  float shadow = 1.0;
  vec2 stepv = normalize(sun);
  for (int i = 1; i <= 12; i++) {
    vec2 sc = floor(ci + stepv * float(i) * shadowLen);
    if (sc.x < 0.0 || sc.y < 0.0 || sc.x >= u_grid.x || sc.y >= u_grid.y) break;
    vec4 nd = cell(sc);
    int nt = int(nd.r * 255.0 + 0.5);
    bool building = nt >= SAT_RESIDENTIAL && nt <= SAT_POWER;
    if (building && nd.g * 255.0 > float(i) * 22.0) { shadow = 1.0 - shadowStrength; break; }
  }
  col *= shadow;
  if (u_dayspeed > 0.0) {
    col *= mix(0.45, 1.0, smoothstep(-0.2, 0.3, alt));          // dusk/night dim
    col = mix(col, col * vec3(0.72, 0.8, 1.06), clamp(-alt, 0.0, 1.0) * 0.6); // cool blue at night
  }

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
  private readonly baseTex: WebGLTexture;
  private readonly uGrid: WebGLUniformLocation | null;
  private readonly uOrigin: WebGLUniformLocation | null;
  private readonly uView: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uSun: WebGLUniformLocation | null;
  private readonly uShadow: WebGLUniformLocation | null;
  private readonly uDayspeed: WebGLUniformLocation | null;
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
    this.baseTex = gl.createTexture()!;
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_data'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_base'), 1); // the CPU base albedo on texture unit 1
    this.uGrid = gl.getUniformLocation(program, 'u_grid');
    this.uOrigin = gl.getUniformLocation(program, 'u_origin');
    this.uView = gl.getUniformLocation(program, 'u_view');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uSun = gl.getUniformLocation(program, 'u_sun');
    this.uShadow = gl.getUniformLocation(program, 'u_shadow');
    this.uDayspeed = gl.getUniformLocation(program, 'u_dayspeed');
  }

  /** (Re)upload the entire packed grid as the data texture. Sizes the texture on first call. */
  uploadFull(bridge: GridTextureBridge): void {
    const gl = this.gl;
    this.gridW = bridge.width;
    this.gridH = bridge.height;
    gl.activeTexture(gl.TEXTURE0);
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, bridge.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, bridge.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /** Upload the CPU base canvas (the baked per-cell tiles) as the albedo texture (unit 1). Call only
   *  when the base changed (camera move / built edit) — not every frame. Canvas row 0 (top) → texture
   *  row 0, matching v_uv.y=0=top (no Y-flip). LINEAR so the water affine-displacement samples smooth. */
  uploadBase(src: TexImageSource): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  /**
   * Draw the full-screen pass: sample the CPU base albedo (unit 1) + jeuje it (water/grass/traffic/
   * glints/clouds/shadows). `origin`/`view` are the visible world window in cells (camera pan/zoom);
   * both default to the full grid. `sun` need not be normalized.
   */
  render(opts: {
    time: number;
    sun: readonly [number, number];
    shadow?: number;
    origin?: readonly [number, number];
    view?: readonly [number, number];
    dayspeed?: number;
  }): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
    if (this.uGrid) gl.uniform2f(this.uGrid, this.gridW, this.gridH);
    if (this.uOrigin) gl.uniform2f(this.uOrigin, opts.origin?.[0] ?? 0, opts.origin?.[1] ?? 0);
    if (this.uView) gl.uniform2f(this.uView, opts.view?.[0] ?? this.gridW, opts.view?.[1] ?? this.gridH);
    if (this.uTime) gl.uniform1f(this.uTime, opts.time);
    if (this.uSun) gl.uniform2f(this.uSun, opts.sun[0], opts.sun[1]);
    if (this.uShadow) gl.uniform1f(this.uShadow, opts.shadow ?? 0.45);
    if (this.uDayspeed) gl.uniform1f(this.uDayspeed, opts.dayspeed ?? 0);
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
  opts?: { map?: GameMap; size?: number; sun?: readonly [number, number]; shadow?: number; dayspeed?: number },
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
  const dayspeed = opts?.dayspeed ?? 0.04; // gentle day/night sweep so shadows visibly move
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

    shader.render({ time: (now - t0) / 1000, sun, shadow, origin, view: [viewW, viewH], dayspeed });

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
