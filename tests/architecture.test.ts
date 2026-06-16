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
// src/ecology is scanned fail-closed too: the influence table, the ecology tick,
// and the biodiversity/report derivations are deterministic functions of the map
// (+ fabric taxonomy) and must stay headless (no DOM) and transcendental-free
// (Simpson's index is exact-rational, not Shannon). Auto-covers every future
// ecology file — see the behavioral probe test below.
const ecologyDir = path.join(root, 'src/ecology');
// src/civic is scanned fail-closed too: the neighborhood partition, the civic
// state/dynamics, the civic report, and the composite orchestrator are
// deterministic functions of (map, civic state, tech booleans) and must stay
// headless (no DOM) and transcendental-free. Civic writes only CivicState; the
// one sanctioned outward edge is civic → ecology (influenceOf for the fragmenting
// flag) — ecology never imports civic, so there is no cycle (asserted below).
// Auto-covers every future civic file — see the behavioral probe test below.
const civicDir = path.join(root, 'src/civic');
// src/traffic is scanned fail-closed: the traffic-density field ops and the O-D
// trip pathfinder are deterministic functions of (map, rng) and must stay headless
// (no DOM) and transcendental-free. Traffic imports only engine; it must not import
// civic/ecology/worldgen/ui (it is upstream of growth, sibling to ecology/civic).
const trafficDir = path.join(root, 'src/traffic');

