import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Architecture guard. The engine and worldgen layers must stay headless
// (no DOM) and deterministic (no transcendental Math, whose rounding varies
// across JS engines and would break "same seed -> same world"). Dependency
// direction is enforced too: engine imports neither worldgen nor ui; worldgen
// must not import ui. This test IS the guard — it scans real source — plus a
// self-check that the matchers actually fire on synthetic bad input.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'src/engine');
const worldgenDir = path.join(root, 'src/worldgen');
// src/tech is scanned fail-closed: every file there must be headless and
// deterministic (it imports only from the engine layer). The scan auto-covers
// future tech files — see the behavioral probe test below.
const techDir = path.join(root, 'src/tech');
// src/tools is scanned fail-closed too: the tool system + pure input geometry are
// deterministic functions of (world, tech, action) and must stay headless (they
// import only from the engine + tech layers, never ui). Auto-covers tools.ts and
// inputGeometry.ts — see the behavioral probe test below.
const toolsDir = path.join(root, 'src/tools');

// DOM globals that must never appear in headless layers.
const FORBIDDEN_DOM = /\b(window|document|HTMLCanvasElement|requestAnimationFrame|navigator|localStorage)\b/;
// Transcendental Math banned by the determinism design rule; Math.random is
// banned everywhere in favour of the seeded rng.
const FORBIDDEN_MATH = /\bMath\.(exp|pow|log|sin|cos|tan|random)\b/;
// Imports from the ui layer.
const UI_IMPORT = /\bfrom\s+['"][^'"]*\/ui(?:\/[^'"]*)?['"]/;
// Imports from the worldgen layer (forbidden in engine).
const WORLDGEN_IMPORT = /\bfrom\s+['"][^'"]*\/worldgen(?:\/[^'"]*)?['"]/;

/** Remove block and line comments so prose mentioning banned tokens is ignored. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const engineFiles = tsFiles(engineDir);
const worldgenFiles = tsFiles(worldgenDir);
const techFiles = tsFiles(techDir);
const toolsFiles = tsFiles(toolsDir);

// Pure-ui allowlist: ui modules that carry NO DOM and NO transcendental Math, so
// they can be headless-tested like the engine/worldgen layers. The src/ui dir as
// a whole legitimately uses the DOM, so it cannot be scanned wholesale — these
// files are opted in explicitly. This is FAIL-OPEN: a new pure-ui module a dev
// forgets to append here goes unguarded. NEW PURE-UI MODULES MUST BE ADDED HERE.
// If they multiply, migrate them to a scanned src/ui/pure/ directory so the
// guard becomes fail-closed.
const PURE_UI_ALLOWLIST = ['src/ui/openingContent.ts', 'src/ui/techContent.ts', 'src/ui/renderKey.ts'];

describe('architecture guard: headless + deterministic', () => {
  it('discovers engine and worldgen source files', () => {
    expect(engineFiles.length).toBeGreaterThan(0);
    expect(worldgenFiles.length).toBeGreaterThan(0);
  });

  for (const file of [...engineFiles, ...worldgenFiles, ...techFiles, ...toolsFiles]) {
    const rel = path.relative(root, file);
    it(`${rel} is DOM-free, ui-free, and transcendental-Math-free`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(FORBIDDEN_DOM.test(code), `${rel} references a DOM global`).toBe(false);
      expect(FORBIDDEN_MATH.test(code), `${rel} uses transcendental Math`).toBe(false);
      expect(UI_IMPORT.test(code), `${rel} imports from ui`).toBe(false);
    });
  }

  for (const file of engineFiles) {
    const rel = path.relative(root, file);
    it(`${rel} (engine) does not import from worldgen`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(WORLDGEN_IMPORT.test(code), `${rel} imports from worldgen`).toBe(false);
    });
  }
});

describe('architecture guard: src/tech scanned fail-closed', () => {
  it('scans src/tech and finds at least one file (tree.ts)', () => {
    expect(techFiles.length).toBeGreaterThan(0);
  });

  // Behavioral proof that the scan covers src/tech: drop a throwaway file holding
  // a DOM token, re-run the exact scan primitives (tsFiles + stripComments +
  // FORBIDDEN_DOM), and assert it is BOTH discovered AND flagged — then unlink.
  // This is fail-closed: any future tech file is auto-covered, no allowlist needed.
  it('discovers and flags a synthetic DOM violation dropped into src/tech', () => {
    const probe = path.join(techDir, '__guard_probe__.ts');
    fs.writeFileSync(probe, 'export const el = document.getElementById("probe");\n');
    try {
      const discovered = tsFiles(techDir);
      expect(discovered, 'scan did not discover the probe file').toContain(probe);
      const code = stripComments(fs.readFileSync(probe, 'utf8'));
      expect(FORBIDDEN_DOM.test(code), 'scan did not flag the DOM token').toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});

describe('architecture guard: src/tools scanned fail-closed', () => {
  it('scans src/tools and finds at least one file (tools.ts)', () => {
    expect(toolsFiles.length).toBeGreaterThan(0);
  });

  // Behavioral proof the scan covers src/tools: drop a throwaway file holding a
  // DOM token, re-run the scan primitives, assert it is discovered AND flagged,
  // then unlink. Fail-closed: any future tools file is auto-covered.
  it('discovers and flags a synthetic DOM violation dropped into src/tools', () => {
    const probe = path.join(toolsDir, '__guard_probe__.ts');
    fs.writeFileSync(probe, 'export const el = window.document;\n');
    try {
      const discovered = tsFiles(toolsDir);
      expect(discovered, 'scan did not discover the probe file').toContain(probe);
      const code = stripComments(fs.readFileSync(probe, 'utf8'));
      expect(FORBIDDEN_DOM.test(code), 'scan did not flag the DOM token').toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});

describe('architecture guard: pure-ui allowlist', () => {
  for (const rel of PURE_UI_ALLOWLIST) {
    it(`${rel} is DOM-free and transcendental-Math-free`, () => {
      const code = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
      expect(FORBIDDEN_DOM.test(code), `${rel} references a DOM global`).toBe(false);
      expect(FORBIDDEN_MATH.test(code), `${rel} uses transcendental Math`).toBe(false);
    });
  }

  it('self-check: flags a synthetic pure-ui module that touches the DOM or transcendental Math', () => {
    const synthetic = 'const el = document.getElementById("x");\nconst y = Math.sin(1);';
    const code = stripComments(synthetic);
    expect(FORBIDDEN_DOM.test(code)).toBe(true);
    expect(FORBIDDEN_MATH.test(code)).toBe(true);
  });
});

describe('architecture guard self-check', () => {
  it('flags DOM identifiers', () => {
    expect(FORBIDDEN_DOM.test('const el = document.getElementById("x")')).toBe(true);
    expect(FORBIDDEN_DOM.test('window.requestAnimationFrame(cb)')).toBe(true);
  });

  it('flags transcendental Math and Math.random', () => {
    expect(FORBIDDEN_MATH.test('Math.exp(1)')).toBe(true);
    expect(FORBIDDEN_MATH.test('Math.pow(2, 3)')).toBe(true);
    expect(FORBIDDEN_MATH.test('Math.sin(x)')).toBe(true);
    expect(FORBIDDEN_MATH.test('Math.random()')).toBe(true);
  });

  it('does not flag exactly-rounded / integer Math', () => {
    expect(FORBIDDEN_MATH.test('Math.floor(x)')).toBe(false);
    expect(FORBIDDEN_MATH.test('Math.imul(a, b)')).toBe(false);
    expect(FORBIDDEN_MATH.test('Math.sqrt(y)')).toBe(false);
    expect(FORBIDDEN_MATH.test('Math.min(a, b); Math.max(a, b); Math.abs(c)')).toBe(false);
  });

  it('flags ui and worldgen imports', () => {
    expect(UI_IMPORT.test("import { Camera } from '../ui/camera'")).toBe(true);
    expect(UI_IMPORT.test("import x from '../../ui'")).toBe(true);
    expect(WORLDGEN_IMPORT.test("import { fbm } from '../worldgen/noise'")).toBe(true);
  });

  it('does not flag benign imports', () => {
    expect(UI_IMPORT.test("import { GameMap } from '../engine/map'")).toBe(false);
    expect(WORLDGEN_IMPORT.test("import { Rng } from '../engine/rng'")).toBe(false);
  });

  it('ignores banned tokens that appear only inside comments', () => {
    const src = '// mentions document and Math.exp and window\n/* navigator, Math.random */\nconst x = 1;';
    const code = stripComments(src);
    expect(FORBIDDEN_DOM.test(code)).toBe(false);
    expect(FORBIDDEN_MATH.test(code)).toBe(false);
  });
});
