# Dynamic Workflows: the dialectic at codebase scale

Dynamic workflows (`Workflow` tool) let a single session orchestrate many subagents in the
background — find, verify, synthesize — over work too large for one context window. This guide
covers when to reach for a workflow, the two the template ships, and how they sit alongside the
agent-team commands.

The workflow pattern **is** the dialectic, fanned out: a finder asserts a problem (thesis), a panel
of independent skeptics tries to refute it (antithesis), and only what survives is reported
(synthesis). The difference from the team commands is scale and locus: teams run a *live*,
human-in-the-loop exchange over one PR diff; workflows run a *background, resumable* exchange over
the whole codebase.

## When to use what

| Situation | Reach for | Why |
|-----------|-----------|-----|
| One PR / one branch diff, want the live exchange | `/review-code-team`, `/security-audit-team` | Message-gated, visible, human-in-the-loop |
| Plan or implementation of one feature | `/review-plan-team`, `/execute-team` | The dialectic at authoring time |
| Whole-subsystem or whole-codebase audit | **`/dialectic-sweep`** | Fan out across hundreds of files; resumable |
| Mechanical change across many files | **`/dialectic-migrate`** | One transform per site, each verified in isolation |
| No team support (OpenCode/portable) | Scope down to a branch + team/sequential | Workflows are Claude-Code-only |

Decision rule: **one PR → team. Whole codebase → workflow. Solo/no-team backend → sequential.**

## `/dialectic-sweep` — codebase-scale audit

Fans out one finder per dimension (`correctness`, `security`, `performance`, `convention`) across
`args.paths`, then cross-examines every finding with N independent skeptics (distinct lenses), each
instructed to *refute* it and to default to "refuted" when they can't confirm it by reading the
code. Only findings that survive a majority are reported, deduped and ranked by final severity.

```
/dialectic-sweep        # then describe scope; or invoke the Workflow directly:
Workflow({ name: "dialectic-sweep", args: {
  scope: "auth subsystem",
  paths: ["src/auth", "src/middleware"],
  dimensions: ["security", "correctness"],   // optional; default all four
  skeptics: 3,                                // optional; default budget-scaled 3..5
  conventions: "<excerpt of CLAUDE.md conventions>"
}})
```

Output is written to `docs/audits/<scope-slug>-sweep.md`. Script: `.claude/workflows/dialectic-sweep.js`.

## `/dialectic-migrate` — codebase-scale migration

Discovers every site needing a change, transforms each in an **isolated git worktree** (so parallel
edits and per-site verify runs can't collide), and has a reviewer cross-examine each patch before
it is reported as landable. It returns patches; **it does not commit to your branch** — the command
lands the accepted patches and surfaces the rejected ones for human decision.

```
echo "workflow" > .dialectic-tier      # see "Tier interaction" below
Workflow({ name: "dialectic-migrate", args: {
  goal: "replace deprecated foo() with bar()",
  paths: ["src"],
  discover: "calls to foo(",            // grep pattern or prose
  verifyCmd: "pytest tests -q",         // per-site TDD gate (strongly recommended)
  guidance: "bar() takes the same args; preserve keyword order"
}})
```

Script: `.claude/workflows/dialectic-migrate.js`. It is a **starter + pattern**, not a black box —
read it and adapt the prompts/schemas to your migration.

## Tier interaction (important)

Workflow transform agents edit `src/`/`tests/`. On a `standard`/`full` feature branch the
`block-solo-implementation.sh` hook would block those edits. Codebase-scale workflow work is **its
own tier** — set it before a migration:

```bash
echo "workflow" > .dialectic-tier
```

`workflow` is on the hook's allow-list alongside `light` and `iterative`. Keep it on a dedicated
branch; like every tier value, `.dialectic-tier` must never reach `main`. (`/dialectic-sweep` is
read-only and unaffected.)

## Resumability

Workflows journal progress. If a run is interrupted, re-invoke with the same script and
`resumeFromRunId: "<prior runId>"`; completed agents return cached results instantly and only new
or changed work re-runs. Watch live progress with `/workflows`.

## Cost

A workflow consumes **substantially more tokens** than a normal session — one finder per dimension
plus several skeptics per finding (sweep), or one agent per site plus a reviewer (migrate). Scope
tightly the first time (narrow `paths`, fewer `dimensions`), confirm the shape of the output, then
widen. A `+<N>k` token directive on the turn auto-scales the sweep's skeptic count.

## Why this is Claude-Code-only

The `Workflow` tool is a Claude Code feature with no OpenCode/ensemble equivalent. Per the
template's portability stance, Claude Code is the reference implementation and these two stages are
documented as a deliberate divergence rather than back-ported. On other backends, scope the work
down to a single branch and use the team or sequential commands. See
`docs/guides/team-tool-mapping.md`.