// DOM globals that must never appear in headless layers.
const FORBIDDEN_DOM = /\b(window|document|HTMLCanvasElement|requestAnimationFrame|navigator|localStorage)\b/;
// Transcendental Math banned by the determinism design rule; Math.random is
// banned everywhere in favour of the seeded rng.
const FORBIDDEN_MATH = /\bMath\.(exp|pow|log|sin|cos|tan|random)\b/;
// Imports from the ui layer.
const UI_IMPORT = /\bfrom\s+['"][^'"]*\/ui(?:\/[^'"]*)?['"]/;
// Imports from the worldgen layer (forbidden in engine).
const WORLDGEN_IMPORT = /\bfrom\s+['"][^'"]*\/worldgen(?:\/[^'"]*)?['"]/;
// Imports from the civic layer (forbidden in ecology/tools/tech — civic is a
// downstream consumer; nothing it depends on may depend back on it).
const CIVIC_IMPORT = /\bfrom\s+['"][^'"]*\/civic(?:\/[^'"]*)?['"]/;
// Imports from the ecology layer (forbidden in tech — the wellbeing means reach
// effort.ts structurally, as plain numbers, never as an ecology import).
const ECOLOGY_IMPORT = /\bfrom\s+['"][^'"]*\/ecology(?:\/[^'"]*)?['"]/;

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
const ecologyFiles = tsFiles(ecologyDir);
const civicFiles = tsFiles(civicDir);
const trafficFiles = tsFiles(trafficDir);

// Pure-ui allowlist: ui modules that carry NO DOM and NO transcendental Math, so
// they can be headless-tested like the engine/worldgen layers. The src/ui dir as
// a whole legitimately uses the DOM, so it cannot be scanned wholesale — these
// files are opted in explicitly. This is FAIL-OPEN: a new pure-ui module a dev
// forgets to append here goes unguarded. NEW PURE-UI MODULES MUST BE ADDED HERE.
// If they multiply, migrate them to a scanned src/ui/pure/ directory so the
// guard becomes fail-closed.
const PURE_UI_ALLOWLIST = [
  'src/ui/openingContent.ts',
  'src/ui/techContent.ts',
  'src/ui/renderKey.ts',
  'src/ui/decoration.ts',
  'src/ui/toolbarContent.ts',
  'src/ui/ecoOverlayContent.ts',
  'src/ui/civicOverlayContent.ts',
  'src/ui/pulseContent.ts',
  'src/ui/repairTools.ts',
  'src/ui/lineTools.ts',
  'src/ui/reconcile.ts',
  'src/ui/dockContent.ts',
  'src/ui/ambientContent.ts',
];

describe('architecture guard: headless + deterministic', () => {
  it('discovers engine and worldgen source files', () => {
    expect(engineFiles.length).toBeGreaterThan(0);
    expect(worldgenFiles.length).toBeGreaterThan(0);
  });

  for (const file of [
    ...engineFiles,
    ...worldgenFiles,
    ...techFiles,
    ...toolsFiles,
    ...ecologyFiles,
    ...civicFiles,
    ...trafficFiles,
  ]) {
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

describe('architecture guard: src/ecology scanned fail-closed', () => {
  it('scans src/ecology and finds at least one file (influence.ts)', () => {
    expect(ecologyFiles.length).toBeGreaterThan(0);
  });

  // Behavioral proof the scan covers src/ecology: drop a throwaway file holding a
  // transcendental-Math token (Simpson's index must stay exact-rational), re-run
  // the scan primitives, assert it is discovered AND flagged, then unlink.
  // Fail-closed: any future ecology file is auto-covered, no allowlist needed.
  it('discovers and flags a synthetic transcendental-Math violation dropped into src/ecology', () => {
    const probe = path.join(ecologyDir, '__guard_probe__.ts');
    fs.writeFileSync(probe, 'export const x = Math.log(2);\n');
    try {
      const discovered = tsFiles(ecologyDir);
      expect(discovered, 'scan did not discover the probe file').toContain(probe);
      const code = stripComments(fs.readFileSync(probe, 'utf8'));
      expect(FORBIDDEN_MATH.test(code), 'scan did not flag the transcendental token').toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});

describe('architecture guard: src/civic scanned fail-closed', () => {
  it('scans src/civic and finds at least one file (neighborhoods.ts)', () => {
    expect(civicFiles.length).toBeGreaterThan(0);
  });

  // Behavioral proof the scan covers src/civic: drop a throwaway file holding a
  // DOM token, re-run the scan primitives, assert it is discovered AND flagged,
  // then unlink. Fail-closed: any future civic file is auto-covered.
  it('discovers and flags a synthetic DOM violation dropped into src/civic', () => {
    const probe = path.join(civicDir, '__guard_probe__.ts');
    fs.writeFileSync(probe, 'export const el = document.getElementById("probe");\n');
    try {
      const discovered = tsFiles(civicDir);
      expect(discovered, 'scan did not discover the probe file').toContain(probe);
      const code = stripComments(fs.readFileSync(probe, 'utf8'));
      expect(FORBIDDEN_DOM.test(code), 'scan did not flag the DOM token').toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});

describe('architecture guard: civic isolation (civic writes only CivicState)', () => {
  // The dependency direction: civic is a downstream consumer of ecology/engine/
  // tech. Nothing it depends on may import it back. AC #6 isolation depends on
  // these matchers being REAL (firing on a true violation) — so each ships a
  // self-check pair (positive fire + benign negative), mirroring the
  // WORLDGEN_IMPORT self-checks above. A vacuous matcher that never fires would
  // pass GREEN even while ecology/tools/tech actually imported civic.
  for (const file of [...ecologyFiles, ...toolsFiles, ...techFiles]) {
    const rel = path.relative(root, file);
    it(`${rel} does not import from civic`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(CIVIC_IMPORT.test(code), `${rel} imports from civic`).toBe(false);
    });
  }

  for (const file of techFiles) {
    const rel = path.relative(root, file);
    it(`${rel} (tech) does not import from ecology (wellbeing means arrive structurally)`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(ECOLOGY_IMPORT.test(code), `${rel} imports from ecology`).toBe(false);
    });
  }

  // Civic flood-fills the engine GameMap; it must never reach into worldgen
  // fields (PRP §2: NO worldgen edge — `world` is typed structurally as
  // {map, parcels}). The composite orchestrator is where the temptation arises.
  for (const file of civicFiles) {
    const rel = path.relative(root, file);
    it(`${rel} (civic) does not import from worldgen`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(WORLDGEN_IMPORT.test(code), `${rel} imports from worldgen`).toBe(false);
    });
  }

  it('self-check: CIVIC_IMPORT fires on a civic import and stays silent on a benign one', () => {
    expect(CIVIC_IMPORT.test("import { CivicState } from '../civic/state'")).toBe(true);
    expect(CIVIC_IMPORT.test("import { GameMap } from '../engine/map'")).toBe(false);
  });

  it('self-check: ECOLOGY_IMPORT fires on an ecology import and stays silent on a benign one', () => {
    expect(ECOLOGY_IMPORT.test("import { ecologyReport } from '../ecology/report'")).toBe(true);
    expect(ECOLOGY_IMPORT.test("import { GameMap } from '../engine/map'")).toBe(false);
  });
});

describe('architecture guard: src/traffic scanned fail-closed', () => {
  it('scans src/traffic and finds at least one file', () => {
    expect(trafficFiles.length).toBeGreaterThan(0);
  });

  it('discovers and flags a synthetic transcendental violation dropped into src/traffic', () => {
    const probe = path.join(trafficDir, '__guard_probe__.ts');
    fs.writeFileSync(probe, 'export const x = Math.random();\n');
    try {
      const discovered = tsFiles(trafficDir);
      expect(discovered, 'scan did not discover the probe file').toContain(probe);
      const code = stripComments(fs.readFileSync(probe, 'utf8'));
      expect(FORBIDDEN_MATH.test(code), 'scan did not flag the transcendental token').toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  // Traffic is sibling to ecology/civic and upstream of growth; it imports only engine.
  for (const file of trafficFiles) {
    const rel = path.relative(root, file);
    it(`${rel} (traffic) does not import from civic/ecology/worldgen`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(CIVIC_IMPORT.test(code), `${rel} imports from civic`).toBe(false);
      expect(ECOLOGY_IMPORT.test(code), `${rel} imports from ecology`).toBe(false);
      expect(WORLDGEN_IMPORT.test(code), `${rel} imports from worldgen`).toBe(false);
    });
  }
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
