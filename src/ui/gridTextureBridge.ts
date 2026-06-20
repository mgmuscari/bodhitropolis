// CPU → GPU data bridge for the hybrid satellite renderer (see
// docs/art/satellite-shader.md §1). Owns the packed RGBA byte buffer the shader
// samples as u_data_map, plus a dirty rectangle so only the changed region uploads
// (the WebGL twin of the renderer's drawBase invalidation). GL-agnostic and pure —
// the texSubImage2D upload lives in satelliteShader; here we only pack bytes and
// track what moved, so it is fully unit-testable without a GL context.
import { GameMap } from '../engine/map';
import { DATA_CHANNELS, packCell } from './satelliteFormat';

/** A dirty sub-rectangle to upload (x,y in cells; w,h in cells). */
export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class GridTextureBridge {
  readonly width: number;
  readonly height: number;
  /** Packed world grid, row-major, DATA_CHANNELS bytes per cell. */
  readonly data: Uint8Array;

  // Bounding box of changed cells since the last consumeDirty(); empty when min > max.
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * DATA_CHANNELS);
  }

  /** Repack every cell and mark the whole grid dirty. Call on world (re)load. */
  repackAll(map: GameMap): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        packCell(map, x, y, this.data, (y * this.width + x) * DATA_CHANNELS);
      }
    }
    this.markDirty(0, 0);
    this.markDirty(this.width - 1, this.height - 1);
  }

  /** Repack a single edited cell and extend the dirty rectangle to cover it. */
  repackCell(map: GameMap, x: number, y: number): void {
    packCell(map, x, y, this.data, (y * this.width + x) * DATA_CHANNELS);
    this.markDirty(x, y);
  }

  private markDirty(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  /**
   * Return the bounding rectangle of cells changed since the last call (the region
   * to texSubImage2D), then reset to clean. Null when nothing changed. A bounding
   * box can over-upload for scattered edits, but it is correct and keeps the upload
   * a single sub-rectangle — fine at this grid size.
   */
  consumeDirty(): DirtyRect | null {
    if (this.maxX < this.minX) return null;
    const rect: DirtyRect = {
      x: this.minX,
      y: this.minY,
      w: this.maxX - this.minX + 1,
      h: this.maxY - this.minY + 1,
    };
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    return rect;
  }
}
