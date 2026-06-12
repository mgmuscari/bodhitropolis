# Plan Review: bodhitropolis-foundation

## Verdict: REQUESTS CHANGES
## Reviewer Stance: Interlocutor
## Date: 2026-06-12

> **Mode note:** Team mode (`/review-plan-team`) was attempted first and is
> environmentally unavailable this session — teammate spawning failed twice
> with `Failed to create iTerm2 split pane: Session … not found` (the iTerm2
> API cannot find the pane this session runs in). Per the decision rule in
> CLAUDE.md ("No team support → sequential"), this is the sequential
> `/review-plan` review. The substitution was reported to the user when it
> happened, not silently.

## Yield Points Found

### 1. River connectivity test is vacuous as specified
**Severity:** Structural
**Evidence:** PRP Task 7 tests: "every `River` cell has a 4-neighbor that is
water or is on the map edge." River cells are themselves water
(`Water.River`), so any contiguous river path of length ≥ 2 satisfies
neighbor-is-water trivially — a stranded loop or orphaned segment in the
middle of land passes the test. PRD acceptance criterion 6 requires "rivers
reach map edge or water body," which this does not verify.
**Pressure applied:** "Construct a failing world that passes the test." A
2-cell river island passes instantly.
**Recommendation:** Trace each connected river component (BFS over `River`
cells); assert every component contains at least one cell that is on the map
edge OR 4-adjacent to an `Ocean`/`Lake` cell. This tests the actual PRD
claim.

### 2. Cross-engine float determinism: `Math.exp` breaks the reproducibility promise
**Severity:** Structural
**Evidence:** PRP Task 7 step 4 maps moisture "through exp falloff."
IEEE-754 guarantees exact rounding for `+ - * / sqrt`, but **not** for
transcendentals — `Math.exp` results differ across JS engines and even V8
versions. The project's north star (PRD §2: "Same seed → same world …
Dwarf Fortress-style") implies a seed shared between players reproduces the
same map in any browser. Engine-dependent `exp` silently breaks that, and
no test can catch it in-process (the PRP's double-run comparison only proves
within-engine determinism).
**Pressure applied:** "Same seed on Chrome and Firefox — identical map?"
Today: not guaranteed.
**Recommendation:** Add a design rule to the PRP: engine/worldgen math must
avoid transcendental `Math` functions; use exactly-rounded ops only. Replace
the exp falloff with a rational falloff (e.g. `1/(1 + k·d)` or `(1 - d/dmax)²`
clamped) — visually equivalent, deterministic everywhere. Keep exact-pin
tests restricted to integer/PRNG outputs (the PRP already does this — good).

### 3. Converted git hooks fail confusingly without `node_modules`
**Severity:** Moderate
**Evidence:** PRP Task 1 converts pre-commit to `npx tsc --noEmit` and
pre-push to `npx vitest run`. On a fresh clone before `npm install`, `npx`
will attempt a network fetch of `typescript`/`vitest` (slow, version-drifting,
or hard-fails offline) instead of failing with a useful message. Hooks are
copied into `.git/hooks/` by `scripts/setup.sh` (cp at scripts/setup.sh:36 —
verified: copies, not symlinks, so re-running setup after editing is indeed
required, as the PRP suspected).
**Pressure applied:** "Fresh clone, `./scripts/setup.sh`, edit a file,
commit." The hook's failure mode is an npx registry fetch, not guidance.
**Recommendation:** Hooks guard with `[ -d node_modules ] || { echo "run npm
install first"; exit 1; }` before invoking npx. Note in Task 1 approach.

