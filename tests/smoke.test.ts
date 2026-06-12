import { describe, it, expect } from 'vitest';

// Importing main must not throw in a headless (non-DOM) environment.
// This proves the browser-entry module is safe to import under Vitest.
import * as main from '../src/main';

describe('smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('imports the browser entry without throwing headless', () => {
    expect(main).toBeDefined();
    expect(typeof main.main).toBe('function');
  });
});
