// GPU smog overlay (part 2 of the hybrid shader — Maddy: "move other effects layers to GPU, especially
// smog, and layer appropriate layers ON TOP of sprites"). A transparent WebGL2 canvas stacked ABOVE the
// Canvas2D sprite/UI canvas (z-index 2 > #game z-index 1 > #gpu-base z-index 0), so the haze drifts over
// buildings AND sprites — the atmospheric layer the CPU drew last in drawSprites, now on the GPU.
//
// It samples the live air-pollution field (uploaded as an R8 texture from ambient.pollution) and
// billows wind-drifted fBm haze where pollution is high. Replaces the per-tile CPU smog-sprite draw in
// GPU mode (that path is gated off in the renderer); the CPU path remains the no-WebGL fallback.
//
// IO module (WebGL/DOM) — not on the pure-ui allowlist.
import { buildVertexSource } from './satelliteShader';
import { cameraToShaderView } from './gpuRenderer';
import type { Camera } from './camera';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`smog shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** Fragment: sample pollution at the world cell, billow wind-drifted fBm haze, output translucent
 *  grey-brown smog (normal alpha-blended over the page below). Pollution < threshold → fully clear. */
function buildSmogFragment(): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_poll; // R = air pollution 0..1 at world cell
uniform vec2 u_grid;      // pollution texture size in cells
uniform vec2 u_origin;    // top-left visible world cell
uniform vec2 u_view;      // visible window size in cells
uniform float u_time;     // seconds
uniform vec2 u_wind;      // prevailing wind (cells/sec-ish direction)
in vec2 v_uv;
out vec4 fragColor;
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p*=2.0;a*=0.5;}return s;}
void main(){
  vec2 cell = u_origin + v_uv * u_view;
  // sample pollution slightly UPWIND so the plume reads as streaming downwind from its source
  float poll = texture(u_poll, (cell - u_wind * 0.6 + 0.5) / u_grid).r;
  if (poll < 0.16) { fragColor = vec4(0.0); return; }
  vec2 q = cell * 0.5 - u_wind * u_time * 0.5;       // billowing, drifting with the wind
  float h = fbm(q + fbm(q * 0.5));
  float dens = clamp((poll - 0.16) / 0.84, 0.0, 1.0);
  float a = dens * (0.12 + 0.55 * h) * 0.62;
  vec3 col = mix(vec3(0.50, 0.48, 0.45), vec3(0.63, 0.60, 0.55), h); // grey-brown industrial haze
  fragColor = vec4(col, clamp(a, 0.0, 0.7));
}`;
}

export class SmogOverlay {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private pollTex: WebGLTexture | null = null;
  private readonly buf: Uint8Array;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly mapW: number, private readonly mapH: number) {
    this.buf = new Uint8Array(mapW * mapH);
  }

  /** Create the transparent WebGL2 canvas ABOVE the sprite canvas (z-index 2). Throws if no WebGL2. */
  mount(): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'gpu-smog';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2;';
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, buildVertexSource());
    const fs = compile(gl, gl.FRAGMENT_SHADER, buildSmogFragment());
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`smog link: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    this.vao = gl.createVertexArray();
    this.pollTex = gl.createTexture();
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_poll'), 0);
    for (const n of ['u_grid', 'u_origin', 'u_view', 'u_time', 'u_wind']) this.u[n] = gl.getUniformLocation(program, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // R8 pollution texture (LINEAR so the haze gradients smoothly across tiles).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pollTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.mapW, this.mapH, 0, gl.RED, gl.UNSIGNED_BYTE, this.buf);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (!this.canvas || !this.gl) return;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Upload the live pollution field + draw the haze for this frame. */
  render(
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    pollution: ReadonlyMap<number, number>,
    wind: { dx: number; dy: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    // Rebuild the pollution texture from the live field (16k cells → cheap).
    this.buf.fill(0);
    for (const [tile, amt] of pollution) {
      if (tile >= 0 && tile < this.buf.length) this.buf[tile] = amt > 255 ? 255 : amt < 0 ? 0 : amt;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pollTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.mapW, this.mapH, gl.RED, gl.UNSIGNED_BYTE, this.buf);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    gl.uniform2f(this.u.u_grid!, this.mapW, this.mapH);
    gl.uniform2f(this.u.u_origin!, origin[0], origin[1]);
    gl.uniform2f(this.u.u_view!, view[0], view[1]);
    gl.uniform1f(this.u.u_time!, timeSec);
    gl.uniform2f(this.u.u_wind!, wind.dx, wind.dy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.pollTex) gl.deleteTexture(this.pollTex);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.canvas?.remove();
    this.gl = null;
    this.canvas = null;
    this.program = null;
  }
}
