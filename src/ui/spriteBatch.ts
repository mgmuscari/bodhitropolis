// GPU sprite batch (Maddy 2026-06-20: "move sprites over to gpu" — so the moving agents are lit by the
// EXACT same lighting as the ground, eliminating the CPU-buffer-vs-GPU-shader day/night mismatch). The
// moving agents (cars/peds/cyclists/cruiser) render as instanced textured quads in the SAME WebGL2
// canvas as the base, AFTER the base fullscreen pass — so they sit on the lit ground and share its
// day/night × cloud lighting per-pixel. Emission (headlights/bar) is added AFTER lighting (evades it).
//
// IO module (WebGL/DOM) — not on the pure-ui allowlist. The atlas builder is DOM-only (canvas).

/** Shared lighting GLSL — MIRRORS satelliteShader.ts's base day/night × cloud (keep in sync). Applied
 *  at the sprite's world cell so a sprite reads as lit to the exact ground level beneath it. */
export const LIGHT_GLSL = `
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.0;a*=0.5;}return s;}
vec3 applyLighting(vec3 col, vec2 g, float time, float dayspeed){
  float cloud = fbm(g*0.35 + vec2(time*0.02, time*0.015));
  col *= 1.0 - smoothstep(0.55,0.82,cloud)*0.20;
  if(dayspeed>0.0){
    float alt = sin(time*dayspeed);
    col *= mix(0.45,1.0,smoothstep(-0.2,0.3,alt));
    col = mix(col, col*vec3(0.72,0.8,1.06), clamp(-alt,0.0,1.0)*0.6);
  }
  return col;
}`;

function vertSource(): string {
  return `#version 300 es
layout(location=0) in vec2 a_corner;   // unit quad [-0.5,0.5]
layout(location=1) in vec2 a_pos;      // sprite center, world cell
layout(location=2) in vec3 a_rotsize;  // rot(rad), sizeX, sizeY (cells)
layout(location=3) in vec4 a_uv;       // albedo atlas rect (x,y,w,h) normalized
layout(location=4) in vec4 a_emituv;   // emission atlas rect
layout(location=5) in float a_emit;    // emission strength (<=0 = none)
uniform vec2 u_origin; uniform vec2 u_view;
out vec2 v_uv; out vec2 v_emituv; out vec2 v_world; out float v_emit;
void main(){
  float c=cos(a_rotsize.x), s=sin(a_rotsize.x);
  vec2 corner = a_corner * a_rotsize.yz;
  vec2 rc = vec2(corner.x*c - corner.y*s, corner.x*s + corner.y*c);
  vec2 world = a_pos + rc;
  vec2 ndc = ((world - u_origin)/u_view)*2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vec2 cuv = a_corner + 0.5; // 0..1
  v_uv = a_uv.xy + cuv*a_uv.zw;
  v_emituv = a_emituv.xy + cuv*a_emituv.zw;
  v_world = world;
  v_emit = a_emit;
}`;
}

function fragSource(): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_time; uniform float u_dayspeed;
in vec2 v_uv; in vec2 v_emituv; in vec2 v_world; in float v_emit;
out vec4 fragColor;
${LIGHT_GLSL}
void main(){
  vec4 a = texture(u_atlas, v_uv);
  if(a.a < 0.04) discard;
  vec3 col = applyLighting(a.rgb, v_world, u_time, u_dayspeed);
  if(v_emit > 0.001){
    vec4 e = texture(u_atlas, v_emituv);
    col += e.rgb * e.a * v_emit; // emission added AFTER lighting → evades day/night shading
  }
  fragColor = vec4(col, a.a);
}`;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`sprite shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** A packed sprite atlas: one canvas + normalized UV rects keyed by name. */
export interface SpriteAtlas {
  canvas: HTMLCanvasElement;
  rects: Map<string, [number, number, number, number]>; // name → [u,v,w,h] normalized
}

/** Pack named images into a square-ish grid atlas (each cell `cell`px). Names absent from the result
 *  had no image. Used for the agent sprites + their emission maps so one texture serves the batch. */
export function buildSpriteAtlas(entries: { name: string; img: CanvasImageSource }[], cell = 32): SpriteAtlas {
  const n = entries.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const rects = new Map<string, [number, number, number, number]>();
  entries.forEach((e, i) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    ctx.drawImage(e.img, cx, cy, cell, cell);
    rects.set(e.name, [cx / canvas.width, cy / canvas.height, cell / canvas.width, cell / canvas.height]);
  });
  return { canvas, rects };
}

/** One instance = 16 floats: pos(2) rotsize(3) uv(4) emituv(4) emit(1) [+2 pad to 16]. */
export const FLOATS_PER_INSTANCE = 16;

export class SpriteBatch {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;
  private inst: WebGLBuffer;
  private atlasTex: WebGLTexture;
  private cap = 0;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly gl: WebGL2RenderingContext) {
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, vertSource());
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSource());
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`sprite link: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    for (const n of ['u_origin', 'u_view', 'u_time', 'u_dayspeed', 'u_atlas']) this.u[n] = gl.getUniformLocation(program, n);
    this.vao = gl.createVertexArray()!;
    this.quad = gl.createBuffer()!;
    this.inst = gl.createBuffer()!;
    this.atlasTex = gl.createTexture()!;
    gl.bindVertexArray(this.vao);
    // static unit-quad (two triangles)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // instance buffer (interleaved); attrib pointers set in ensureCapacity
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const stride = FLOATS_PER_INSTANCE * 4;
    const ptr = (loc: number, size: number, offsetFloats: number): void => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offsetFloats * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    ptr(1, 2, 0); ptr(2, 3, 2); ptr(3, 4, 5); ptr(4, 4, 9); ptr(5, 1, 13);
    gl.bindVertexArray(null);
  }

  /** Upload the sprite atlas (the packed agent albedos + emission maps). */
  setAtlas(canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  /** Draw `count` instances from `data` (FLOATS_PER_INSTANCE each). Expects BLEND already enabled. */
  render(data: Float32Array, count: number, origin: readonly [number, number], view: readonly [number, number], time: number, dayspeed: number): void {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (count > this.cap) {
      this.cap = Math.ceil(count * 1.5);
      gl.bufferData(gl.ARRAY_BUFFER, this.cap * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * FLOATS_PER_INSTANCE));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.u.u_atlas!, 0);
    gl.uniform2f(this.u.u_origin!, origin[0], origin[1]);
    gl.uniform2f(this.u.u_view!, view[0], view[1]);
    gl.uniform1f(this.u.u_time!, time);
    gl.uniform1f(this.u.u_dayspeed!, dayspeed);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.inst);
    gl.deleteTexture(this.atlasTex);
  }
}
