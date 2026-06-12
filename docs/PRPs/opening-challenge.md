# PRP: Opening Challenge

## Source PRD: docs/PRDs/opening-challenge.md
## Date: 2026-06-12

## 1. Context Summary

Turn the merged worldgen output into the game's opening move: a pure
`BlightReport` over the WorldState, a structured chronicle parsed from
`world.log`, a seeded city-name generator, and a pixel-art opening overlay
that names the city, tells its century, shows its wounds, and challenges
the player to heal it. All logic pure and headless-tested; the overlay is a
thin DOM shell.

## 2. Codebase Analysis

- **Chronicle source format** (verified in src/worldgen/moses.ts):
  era-prefixed entries — `era1: founded at (x, y)` (:369), `era1: streetcar
  — N lines, M rail tiles` (:436), `era1: fabric — …` (:482), `era2: motor
  age — …` (:613), `era3: highway <axis> <index> from <lo> to <hi>` (:744,
  :755), `era3: rails removed N (peak M)` (:699, :760), `era3: urban
  renewal — …` (:793), `era4: suburban flight — …` (:954), `era5:
  disinvestment — D decayed, A abandoned, C craters (of P standing)`
  (:1022). Also `era1: no viable site` (:356) on all-water seeds.
  **Caveat:** `runPipeline` pushes bare stage names (`terrain`,
  `moses-century`) into the same log (src/worldgen/pipeline.ts:46) — the
  parser must skip non-`eraN:` lines.
- **Store accessors**: `count()` (fabric.ts:109) and `aliveCount()`
  (fabric.ts:119) exist → `count − aliveCount` = TOTAL demolitions (era-3
  renewal + era-5 abandonment), used for cohort abandonment share — NOT the
  report's headline `abandoned`, which is the era-5-only chronicle number
  (see Task 3 / YP2). Per-kind/condition scans via `aliveIndices()` + scalar
  accessors (`kindAt`, `conditionAt`).
- **Distance fields**: `distanceField(map, isSource, isPassable?)`
  (src/worldgen/fields.ts) — reuse with highway sources for the
  core/periphery split. Cohort thresholds (near ≤8, far ≥16) and the
  per-parcel reduction (MIN over footprint tiles, IGNORING unreachable `-1`)
  mirror `parcelHighwayDist` (tests/worldgen/moses.test.ts:526-548). **The
  report's TESTED gradient is per-cohort _abandonment share_** (counts the
  demolished, survivorship-free — the same KIND of count-based warrant as
  moses.test.ts:556-564, NOT the same cohort: the report folds in era-3
  corridor demolitions, which only strengthens the core's share; see below);
  the survivor-condition means (`coreMean`/`peripheryMean`) are descriptive
  display values only, NOT an asserted ordering (see Task 3 / Uncertainty
  Log). The full-assembly suite's gradient (`moses.test.ts:556`) measures a
  PRE-era-5 population scoring demolished parcels as 0 — a different
  population than the report's final-state survivors, so it cannot warrant a
  survivor-condition ≤.
- **Rng forking**: `createRng(seed).fork(label)` (src/engine/rng.ts) — the
  name generator forks `'city-name'` from the world seed, independent of
  pipeline stage streams by the fork-label contract.
- **UI shell pattern**: `src/main.ts` guards DOM access
  (`typeof document !== 'undefined'`, :67) and tests import it headless
  (tests/smoke.test.ts) — the overlay must preserve that. Styling lives
  inline in `index.html` (single-file CSS); renderer palette constants in
  src/ui/renderer.ts `PALETTE` (:26-34, `meadow` at :31; `#14121f` ground at
  index.html:13) inform overlay colors.