### 4. Execution mechanics dead-end: solo-block hook vs. unavailable teams
**Severity:** Moderate (process, not plan content — but it will stop Task 1)
**Evidence:** `.claude/hooks/block-solo-implementation.sh:40-56` blocks all
Edit/Write to `*/src/*` and `*/tests/*` on standard-tier feature branches
unless `DIALECTIC_TEAM_AGENT=1` or a matching `~/.claude/teams/<prefix>-
<slug>/config.json` exists. This session's team spawning is environmentally
broken (iTerm2 split-pane failure, twice). The hook's own block message
offers `/execute-prp` as the sanctioned fallback, but a main-session
`/execute-prp` hits the same hook — the sanctioned path is mechanically
impossible as configured. The repo ships the designed escape:
`scripts/claude-teammate-wrapper.sh` spawns headless `claude` teammate
processes with `DIALECTIC_TEAM_AGENT=1` (no iTerm panes involved).
**Pressure applied:** "Walk Task 1 through the gates as this session is
actually configured." It cannot pass.
**Recommendation:** Add an "Execution mechanics" note to the PRP: implement
via a proposer agent carrying `DIALECTIC_TEAM_AGENT=1` (the repo's
`scripts/claude-teammate-wrapper.sh` mechanism / a headless proposer process),
keeping the team lead out of `src//tests/` per the hook's intent. If that
also proves unavailable, stop and surface to the human rather than editing
around the gate.

### 5. `const enum` uncertainty should be resolved in-plan, not deferred
**Severity:** Minor
**Evidence:** PRP Task 4 specifies `const enum Water/LandCover`; the
Uncertainty Log itself notes esbuild (Vite's transpiler) does not support
cross-module `const enum` erasure. Known footgun; zero benefit at this scale.
**Recommendation:** Specify plain literal-union types (`type Water = 0|1|2|3`
with named consts) or regular enums now; delete the uncertainty entry.

### 6. Production build never validated
**Severity:** Minor
**Evidence:** PRP defines `npm run build` (tsc && vite build) in Task 1 but
no validation gate ever runs it; esbuild-specific breakage (e.g. yield point
5) would surface only at first deploy.
**Recommendation:** Add `npm run build` to §4 Validation Gates (and to Task
9's validation, where the full app first exists).

### 7. Factual: `.gitignore` already covers Node
**Severity:** Minor
**Evidence:** `.gitignore:17` (`dist/`) and `.gitignore:29`
(`node_modules/`) already exist — Task 1's "append node_modules/, dist/" and
§2's "likely lacks Node entries" are wrong.
**Recommendation:** Drop the `.gitignore` edit from Task 1.

## What Holds Well

- **Task decomposition is genuinely TDD-shaped**: each task pairs a concrete
  RED test list with implementation, sized for one atomic commit, in
  dependency order (PRNG → loop → map → noise → pipeline → terrain → guard →
  UI).
- **The purity rule (engine/worldgen DOM-free, enforced by an architecture
  test, camera math kept pure) is the right structural bet** for headless
  testability and a future renderer swap.
- **rng `fork(label)` per pipeline stage** with the "removing stage B doesn't
  perturb stage C" test is exactly the determinism contract DF-style worldgen
  needs — this is the strongest part of the plan.
- **Verified references hold**: `MapGenerator.java` line cites (doBRiv:255,
  makeLakes:212, treeSplash:457, BRMatrix:327) are accurate; hook self-skip
  patterns at `scripts/hooks/pre-commit:13` / `pre-push:13` are as described;
  root `src/`/`tests/` exist (empty), so no directory-creation surprises.
- Typed-array layers + `snapshot()` give cheap determinism assertions and
  performance headroom, as the PRD demands.

## Summary

The plan's architecture and task structure are sound — the two structural
yield points are both *testing/determinism* gaps, not design flaws: the river
test doesn't test the PRD claim, and transcendental math quietly breaks the
cross-platform reproducibility the whole worldgen vision rests on. Both have
small, concrete fixes. With those plus the moderate items (hook guard,
execution-mechanics note) folded into the PRP, this is ready for execution.

**Path forward:** Revise the PRP per yield points 1-7 (a regeneration is not
needed — targeted edits suffice), then proceed to execution via the
mechanism in yield point 4.
