# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operating Principles

**Default mode here: the tight iterative loop.** Most Bodhitropolis work is playtest-driven — the maintainer plays the running game, reports what she sees, and we fix → live-verify (browser / the `window.bodhitropolis` dev API) → ship a small PR, fast. This loop is **iterative direct-TDD**: implement directly, RED → GREEN → REFACTOR, atomic commits, verify live. Teams can't play the game or drive live verification, so they don't fit this loop — the dialectic lands at *review* time (the live pass + the bug queue), not team ceremony.

**Teams for the larger, colder work.** Longer or more complex *non-playtest* features still use the dialectic pipeline (`/new-feature` → `/review-plan-team` → `/execute-team` → `/review-code-team`). Teams are available; reach for them when the work isn't driven by playing the game.

**Program like the architect.** Several bugs in one subsystem usually mean ONE missing abstraction — step back and build it; don't patch symptom by symptom. Ask "what would the person who designed this idea write?", and build the right abstraction the first time. The maintainer is a senior platform/AI architect — work peer-level (lead with architecture and trade-offs, skip the basics), default to full autonomy, and keep answers short.

**Bug queue.** Playtest bugs go in `docs/bug-queue.md` (which also tracks the active direction). They're recorded as seen — not necessarily fixed at once — so check that file when touching related code and fix opportunistically; mark fixed with the PR. Never call an active direction "deferred".

**Pressure demands the *right* structure.** Scope pressure → tighten methodology (more review, more planning). Performance/bug pressure → tighten feedback loops (faster iteration, empirical validation). Never abandon structure — match it to the problem type.

**The dialectic is the product** (when teams run). The structured tension between proposer and interlocutor is the mechanism that produces quality on cold/complex work — don't bypass it there.

**TDD is mandatory.** All implementation follows RED → GREEN → REFACTOR. Tests are written before implementation code. Never mock to make tests pass — fix the real issue. Never weaken tests to get green.

## Project Overview