- **Architecture guard** (tests/architecture.test.ts) scans `src/engine` +
  `src/worldgen` only (dirs hard-coded at :15-16, asserted over the union at
  :52) — `names.ts` (engine) and `report.ts`/`chronicle.ts` (worldgen) fall
  under it automatically. `src/ui/openingContent.ts` is NOT scanned, so the
  guard does not currently cover it; **Task 4 EXTENDS the guard** with an
  explicit pure-ui allowlist (initially `['src/ui/openingContent.ts']`)
  checked for DOM-freeness + transcendental-Math-freeness, making the PRD's
  "architecture guard" mitigation real rather than convention-only.
- **Conventions**: TDD per task, atomic commits, ≤72-char subjects,
  `hashWorld` for any new determinism assertions, non-vacuous invariants.

**Execution mechanics:** team mode restored — this PRP expects
`/review-plan-team` for the plan gate and `/execute-team` for
implementation (proposer + reviewer teammates, message-gated).

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: City name generator
**Files:** `src/engine/names.ts`, `tests/engine/names.test.ts`
**Approach:** `cityName(rng: Rng): string` — 1-2 syllable core from
consonant/vowel tables (rng-indexed), optional American suffix
(`ford|haven|mills|ridge|port|field|crossing|falls`, weighted), title-case;
length clamp 4-16 chars. Pure rng consumer — no transcendental Math, no
state.
**Tests (RED):** pinned exact name for `createRng('bodhi-1').fork('city-name')`
(pin after first GREEN, assert forever); ≥8 distinct names across 10 seeds;
all names match `/^[A-Z][a-z]+$/` and length bounds; same rng fork → same
name twice (fresh forks).
**Validation:** `npx vitest run`

### Task 2: Chronicle parser
**Files:** `src/worldgen/chronicle.ts`, `tests/worldgen/chronicle.test.ts`
**Approach:**
```ts
interface ChronicleEntry { era: 1|2|3|4|5; years: string; events: string[] }
interface Chronicle { entries: ChronicleEntry[]; unparsed: string[] }
parseChronicle(log: readonly string[]): Chronicle
```
Era years fixed: 1=1900-1920, 2=1920-1945, 3=1945-1965, 4=1965-1985,
5=1985-2000. Match `/^era([1-5]):\s*(.+)$/`; group events under their era
in log order; era-prefixed lines with invalid numbers → `unparsed`;
non-era lines (stage names) silently skipped. Verbatim event text — no
rewriting.
**Tests (RED):** real pipeline (terrain + moses) across the founding seeds
moses-1/2/3 → entries for all five eras, each with ≥1 event, years correct;
exactly ONE `era3: rails removed` line per run (early-return XOR normal path,
never two); interleaved bare stage names absent from output; hand fixtures:
`era9: x` → unparsed, `era3:` empty-event handling (entry with `events: []`),
empty log → empty chronicle, ordering preserved within an era. (Degenerate:
an all-water log yields a single era-1 entry — not five; the overlay tolerates
this, see Task 5.)
**Validation:** `npx vitest run`

