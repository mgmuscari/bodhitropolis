import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../../src/ui/settingsStore';

/** A minimal in-memory Storage so the IO is testable headless (no jsdom dependency). */
function memStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

describe('settingsStore load/save (localStorage IO, injectable)', () => {
  it('round-trips a saved settings blob', () => {
    const store = memStorage();
    const next = { ...DEFAULT_SETTINGS, live: { ...DEFAULT_SETTINGS.live, pedCap: 777 } };
    saveSettings(next, store);
    expect(loadSettings(store).live.pedCap).toBe(777);
  });

  it('empty storage → the defaults', () => {
    expect(loadSettings(memStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('corrupt JSON → the defaults (never throws)', () => {
    const store = memStorage({ [SETTINGS_KEY]: '{ not valid json ' });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps an out-of-range persisted blob on load', () => {
    const store = memStorage({ [SETTINGS_KEY]: JSON.stringify({ live: { pedCap: 9_999_999 } }) });
    expect(loadSettings(store).live.pedCap).toBeLessThanOrEqual(8000);
  });

  it('clamps before persisting on save', () => {
    const store = memStorage();
    saveSettings({ ...DEFAULT_SETTINGS, world: { mapWidth: 9999, mapHeight: 9999 } }, store);
    const persisted = JSON.parse(store.getItem(SETTINGS_KEY)!);
    expect(persisted.world.mapWidth).toBeLessThanOrEqual(384);
  });

  it('missing storage (SSR / blocked) falls back to defaults without throwing', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, undefined)).not.toThrow();
  });
});
