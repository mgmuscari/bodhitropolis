// Shared scene LIGHTING — the single source of truth for how bright a point in the world is, combining
// the day/night sun, drifting cloud shadow, and smog haze (streetlight light-pollution will be added
// here next). The GPU shader applies this to the base tiles; the renderer applies the IDENTICAL math to
// the Canvas2D sprite layer, so a sprite is lit to the same level as the tile it stands on (Maddy
// 2026-06-20). The GLSL in satelliteShader.ts MIRRORS this — keep the two in sync (the unit tests pin
// the numbers). IO-free + pure (Math.sin is fine here — this module is NOT on the pure-ui allowlist).
//
// Coordinates are WORLD CELL space (the same `g` the shader samples). Time is seconds.

export const DAYSPEED = 0.04; // sun-arc rate (full day/night ≈ 2π/DAYSPEED ≈ 157s); shared with the shader
const NIGHT_FLOOR = 0.45; // darkest the scene gets at night (never fully black)
const CLOUD_MAX = 0.2; // peak cloud-shadow darkening
const SMOG_MAX = 0.35; // peak smog haze darkening at full pollution

/** Day/night brightness 0.45..1 — altitude = sin(day); dims/brightens via smoothstep, like the shader. */
export function dayNightBrightness(tSec: number): number {
  const alt = Math.sin(tSec * DAYSPEED);
  const t = clamp01((alt + 0.2) / 0.5); // smoothstep(-0.2, 0.3, alt)
  return NIGHT_FLOOR + (1 - NIGHT_FLOOR) * (t * t * (3 - 2 * t));
}

// ── Value-noise fBm matching the GLSL hash21/vnoise/fbm in satelliteShader.ts ──────────────────────
function fract(x: number): number {
  return x - Math.floor(x);
}
function hash21(x: number, y: number): number {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const dt = px * (px + 45.32) + py * (py + 45.32); // dot(p, p + 45.32)
  px += dt;
  py += dt;
  return fract(px * py);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
function fbm(x: number, y: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    x *= 2;
    y *= 2;
    a *= 0.5;
  }
  return s;
}

/** Cloud-shadow darkening 0..CLOUD_MAX at world cell (wx,wy), time tSec — the non-periodic fBm drifting
 *  with time (mirrors the shader's cloud term). */
export function cloudShadow(wx: number, wy: number, tSec: number): number {
  const c = fbm(wx * 0.35 + tSec * 0.02, wy * 0.35 + tSec * 0.015);
  const t = clamp01((c - 0.55) / 0.27); // smoothstep(0.55, 0.82, c)
  return t * t * (3 - 2 * t) * CLOUD_MAX;
}

/** The combined lighting MULTIPLIER 0..1 at a world cell: day/night × (1−cloud) × (1−smog). `smog01` is
 *  the local pollution 0..1. Multiply a tile/sprite colour by this to light it. */
export function lightingAt(wx: number, wy: number, tSec: number, smog01: number): number {
  const day = dayNightBrightness(tSec);
  const cloud = 1 - cloudShadow(wx, wy, tSec);
  const smog = 1 - clamp01(smog01) * SMOG_MAX;
  return day * cloud * smog;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
