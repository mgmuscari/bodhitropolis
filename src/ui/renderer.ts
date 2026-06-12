// Canvas2D pixel-art renderer v0. A thin DOM shell over the pure camera math:
// it builds a programmatic tile atlas once, then blits only the visible tile
// range with nearest-neighbour scaling for crisp pixels. All view math lives
// in Camera; this file holds no logic worth unit-testing (manual validation).

import { GameMap, Water, LandCover } from '../engine/map';
import { Camera, BASE_TILE } from './camera';

type RGB = readonly [number, number, number];

// Dharmapunk-warm palette: [base, accent] per tile kind. The accent is dithered
// in for subtle texture (deep/shallow water, gold-green meadows, deep forest).
const PALETTE: Record<string, readonly [RGB, RGB]> = {
  ocean: [[26, 52, 92], [32, 64, 110]],
  lake: [[40, 82, 120], [52, 98, 140]],
  river: [[60, 120, 162], [82, 150, 192]],
  bare: [[198, 178, 132], [212, 194, 152]],
  meadow: [[150, 158, 74], [172, 180, 96]],
  grass: [[82, 132, 62], [98, 152, 74]],
  forest: [[34, 80, 46], [46, 98, 58]],
};

const KINDS = Object.keys(PALETTE);
const BANDS = 4;

// 4x4 Bayer matrix → ordered dither thresholds (0..15).
const BAYER4: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function shade(c: RGB, delta: number): RGB {
  const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return [clampByte(c[0] + delta), clampByte(c[1] + delta), clampByte(c[2] + delta)];
}

function makeTile(base: RGB, accent: RGB): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = BASE_TILE;
  c.height = BASE_TILE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(BASE_TILE, BASE_TILE);
  for (let py = 0; py < BASE_TILE; py++) {
    for (let px = 0; px < BASE_TILE; px++) {
      const threshold = BAYER4[py % 4]![px % 4]!;
      const col = threshold < 5 ? accent : base; // ~5/16 accent coverage
      const o = (py * BASE_TILE + px) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function buildAtlas(): Map<string, HTMLCanvasElement> {
  const atlas = new Map<string, HTMLCanvasElement>();
  for (const kind of KINDS) {
    const [base, accent] = PALETTE[kind]!;
    for (let band = 0; band < BANDS; band++) {
      // Higher elevation band → slightly brighter; water bands stay subtle.
      const delta = (band - 1) * 7;
      atlas.set(`${kind}-${band}`, makeTile(shade(base, delta), shade(accent, delta)));
    }
  }
  return atlas;
}

function kindOf(map: GameMap, i: number): string {
  switch (map.water[i]) {
    case Water.Ocean:
      return 'ocean';
    case Water.Lake:
      return 'lake';
    case Water.River:
      return 'river';
  }
  switch (map.landCover[i]) {
    case LandCover.Forest:
      return 'forest';
    case LandCover.Grass:
      return 'grass';
    case LandCover.Meadow:
      return 'meadow';
    default:
      return 'bare';
  }
}

function bandOf(elevation: number): number {
  return Math.min(BANDS - 1, Math.max(0, Math.floor(elevation * BANDS)));
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: Map<string, HTMLCanvasElement>;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.atlas = buildAtlas();
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  render(map: GameMap, camera: Camera): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const ts = camera.tileSize;
    const range = camera.visibleTileRange();
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        const i = map.idx(tx, ty);
        const tile = this.atlas.get(`${kindOf(map, i)}-${bandOf(map.elevation[i]!)}`)!;
        const { sx, sy } = camera.worldToScreen(tx, ty);
        ctx.drawImage(tile, 0, 0, BASE_TILE, BASE_TILE, Math.floor(sx), Math.floor(sy), ts, ts);
      }
    }
  }
}
