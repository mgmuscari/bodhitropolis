You are running a **codebase-scale Dialectic migration** via a dynamic Workflow. This is the dialectic applied to wide, mechanical change: a proposer transforms each site (in an isolated worktree so parallel edits and verify runs can't collide) and a reviewer cross-examines every patch before it is reported as landable. Use it for API deprecations, framework swaps, signature changes, and idiom ports that span many files.

## When to use this vs. the team commands

- **A feature on one branch** → `/execute-team` (TDD, message-gated).
- **A mechanical change across many files** → this command (`/dialectic-migrate`): discover → transform-in-worktree → review, resumable.
- **Claude-Code-only** (uses the `Workflow` tool). On OpenCode/portable backends, do it as a normal feature.

⚠️ This **writes code** and consumes substantial tokens. It transforms one site per agent. Scope `paths` and `discover` tightly the first time.

## Tier interaction (important)

The migration's transform agents edit `src/`/`tests/`. On a `standard`/`full` feature branch the `block-solo-implementation.sh` hook would block those edits. Codebase-scale workflow work is **its own mode**, not standard/full. Before running, set the tier so the hook permits direct edits:

```bash
echo "workflow" > .dialectic-tier
```

(`workflow` is on the hook's allow-list alongside `light`/`iterative`. Keep this on a dedicated migration branch; never let `.dialectic-tier` reach `main`.)

## Instructions

### 1. Scope the migration

From the user's request, determine:
- **goal** (required) — what the migration does, e.g. `"replace deprecated foo() with bar()"`.
- **paths** — dirs/globs to search (default `["."]`; prefer narrowing).
- **discover** (required) — how to recognize a site: a grep pattern or a prose description.
- **verifyCmd** — the command run inside each worktree to verify a single edit (e.g. `"pytest tests/x -q"`). Strongly recommended — it is the TDD gate per site.
- **guidance** — transformation rules / gotchas to honor.

### 2. Run the workflow

```
Workflow({ name: "dialectic-migrate", args: { goal, paths, discover, verifyCmd, guidance } })
```

Runs in the background; **resumable** via `resumeFromRunId`. Watch with `/workflows`.

### 3. Land the accepted patches

The workflow returns patches; it does **not** commit to your branch (transforms ran in throwaway worktrees). It returns:
```
{ goal, paths, counts: { sites, accepted, rejected }, accepted: [{ file, diff, notes, review }], rejected: [...] }
```

- For each entry in `accepted`, apply its `diff` to the working tree and run the full validation suite once over the whole change.
- Commit in reviewable batches (per-module or per-file), conventional messages: `refactor(migrate): <goal> — <file/module>`.
- Do **not** apply `rejected` entries — surface each with its `review.reason`/`notes` for human decision.

### 4. Report to the user

- Counts: sites discovered → patches accepted → rejected.
- The full list of rejected sites with reasons (these need human attention).
- Confirm the full validation suite passes over the landed change.
- Note the run is resumable if you want to widen scope.