### Task 3: Blight report
**Files:** `src/worldgen/report.ts`, `tests/worldgen/report.test.ts`
**Approach:**
```ts
interface BlightReport {
  parcelsTotal: number; parcelsAlive: number; // store count() / aliveCount()
  preEra5Standing: number | null; // era5 "(of P standing)" — null if no era5
  abandoned: number | null;  // era5 "A abandoned" (disinvestment only); NOT
                             // count−alive (that folds in era-3 demolitions)
  craters: number | null;    // era5 "C craters"; NOT alive ParkingLot (era 2
                             // also places parking, moses.ts:599)
  conditionMean: number; conditionMedian: number;
  shareDerelict: number;   // alive condition < 64
  shareStruggling: number; // alive condition < 128
  projectsStanding: number; // alive Projects = towers STILL STANDING; the
                            // era-3 chronicle counts projects BUILT — these
                            // diverge once a project is abandoned (era-4
                            // decline / era-5). Named to never read as a
                            // contradiction of the era-3 line. (Projects are
                            // placed only at moses.ts:778; no conflation.)
  railLost: { removed: number; peak: number } | null; // from era3 log line
  // Core/periphery cohorts by min-over-footprint highway distance (see below).
  // Mean fields are DESCRIPTIVE (standing condition of survivors only); the
  // tested gradient invariant lives in the *AbandonedShare fields, which are
  // survivorship-free (count dead parcels, not just survivors). All four null
  // if the cohort has < 5 members.
  coreMean: number | null; peripheryMean: number | null;
  coreAbandonedShare: number | null; peripheryAbandonedShare: number | null;
  byKind: Partial<Record<BuiltKind, number>>; // alive parcels per kind
}
buildReport(world: { map; parcels; log }): BlightReport
```
`parcelsTotal`/`parcelsAlive` from `count()`/`aliveCount()`. `railLost`
parsed from the `era3: rails removed N (peak M)` line (null if absent).
**Chronicle-sourced wound counts** (so the overlay numbers MATCH the era-5
prose the player reads): `abandoned`, `craters`, `preEra5Standing` are parsed
from the single `era5: disinvestment — D decayed, A abandoned, C craters
(of P standing)` line (moses.ts:1022-1024) — all `null` if there is no era-5
line (e.g. all-water). They are deliberately NOT store-derived: `craters` as
"alive ParkingLot" overcounts (era 2 places healthy parking, moses.ts:599),
and `abandoned` as `count − aliveCount` folds in era-3 corridor demolitions
(moses.ts:657), both diverging from the era-5 headline. Mean/median over
ALIVE parcels; **guard the divide** — when `parcelsAlive === 0` (all-water),
set `conditionMean`/`conditionMedian` and both shares to `0` (avoid
`0/0 = NaN`, which is a valid number and would silently poison the report).