Bodhipolis is built on the open-source Micropolis codebase — the GPL release of the original SimCity Classic (Maxis/Will Wright), as open-sourced for the One Laptop Per Child program and maintained at [SimHacker/micropolis](https://github.com/SimHacker/micropolis). This repo tracks that upstream (git remote `micropolis`).

This project uses the Dialectic development methodology (see `dialectic.md` for the methodology spec). Methodology files in `.claude/`, `prompts/`, `scripts/`, and `docs/*/TEMPLATE.md` are synced from the [dialectic-development](https://github.com/mgmuscari/dialectic-development) template — update them upstream and re-sync rather than diverging locally where possible.

## Architecture

The repository contains several parallel implementations of Micropolis from different eras:

- `micropolis-activity/` — The original Unix/X11 version in C with a TCL/Tk frontend, packaged as an OLPC Sugar activity. Built with its own `makefile`.
- `MicropolisCore/` — The C++ rewrite: `MicropolisEngine` (simulation core), `TileEngine`, and `CellEngine`, each with SWIG-generated Python bindings. Includes a GTK+/Cairo Python frontend (`MicropolisCore/src/run-gtkfrontend`). See `INSTALL.txt` for platform build instructions.
- `micropolis-java/` — MicropolisJ, a self-contained Java port. Built with Ant (`build.xml`); see its `HACKING` and `INSTALL` files.
- `turbogears/` — TurboGears (Python) web frontend for the C++/Python engine.
- `laszlo/` — OpenLaszlo (Flash) client.
- `aws/`, `wikimedia/`, `micropolis-graphics/` — deployment configs and art assets.

`BUGS.txt`, `NOTES.txt`, and `PROGRESS.txt` are legacy upstream notes. The root `makefile` drives the OLPC/Unix build.

## Setup

```bash
./scripts/setup.sh    # Install git hooks, verify Dialectic directory structure and templates
```

Platform builds for the game itself are legacy and per-subtree: `INSTALL.txt` (MicropolisCore on macOS/Windows), `micropolis-activity/makefile` (TCL/Tk version), `micropolis-java/build.xml` (Ant).

The git hooks in `scripts/hooks/` default to Python tooling (`ruff`, `mypy`, `pytest`) scoped to the root `src/` and `tests/` directories, and self-skip when no Python files exist there. Replace their commands with the appropriate build/test commands once a primary development subtree is chosen.

## Development Lifecycle Pipeline

Four workflow tiers (light/iterative/standard/full) match process weight to change size. The nominal default is standard, but **for Bodhitropolis's playtest-debug loop, iterative is the working default** (see Operating Principles) — reserve standard/full + teams for larger, colder, non-playtest features. Tier metadata is stored in `.dialectic-tier` on feature branches — this file must never reach `main`.

```
Light:     Feature Branch → Implement (TDD) → /review-code (optional) → PR → Merge
Iterative: Feature Branch → Implement (TDD) → Benchmark/Test → Fix → Loop → /review-code → PR → Merge
Standard:  /new-feature → PRD + PRP → /review-plan → /execute-prp (TDD) → /review-code → PR → Merge
Full:      Standard pipeline + /security-audit (expected) → PR → Merge
Scale:     /dialectic-sweep (codebase audit) or /dialectic-migrate (wide migration) → land/triage → PR → Merge
```

**Scale tier (dynamic workflows, Claude Code only)** — For work too large for a single PR diff:
whole-codebase bug hunts/security/quality sweeps (`/dialectic-sweep`) and mechanical changes across
many files (`/dialectic-migrate`). These run a background, resumable `Workflow` that fans the
dialectic out — finders propose, independent skeptics refute, only survivors are reported. Set
`.dialectic-tier` to `workflow` for migrations (it edits code directly). See
`docs/guides/dynamic-workflows.md`. No OpenCode equivalent — scope down to a branch on other backends.

Each arrow is a gate. Work does not proceed until the gate passes. Interlocutors can reject, request changes, or send work back to a previous stage.

**Iterative tier** — For work driven by empirical feedback loops: performance optimization, benchmark-driven accuracy improvement, bug investigation with reproduction cycles. Direct implementation is allowed (no team mode required). TDD is mandatory. The developer is present and directing — the dialectic happens at code review time, not implementation time. Use `/investigate` to enter this workflow. Drive the loop with **`/goal`** (a bounded completion condition the model checks each turn, e.g. "metric ≥ target AND tests pass, or stop after N turns") and watch long benchmarks/builds live with the **`Monitor`** tool instead of re-running and polling. `/goal` replaces the manual loop — it does not replace the RED test.

**Pipeline change:** `/new-feature` now auto-generates both the PRD and PRP in one invocation (standard/full tiers). `/generate-prp` remains available for regenerating just the PRP.

### Team Mode (default for standard/full tiers)

**Default: Use team commands** (`/review-plan-team`, `/execute-team`, `/review-code-team`, `/security-audit-team`) for standard and full tiers. Sequential commands (`/review-plan`, `/execute-prp`, `/review-code`, `/security-audit`) are available but the team variants produce better outcomes through structured dialectical tension.

Agent teams run proposer and interlocutor stances concurrently using Claude Code agent teams. Same artifact types at the same paths, with additional fields capturing the dialectical exchange.

```
Team Plan Review: /review-plan-team → concurrent PRP review + revision
Team Execute:     /execute-team → message-gated implementation (TDD) + incremental review
Team Code Review: /review-code-team → finding-by-finding exchange (reviewer + defender)
Team Audit:       /security-audit-team → dual-agent security audit with peer challenge
```

Requires: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in Claude Code settings. See `docs/guides/agent-teams.md`.

### Workflows vs. Teams vs. Sequential

Three substrates for the dialectic — pick by scope and locus, not preference:

- **Agent teams** (`/review-plan-team`, `/execute-team`, `/review-code-team`, `/security-audit-team`) — a **live, human-in-the-loop** exchange over **one PR/branch diff**. The team lead participates; the exchange is visible and message-gated. Default for standard/full tiers. The dialectic is the product, and here it is conversational.
- **Dynamic workflows** (`/dialectic-sweep`, `/dialectic-migrate`) — a **background, resumable** exchange over the **whole codebase**: finders propose, independent skeptics refute, survivors are reported. Use when scope exceeds a single diff. Claude Code only; consumes substantially more tokens.
- **Sequential** (`/execute-prp`, `/review-code`, `/security-audit`) — the solo fallback when teams are unavailable (e.g. portable backends). Same artifacts, no concurrent dialectic.

**Decision rule: one PR → team. Whole codebase → workflow. No team support → sequential.** Teams stay the primary substrate; workflows *add* a scale tier, they do not replace the team commands.

**Known team bugs and hardening:**
- Agent definitions (`.claude/agents/*.md`) **do** load for team members — both `tools:` frontmatter and body prose (bug #24316 resolved, verified 2026-04-22). The inline-stance workaround has been removed. Caveat: keep body-referenced tools in the `tools:` grant.
- Model inheritance (bug #32368) was verified fixed by live probe on 2026-06-01: team agents spawned with no explicit `model:` ran and produced coherent, capable output (no idle/degrade). Team commands and agent definitions still set `model: "opus"` explicitly as defense-in-depth.
- Team commands include a health check: if teammates don't start within 90 seconds, the team is shut down and the user is notified with options to retry or use sequential commands. Teams never silently fall back to solo implementation.

### Multi-Platform Support

Portable workflow templates live in `prompts/`. Platform adapters live in `adapters/`. Claude Code commands in `.claude/commands/` are the reference implementation. When methodology changes, update `prompts/workflows/` first, then sync platform-specific files.

## Agent Stances (AGENTS.md)

Five defined stances, each with distinct optimization targets:

- **Proposer** — Completion-oriented, used for `/new-feature`, `/generate-prp`, `/execute-prp`
- **Interlocutor** — Senses structural weakness in plans, used for `/review-plan`. Cannot write code, only test balance. Assumes at least 3 yield points exist.
- **Code Review Partner** — Reviews diff against PRP spec, used for `/review-code`
- **Security Auditor** (hard stance) — Exploit-minded, requires PoC for HIGH+ findings
- **Skeptical Client** (hard stance) — Challenges severity inflation, demands proof. Paired with Auditor in `/security-audit`

Stances are context primes, not role descriptions. "Dialectic" framing produces different attentional quality than "adversarial review."

**Note:** Agent definitions in `.claude/agents/*.md` use `model: opus` explicitly. The `model: inherit` setting does not resolve properly (bug #32368). Agent definitions now load for team members (bug #24316 resolved, verified 2026-04-22), so stance constraints come from the definitions for both team and sequential spawns — the inline-stance workaround has been removed. Keep body-referenced tools in each stance's `tools:` grant.

## Key Design Decisions

- **Documents are the product.** PRDs and PRPs are engineered context, not afterthought documentation. If documents are wrong, code will be wrong.
- **PRPs target one-pass implementation.** A good PRP contains everything the executing agent needs — code patterns, library docs, test strategies, validation commands — without searching or asking questions.
- **TDD is the execution method.** Every implementation task follows RED → GREEN → REFACTOR. Tests define the contract; implementation fulfills it.
- **Git is memory.** Conventional commits, feature branches, and review artifacts are persistent context for future agent invocations.
- **The template is language-agnostic.** Hook examples use `ruff`/`mypy`/`pytest` (Python) but are explicitly meant to be swapped for any stack's equivalents.
- **Team mode augments, not replaces.** Sequential commands remain unchanged. Team commands produce the same artifact types at the same paths, with additional fields capturing the dialectical exchange.
- **Critic agents are tool-restricted.** Interlocutor and code reviewer have no Write/Edit access. The "cannot write code" constraint is enforced at the tool level, not just the prompt level.
- **Teams abort, never silently degrade.** If team spawning fails, the system stops and reports to the user with options. It never falls back to solo implementation.

## Conventions

- Branches: `feature/<slug>` from `main`
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), max 72 chars first line
- PRDs: `docs/PRDs/<feature-slug>.md`
- PRPs: `docs/PRPs/<feature-slug>.md` (matches PRD slug)
- Reviews: `docs/reviews/{plans,code}/<feature-slug>-review.md`
- Audits: `docs/audits/<feature-slug>-audit.md`
- Tier metadata: `.dialectic-tier` (feature branches only, never on `main`)
- Slugs: lowercase, hyphen-separated, alphanumeric only (`^[a-z0-9]+(-[a-z0-9]+)*$`)
- Agent definitions: `.claude/agents/<stance>.md` (proposer, interlocutor, code-reviewer, security-auditor, skeptical-client)
- Portable stances: `prompts/stances/<stance>.md`
- Portable workflows: `prompts/workflows/<stage>.md`
- Platform adapters: `adapters/<platform>/`
- Team names: `{stage}-{slug}` (e.g., `audit-my-feature`)

## Execution Rules

- Each PRP task = one atomic commit (test + implementation together)
- TDD is mandatory: RED (write failing test) → GREEN (implement to pass) → REFACTOR → COMMIT
- The PRP must include a `Test Command` field — if missing, ask the user before proceeding
- If no test framework exists yet, the first task must set one up
- If validation fails, fix before proceeding — never mock to make tests pass
- Never weaken or delete tests to get green — fix the implementation instead
- If stuck (3+ failed attempts on same task), stop and flag for human review
- After any developer correction, update CLAUDE.md Known Gotchas via `/update-claude-md`

## Methodology Enforcement Hooks

Two hooks in `.claude/hooks/` enforce the methodology:

1. **`dialectic-guard.sh`** — Fires on `UserPromptSubmit`. Detects implementation-intent keywords and injects a `<dialectic-reminder>` that tells the agent to determine the tier first, use team/sequential commands for standard/full work, and follow TDD.

2. **`block-solo-implementation.sh`** — Fires on `PreToolUse` for Edit/Write. Blocks direct edits to `src/` and `tests/` on standard/full tier feature branches. References both `/execute-team` and `/execute-prp` as options.

## Known Gotchas

2026-02-10: GitHub Actions `${{ }}` expressions in `run:` blocks are script injection vectors when using attacker-controlled values like `github.head_ref` → Always pass untrusted context via `env:` variables, never inline interpolation

2026-02-10: `grep -qE "$PATTERN" "$FILE"` checks ALL lines, not just the first → Use `head -1 "$FILE" | grep -qE "$PATTERN"` when validating only the first line (e.g., commit message hooks)

2026-03-01: Claude Code's built-in TaskCreate system reminders can override CLAUDE.md operating principles → The `dialectic-guard.sh` hook counteracts this by injecting methodology reminders on UserPromptSubmit before system nudges take effect

2026-03-09: Claude Code agent definitions (`.claude/agents/*.md`) don't load for team members — `subagent_type` is ignored when `team_name` is set (bug #24316) → Team commands inlined stance definitions in spawn prompts as a workaround — **superseded 2026-04-22**: both the `tools:` frontmatter AND the body prose now load for team members, verified with a live probe (spawned `proposer` with `team_name` set and no inlined prose; agent self-reported correct stance priming and tool grants including `SendMessage`/`WebSearch`). The inline-stance workaround has been removed from team commands. Partial-load caveat that silently broke us before the fix: the `tools:` line loaded restrictively (blocking tools the body prose told the agent to use) while the body did not prime — always keep body-referenced tools in the `tools:` grant.

2026-03-09: Claude Code `model: inherit` doesn't resolve properly for agent spawns (bug #32368) → Use `model: opus` explicitly in all agent definitions and team spawn calls

2026-03-09: `~/.claude/teams/` directory detection is unreliable for checking active teams → `block-solo-implementation.sh` uses tier + branch + file path checks instead — **superseded 2026-04-18**: the hook now uses a branch-scoped config-file check with cwd validation, which is reliable; see the 2026-04-18 entry.

2026-04-18: Team-spawned agents may not inherit `DIALECTIC_TEAM_AGENT=1` reliably when Claude Code bug #32368 (model inheritance) cascades into env propagation → `block-solo-implementation.sh` uses a fallback check at `~/.claude/teams/<prefix>-${SLUG}/config.json` with `jq` `cwd` equality against `git rev-parse --show-toplevel`. Prefix list: `execute`, `review`, `audit`, `plan-review`. Cross-repo slug collisions are blocked because `~/.claude/teams/` is user-global and the `cwd` equality check rejects mismatched repos.

2026-06-01: Dynamic-workflow subagents (`/dialectic-sweep`, `/dialectic-migrate`) that edit `src/`/`tests/` would be falsely blocked by `block-solo-implementation.sh` — they have neither `DIALECTIC_TEAM_AGENT=1` nor a `~/.claude/teams/` config → Codebase-scale workflow work is its own tier: set `.dialectic-tier` to `workflow` (now on the hook's explicit allow-list with `light`/`iterative`). `/dialectic-sweep` is read-only and unaffected; only `/dialectic-migrate` needs the tier set. Like all tier values, `workflow` must never reach `main`.

2026-06-01: Bug #32368 (team model inheritance) VERIFIED FIXED → Ran a live probe: created a team and spawned two teammates with no `model:` set — a `proposer` stance (def pins `model: opus`) and a `general-purpose` agent (no def model pin). Both spawned and produced coherent, capable output — correctly reading their context and declining to fabricate rather than going idle or degrading. The historical failure mode (no-model team spawn → silent cheap-model → idle/garbage) did not occur. Caveat: spawned team members do NOT get a model-ID line injected into their context (the team lead does), so the probe confirms *capable operation*, not Opus-vs-Sonnet specifically — but the catastrophic idle/degrade mode is gone. Team commands and agent defs still set `model: "opus"` explicitly as cheap defense-in-depth.

2026-06-01: The `Workflow` tool (dynamic workflows) is Claude-Code-only with no OpenCode/ensemble equivalent → Per the portability stance, Claude Code is the reference implementation; the two workflow-backed stages are documented as a deliberate divergence (`docs/guides/dynamic-workflows.md`), not back-ported. On portable backends, scope work down to a branch and use the team/sequential path.

2026-06-12: This repo's game code lives in legacy subtrees (`micropolis-activity/src/`, `MicropolisCore/src/`, `micropolis-java/src/`), not the root `src/`/`tests/` that `block-solo-implementation.sh` and the git hooks guard → New bodhipolis code should go in root `src/`/`tests/` to get methodology enforcement; edits inside the legacy subtrees are not gated by the solo-implementation hook

2026-06-17: **TERMINOLOGY — "blight" is a loaded term, not a neutral descriptor.** "Blight" was the legal pretext (the redevelopment "blight finding" under CA Community Redevelopment Law) that authorized racialized clearance + eminent-domain displacement — West Oakland / Alameda County urban renewal (the Cypress Freeway/I-880, I-980, BART, the Acorn project) razed a thriving Black community under it. Using it as a neutral game-state word reproduces the apparatus's naturalizing move (*the place IS blighted* → razing is justified) → **Use "decay" for the neutral live condition** (the player-facing damaged state). **Reserve "blight" for CRITICAL use ONLY inside the Moses / oppressive city-planning modes** — naming the policy's harm/pretext that the player must ameliorate (e.g. the worldgen `BlightReport`, the opening's indictment), never as a neutral descriptor. The live layer (`seedDecay`, etc.) is "decay"; `src/worldgen/report.ts` keeps "blight" with an explicit critical framing. **This generalizes to the whole planning-euphemism family — "redevelopment", "urban renewal", "revitalization", "slum clearance" are ALL loaded** (urban renewal = Baldwin's "Negro removal"; redevelopment agencies were the clearance bodies). Same rule for all of them: (1) use ONLY critically, named as the apparatus's euphemisms, scoped to the Moses/oppressive-planning modes (e.g. era 3 "urban renewal & highways" indicts the Moses signature); (2) NEVER as a neutral state descriptor; (3) NEVER for what the PLAYER does — the player **repairs / restores / makes reparation / heals / stewards / rewilds**, never "redevelops" or "renews." Companion direction: worldgen should place burdens (dirty power, industry, highways, decay) per historically oppressive policy (redlining — discrimination-first, terrain as cover), so the damage reads as PRODUCED by policy, not natural.

2026-06-19: **Live-verify the live agent layer in the browser via `window.bodhitropolis` + a DYNAMIC IMPORT of the source module.** Inside a Playwright `browser_evaluate`, `await import('/src/ui/ambientContent.ts')` (etc.) calls EXPORTED internal functions (walkPath/stopReachable/prevailingWind/abandonOwnedCar/routeToParking…) on the REAL running `world`/`ambient` state — no world rebuild. Patterns leaned on all session: set up a scenario by mutating `ambient` state then call the fn; measure with a two-snapshot position diff; toggle overlays with `window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}))`; probe FPS with a 1–2s `requestAnimationFrame` counter → export the seam you want to confirm; this is the iterative live-pass for live-layer logic on the actual seed map.

2026-06-19: A "nearest-of" scan that iterates row-major (y then x) and keeps the best with strict `<` BREAKS TIES toward the upper-LEFT tile — and ties are rampant when the score is integer distance with uniform weighting (early-game land value is flat). Aggregated over many agents this skews trips/traffic to the map's top-left → break score ties with a direction-neutral hash of the tile index (`tieHash`), not scan order (still deterministic, just unbiased).

2026-06-19: Greedy grid pathing (`nextStepToward`: step to the min-distance non-recent neighbour) DITHERS in a local minimum at a barrier — a destination behind buildings/a freeway leaves every option tied, so agents pile up + burn out instead of routing around → walk-mode legs follow a COMMITTED A* route (`walkPath`, the pedestrian twin of `roadPath`), recomputed per leg not per step. (Cars already did this; peds didn't.)

2026-06-19: Agent destination selection must check REACHABILITY, not just radius. `nearestOfCategory` picked the nearest stop by Manhattan radius, so a citizen on an isolated landmass (a bridged exurb cut off for cars, an island) committed to a mainland stop it could never reach → spawned, failed to route, gave up, re-spawned → "spawn and immediately despawn" churn → gate trip-stop selection on `stopReachable` (a walkPath OR a roadPath-to-parking-near-the-stop exists); drop the trip at spawn if none (the resident stays home as occupancy). FOLLOW-UP: satellite/bridge freeways need RAMPS so `canDrive` lets local streets ON (then exurb citizens can actually commute home — open bug).

2026-06-19: Overlay legibility — a direct-tile-tint overlay at faint alpha (0.55) with no dim-base washes out (a SPARSE one like civic, tinting only neighborhood tiles, goes invisible) → every direct-tint overlay (civic/eco/redline, alongside power/coverage) uses `OverlaySource.dimBase: true` (a near-black scrim on un-tinted tiles) + a strong ~0.92 fill alpha, so the data reads as a clean layer view.

2026-06-19: PROCESS — after `gh pr merge --delete-branch && git checkout main && git pull`, BRANCH IMMEDIATELY before the next edit. Slipped twice this session (committed feature work onto local `main`); recovered each via `git branch <feature> && git branch -f main origin/main` (NOT `git reset --hard`, which the Bash guard denies). The fix is a habit: the sync and the new branch are one motion. See [[branch-before-editing]].
