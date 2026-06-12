import { describe, it, expect } from 'vitest';
import { GameMap, Water, LandCover } from '../../src/engine/map';

describe('GameMap dimensions', () => {
  it('defaults to 128x128 with correctly sized typed-array layers', () => {
    const m = new GameMap();
    expect(m.width).toBe(128);
    expect(m.height).toBe(128);
    const n = 128 * 128;
    expect(m.elevation).toBeInstanceOf(Float32Array);
    expect(m.elevation.length).toBe(n);
    expect(m.moisture).toBeInstanceOf(Float32Array);
    expect(m.moisture.length).toBe(n);
    expect(m.water).toBeInstanceOf(Uint8Array);
    expect(m.water.length).toBe(n);
    expect(m.landCover).toBeInstanceOf(Uint8Array);
    expect(m.landCover.length).toBe(n);
    expect(m.built).toBeInstanceOf(Uint16Array);
    expect(m.built.length).toBe(n);
    expect(m.parcel).toBeInstanceOf(Uint16Array);
    expect(m.parcel.length).toBe(n);
    // Ecology layers: three Uint8 fields, zero-initialised.
    expect(m.soilHealth).toBeInstanceOf(Uint8Array);
    expect(m.soilHealth.length).toBe(n);
    expect(m.floraVitality).toBeInstanceOf(Uint8Array);
    expect(m.floraVitality.length).toBe(n);
    expect(m.faunaPresence).toBeInstanceOf(Uint8Array);
    expect(m.faunaPresence.length).toBe(n);
  });

  it('honours custom dimensions', () => {
    const m = new GameMap(64, 32);
    expect(m.width).toBe(64);
    expect(m.height).toBe(32);
    expect(m.elevation.length).toBe(64 * 32);
  });

  it('rejects non-positive or non-integer dimensions', () => {
    expect(() => new GameMap(0, 10)).toThrow();
    expect(() => new GameMap(10, -1)).toThrow();
    expect(() => new GameMap(10.5, 10)).toThrow();
  });
});

describe('GameMap idx / inBounds', () => {
  it('computes row-major idx at corners', () => {
    const m = new GameMap(128, 128);
    expect(m.idx(0, 0)).toBe(0);
    expect(m.idx(127, 0)).toBe(127);
    expect(m.idx(0, 1)).toBe(128);
    expect(m.idx(127, 127)).toBe(128 * 128 - 1);
  });

  it('inBounds is true inside and false past every edge', () => {
    const m = new GameMap(128, 128);
    expect(m.inBounds(0, 0)).toBe(true);
    expect(m.inBounds(127, 127)).toBe(true);
    expect(m.inBounds(-1, 0)).toBe(false);
    expect(m.inBounds(0, -1)).toBe(false);
    expect(m.inBounds(128, 0)).toBe(false);
    expect(m.inBounds(0, 128)).toBe(false);
  });
});

describe('GameMap layer get/set roundtrips', () => {
  it('roundtrips elevation and moisture (float32)', () => {
    const m = new GameMap(16, 16);
    m.setElevation(3, 4, 0.5);
    m.setMoisture(3, 4, 0.25);
    expect(m.getElevation(3, 4)).toBeCloseTo(0.5, 6);
    expect(m.getMoisture(3, 4)).toBeCloseTo(0.25, 6);
    // untouched cell stays zero
    expect(m.getElevation(0, 0)).toBe(0);
  });

  it('roundtrips water and landCover (enum)', () => {
    const m = new GameMap(16, 16);
    m.setWater(1, 1, Water.Ocean);
    m.setLandCover(2, 2, LandCover.Forest);
    expect(m.getWater(1, 1)).toBe(Water.Ocean);
    expect(m.getLandCover(2, 2)).toBe(LandCover.Forest);
    expect(m.getWater(0, 0)).toBe(Water.None);
    expect(m.getLandCover(0, 0)).toBe(LandCover.Bare);
  });

  it('roundtrips built (uint16)', () => {
    const m = new GameMap(16, 16);
    m.setBuilt(5, 5, 4095);
    expect(m.getBuilt(5, 5)).toBe(4095);
    expect(m.getBuilt(0, 0)).toBe(0);
  });

  it('roundtrips parcel (uint16, 0 = none)', () => {
    const m = new GameMap(16, 16);
    m.setParcel(6, 7, 42);
    expect(m.getParcel(6, 7)).toBe(42);
    expect(m.getParcel(0, 0)).toBe(0);
  });

  it('roundtrips ecology layers (uint8, 0 = none)', () => {
    const m = new GameMap(16, 16);
    m.setSoilHealth(3, 4, 200);
    m.setFloraVitality(5, 6, 128);
    m.setFaunaPresence(7, 8, 255);
    expect(m.getSoilHealth(3, 4)).toBe(200);
    expect(m.getFloraVitality(5, 6)).toBe(128);
    expect(m.getFaunaPresence(7, 8)).toBe(255);
    // untouched cells stay zero
    expect(m.getSoilHealth(0, 0)).toBe(0);
    expect(m.getFloraVitality(0, 0)).toBe(0);
    expect(m.getFaunaPresence(0, 0)).toBe(0);
  });
});

describe('GameMap snapshot', () => {
  it('is equal for two maps with identical content', () => {
    const a = new GameMap(32, 32);
    const b = new GameMap(32, 32);
    a.setElevation(1, 1, 0.5);
    b.setElevation(1, 1, 0.5);
    expect(a.snapshot()).toBe(b.snapshot());
  });

  it('differs after a single-cell mutation in any layer', () => {
    const make = () => new GameMap(32, 32);
    const base = make().snapshot();

    const e = make();
    e.setElevation(10, 10, 0.5);
    expect(e.snapshot()).not.toBe(base);

    const w = make();
    w.setWater(10, 10, Water.River);
    expect(w.snapshot()).not.toBe(base);

    const mo = make();
    mo.setMoisture(10, 10, 0.5);
    expect(mo.snapshot()).not.toBe(base);

    const lc = make();
    lc.setLandCover(10, 10, LandCover.Grass);
    expect(lc.snapshot()).not.toBe(base);

    const bu = make();
    bu.setBuilt(10, 10, 1);
    expect(bu.snapshot()).not.toBe(base);

    const pa = make();
    pa.setParcel(10, 10, 1);
    expect(pa.snapshot()).not.toBe(base);

    const so = make();
    so.setSoilHealth(10, 10, 1);
    expect(so.snapshot()).not.toBe(base);

    const fl = make();
    fl.setFloraVitality(10, 10, 1);
    expect(fl.snapshot()).not.toBe(base);

    const fa = make();
    fa.setFaunaPresence(10, 10, 1);
    expect(fa.snapshot()).not.toBe(base);
  });

  it('distinguishes maps of different dimensions', () => {
    expect(new GameMap(32, 32).snapshot()).not.toBe(new GameMap(16, 64).snapshot());
  });
});