**Core/periphery cohorts.** Build a highway `distanceField` (sources:
`built === RoadHighway`, passable: all) over the FINAL map. A parcel's
highway distance is the MIN over its footprint tiles whose field value is
`>= 0` (unreachable `-1` tiles ignored); a parcel with no reachable highway
tile has distance `+∞`. Core = reachable AND min `<= 8`; periphery = min
`>= 16` (so a no-highway parcel is periphery-eligible, never core — this
fixes the `-1 <= 8` misclassification a naive threshold inherits). Mirrors
`parcelHighwayDist` (moses.test.ts:526-535) exactly. Each cohort is computed
over the FULL store (alive + tombstoned — `markDead` keeps geometry,
fabric.ts:141-143; `get(i)` reads any index), so abandonment is countable
per cohort. A cohort with < 5 members yields `null` for all four of its
fields. `coreMean`/`peripheryMean` = mean condition of the cohort's ALIVE
parcels (descriptive — survivorship-biased by construction, NOT an invariant).
`coreAbandonedShare`/`peripheryAbandonedShare` = (cohort total − cohort alive)
/ cohort total — the survivorship-FREE gradient measure (counts the
demolished — the same KIND of count-based warrant as moses.test.ts:556-564,
not the same cohort: this folds in era-3 corridor demolitions, which only
strengthens the core's share). All integer/exactly-rounded math.
**Tests (RED):** hand-built fixture (place + demolish known parcels —
INCLUDING ≥1 era-2-style healthy ParkingLot — plus a hand-written `era5:`
log line) → exact expected numbers for every field, proving `craters` tracks
the chronicle C and NOT the alive-ParkingLot count; real pipeline across the
founding seeds moses-1/2/3 (the full-assembly suite proves them rich):
determinism (two builds equal); **non-vacuous store↔chronicle identity**
`parcelsAlive === preEra5Standing − abandoned + craters` (the
moses.test.ts:573-574 warrant — cross-checks the parsed era-5 numbers against
`aliveCount()`, replacing the tautological `count − aliveCount`) — **GUARDED
to run only when the era-5 line is present** (founded seeds); the null branch
(all-water → those three fields null) is asserted separately below, never fed
into the arithmetic; shares within [0,1] and `shareDerelict ≤ shareStruggling`;
byKind sums to parcelsAlive.
**Gradient (survivorship-free):** with both cohorts non-null,
`coreAbandonedShare > 0` (non-vacuous) AND `coreAbandonedShare >=
peripheryAbandonedShare` — demolition concentrates at the highway (era-3
corridor carving at d=0 + era-5 steep-near decay) while far suburbs, built
healthy (HEALTHY_ATTRS, condition 200-255, moses.ts:226) in era 4 and barely
decayed at d>=16, are essentially never abandoned. `coreMean`/`peripheryMean` are asserted ONLY for determinism,
`[0,255]` bounds, and null-when-cohort<5 — NOT an ordering (they measure
survivors). All-water seed → `parcelsTotal === parcelsAlive === 0`,
`conditionMean`/`conditionMedian` and both shares EXACTLY `=== 0` (asserts the
NaN guard fired, not merely "no throw"), and
`abandoned`/`craters`/`preEra5Standing`/`railLost`/every cohort field `null`.
**Validation:** `npx vitest run`

### Task 4: Opening content (voice + formatting, pure)
**Files:** `src/ui/openingContent.ts`, `tests/ui/openingContent.test.ts`
**Approach:** DOM-free presentation strings:
`statLines(report): string[]` (4-6 legible lines, e.g. "412 parcels stand;
57 lost in the disinvestment years" — uses `report.abandoned`, the era-5
number; tolerates `null` chronicle-sourced fields by OMITTING that line);
`eraHeadline(entry): string` (year range + first event, verbatim) — must
handle an entry whose `events[]` is EMPTY (the Task-2 `era3:`-empty case →
`events[0]` is `undefined`): fall back to the year range alone, never emit
the literal "undefined"; `challengeText(name, report, chronicle): string[]`
— the dharmapunk register, hopeful and specific, referencing one real number
AND one real era fact. The **chronicle is now PASSED** (the report alone
carries no era narrative beyond `railLost`), so the copy can cite a verbatim
founding/streetcar/renewal event. No doom framing; 2-3 short paragraphs, ends
with the imperative to begin.
**Guard coverage (per §2):** this task ALSO extends
`tests/architecture.test.ts` with a pure-ui allowlist
(`['src/ui/openingContent.ts']`) asserted DOM-free + transcendental-Math-free,
so the pure/DOM boundary the PRD names is mechanically enforced, not
convention. The allowlist is FAIL-OPEN (a forgotten module goes unguarded), so
add a guiding comment in the test: **new pure-ui modules MUST be appended to
this allowlist.** If pure-ui modules multiply, migrate to a scanned
`src/ui/pure/` directory (fail-closed — anything dropped there is
auto-guarded); tracked in §6.
**Tests (RED):** statLines count and that each embeds the exact report
numbers; `challengeText` includes the city name, ≥1 digit from the report,
AND a verbatim substring of a real chronicle event (the "era fact" is now
ASSERTED, not just claimed); `eraHeadline` on an empty-`events` entry yields
the year range with no "undefined"; no line exceeds 90 chars; functions
deterministic (pure data in → same strings); the new guard test fails on a
synthetic `document`/`Math.sin` line in openingContent.ts (self-check).
**Validation:** `npx vitest run`

### Task 5: Opening overlay + wiring
**Files:** `src/ui/opening.ts`, `src/main.ts`, `index.html`
**Approach:**
- `opening.ts`: `mountOpening(container, content, onBegin)` builds one
  overlay element (name header, era list, stat lines, challenge
  paragraphs, Begin button) from pre-computed content; the era list renders
  WHATEVER entries the chronicle holds — 5 for a founded city, as few as 1
  for a no-viable-site seed — never assuming exactly 5 (PRD AC#5's "all five
  era entries" holds only for founded cities; flagged to team lead).
  Enter/Escape and button click call `onBegin` which removes the overlay and
  unbinds keys.
  No game imports — content arrives as plain data (keeps the shell thin
  and the dependency direction clean).
- `main.ts`: after `runPipeline`, compute name
  (`cityName(createRng(seed).fork('city-name'))`), chronicle, report,
  content; mount unless `?nointro=1`. Map input stays attached beneath;
  overlay is pointer-events-isolated until dismissed.
- `index.html`: overlay styles — dark panel on the existing `#14121f`
  ground, palette-consistent accent (meadow gold), monospace/pixel feel,
  max-width readable column.
**Tests:** headless-import safety of main.ts still green (existing smoke
test); overlay logic beyond content is manual (thin shell per established
renderer precedent).
**Validation:** `npx vitest run`; `npm run build`; manual `npm run dev`:
overlay shows with all sections; Begin/Enter/Escape dismiss; map
interactive after; `?nointro=1` skips; `?seed=` reproduces identical name
and numbers.

### Task 6: Visual verification + docs
**Files:** `README.md`
**Approach:** README: opening-challenge section (what the player sees,
`?nointro=1`). Browser verification (Playwright if available) on ≥2 seeds:
overlay renders, dismisses, map live behind; capture what was seen in the
final report.
**Tests:** none (docs).
**Validation:** `npx vitest run` still green.

## 4. Validation Gates

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run dev   # manual: overlay content, dismissal, ?nointro=1, ?seed= reproducibility
```

## 5. Rollback Plan

Additive: three new pure modules (names, chronicle, report) + two ui modules
(openingContent — pure/headless-tested + guarded; opening — the DOM shell);
main.ts gains a guarded block; index.html gains styles; architecture.test.ts
gains a pure-ui allowlist entry. Revert = don't merge; no schema/persistence
surface.

## 6. Uncertainty Log

- **Voice copy** will be judged at review; the structural tests (name +
  number presence, length bounds) can pass on flat copy — the human/review
  gate owns the register.
- **Era-3 rail line appears EXACTLY ONCE** per founded city: moses.ts:696-701
  is an early-return branch (`if (pbx1 < 0) { …push…; return; }`) and :760 is
  reachable only when that branch was NOT taken — the two pushes are mutually
  exclusive (early-return XOR normal path), never both, never zero. So the
  earlier "may appear twice / take the last occurrence" framing was a
  control-flow misread. The parser/report match the single `era3: rails
  removed N (peak M)` line; the Task-2 fixture asserts `count === 1` rather
  than silently last-wins (a dedupe-a-nonexistent-duplicate test would be
  vacuous and could mask a real regression).
- **Cohort nulls**: water-heavy seeds may lack highways (no era 3 corridor
  on no-viable-site maps) — every report field must degrade to null/0
  rather than throw; the all-water test pins this.
- **Survivorship bias in cohort means**: `coreMean`/`peripheryMean` measure
  only SURVIVORS, so a `coreMean <= peripheryMean` ordering is NOT guaranteed
  (era-5 abandons the worst near-highway parcels, leaving high-starting
  survivors) and is deliberately NOT asserted — the tested gradient uses the
  survivorship-free per-cohort abandonment share instead (Task 3). The means
  remain in the report purely as display values. **Flag to team lead:** PRD
  AC#2 ("core mean ≤ overall mean on blighted seeds") inherits the same
  survivorship flaw and should be read/restated as the abandonment-share
  gradient; the PRD is the source artifact, so this PRP does not edit it
  unilaterally.
- **Pure-ui guard is fail-open**: the `tests/architecture.test.ts` allowlist
  (Task 4) guards `openingContent.ts` but a future pure-ui module a dev
  forgets to append goes unguarded by default. Acceptable now (pure-ui is the
  exception, and a denylist over all of `src/ui` — which legitimately uses the
  DOM — would be worse), mitigated by a guiding comment in the test. Trigger
  to revisit: if pure-ui modules multiply, move them to a scanned
  `src/ui/pure/` directory so the guard becomes fail-closed.
- **Overlay scroll** on small viewports: accept internal scroll; no
  responsive pass in scope.
