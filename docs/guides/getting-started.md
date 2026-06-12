# Getting Started with Dialectic

Welcome. This distribution gives you a working, opinionated dialectical development lifecycle in a fresh repository: branching conventions, feature tiers, planning and review artifacts, TDD-gated execution, and the hooks that enforce it all. By the end of this guide you will have run two complete cycles — a light-tier fix and a standard-tier feature — and you'll know where to look when something feels off.

## Scope and Platform Note

**This guide assumes Claude Code.** The walk-throughs below use Claude Code slash commands (`/new-feature`, `/review-plan`, `/execute-prp`, `/review-code`, and their `-team` variants). The underlying workflow is identical on Cursor, OpenCode, and the generic CLI adapter — only the command surface differs. For other platforms, see `adapters/<your-platform>/README.md` for the equivalent invocation pattern (typically: paste the corresponding template from `prompts/workflows/<stage>.md` into your tool's prompt surface). The methodology, the artifacts, and the file paths are portable; the slash commands are the Claude Code-specific affordance.

If you are on a non-Claude-Code platform and want the shortest path to productive work: read `adapters/<your-platform>/README.md` first, then return here for the conceptual walk-throughs.

## Prerequisites

- **git** — the methodology is a git workflow. Conventional commits, feature branches, and squash merges are load-bearing.
- **Claude Code** (or a supported alternative: Cursor, OpenCode, generic CLI). For team mode, Claude Code is required and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set — see `docs/guides/agent-teams.md`.
- **Bash and jq** for the shell hooks and build scripts.
- **Your language's test runner** — the templates use `pytest`/`ruff`/`mypy` as examples; swap them for your stack's equivalents in `.claude/hooks/` and CI.
- (Optional) Your platform's adapter-specific setup — e.g., Cursor's rules directory, OpenCode's prompt surface, or the generic CLI shim.

One-time setup:

```bash
./scripts/setup.sh
```

This installs git hooks, verifies the directory structure, and checks template sanity. It refuses to run inside a parent git repo — if you see that message, `git init` your new repo first.

## Merge Flow

This distribution uses the **GitHub pull-request flow** as the canonical merge path. Each walk-through below ends by pushing the feature branch, opening a PR, and merging via GitHub (squash merge recommended). The `dialectic-review.yml` CI workflow runs on every PR and enforces tier-appropriate artifact checks.

A local squash-merge alternative exists (`./scripts/close-feature.sh <slug>`) for solo or offline workflows. It bypasses the PR review surface, so if you want CI to gate your changes — use the PR flow below.

## First-Cycle Walk-Through: Light Tier

Light tier is for changes touching one to three files in a single module: a typo, a small refactor, a configuration tweak. No PRD, no PRP, no plan review — just TDD, optional code review, and merge.

```bash
./scripts/new-feature.sh fix-typo --tier light
```

This creates `feature/fix-typo`, writes `.dialectic-tier` with `light`, and switches you to the branch. No PRD or PRP is generated; no plan review is required.

Edit the file you intended to fix. Write a test first if the change warrants one. Commit:

```bash
git commit -am "fix: correct typo in user-facing error message"
```

Optional: `/review-code` for a final sanity check.

Remove the tier file before pushing — it is branch-scoped metadata and must never reach `main`. The CI workflow hard-errors if `.dialectic-tier` shows up in the PR diff:

```bash
git rm .dialectic-tier
git commit -m "chore: remove tier file before merge"
```

Push the branch and open the PR:

```bash
git push -u origin feature/fix-typo
gh pr create --fill
```

The `dialectic-review.yml` CI workflow fires on the `pull_request` event, reads no `.dialectic-tier` (removed from the branch) so it defaults to standard-tier behavior and emits warnings for absent PRD/PRP/reviews — for light tier those are expected and non-blocking. The hard-fail gate is the tier-file-not-in-diff check, which passes because you removed it.

Merge via GitHub UI (squash merge recommended). GitHub deletes the feature branch on merge. Clean up locally:

```bash
git checkout main && git pull origin main && git branch -d feature/fix-typo
```

What the hooks do on light tier: `dialectic-guard.sh` still injects methodology reminders on implementation-intent prompts; `block-solo-implementation.sh` does **not** block direct edits on light tier (that guard is standard/full only).

## Second-Cycle Walk-Through: Standard Tier

Standard tier is the default. Use it for changes spanning multiple files or modules, anything user-facing, or anything where the design is not obvious from a single line of intent.

Start with the feature brief. In Claude Code:

```
/new-feature add user profile endpoint
```

This generates both the PRD (`docs/PRDs/add-user-profile-endpoint.md`) and the PRP (`docs/PRPs/add-user-profile-endpoint.md`) in one invocation, creates the branch, and sets `.dialectic-tier` to `standard`. Read the PRD and PRP. If something is wrong, fix it before the next step — documents are the product; wrong documents produce wrong code.

Plan review (pick one):

```
/review-plan docs/PRPs/add-user-profile-endpoint.md
/review-plan-team docs/PRPs/add-user-profile-endpoint.md
```

The team variant spawns a senior interlocutor and a revising proposer concurrently and produces a stronger plan through dialectical exchange. The sequential command runs the same analysis solo. Either produces `docs/reviews/plans/add-user-profile-endpoint-review.md`. If the review is not APPROVED, revise the PRP and re-run.

Execution (pick one):

```
/execute-prp docs/PRPs/add-user-profile-endpoint.md
/execute-team docs/PRPs/add-user-profile-endpoint.md
```

The team variant runs a message-gated proposer-and-reviewer exchange, committing each task atomically and gating progress on peer review. TDD is mandatory at every tier — red, green, refactor, commit. If you find yourself weakening a test to get green, stop and fix the implementation instead.

Code review (pick one):

```
/review-code
/review-code-team
```

Either produces `docs/reviews/code/add-user-profile-endpoint-review.md`. The team variant runs a finding-by-finding reviewer/defender dialectic; the sequential command is a single-pass diff review. Address any blocking findings.

Remove the tier file, push, and open the PR:

```bash
git rm .dialectic-tier
git commit -m "chore: remove tier file before merge"
git push -u origin feature/add-user-profile-endpoint
gh pr create --fill
```

The `dialectic-review.yml` CI workflow fires on the PR. For standard tier, it checks presence of the PRD, PRP, plan review, and code review artifacts at their conventional paths, and enforces that `.dialectic-tier` is not in the diff vs `main`. CI warnings for missing artifacts are your signal to fix before merging.

Merge via GitHub UI (squash merge). Clean up locally:

```bash
git checkout main && git pull origin main && git branch -d feature/add-user-profile-endpoint
```

## Third-Cycle Overview: Iterative and Full

**Iterative tier** is for empirical feedback loops — performance optimization, benchmark-driven accuracy work, bug investigations that require reproduction cycles. Enter with `/investigate` or `./scripts/new-feature.sh <slug> --tier iterative`. Direct implementation is allowed; TDD remains mandatory; the dialectic happens at code-review time, not implementation time. Use iterative tier when the *work* is empirically driven and the developer needs to see results fast enough to form the next hypothesis.

**Full tier** is standard tier plus a security audit. Enter with `./scripts/new-feature.sh <slug> --tier full`. After `/review-code`, run `/security-audit` (or `/security-audit-team`) and produce `docs/audits/<slug>-audit.md`. Use full tier when the change touches authentication, authorization, cryptography, serialization of untrusted data, or any code path that can be reached by an attacker without authentication. The auditor demands PoCs for HIGH+ findings; the skeptical-client pair pushes back on severity inflation.

## Troubleshooting

**"The `dialectic-guard` hook is injecting XML into my prompts."** That is expected. The hook fires on `UserPromptSubmit` for implementation-intent prompts and injects a methodology reminder as context the agent sees but you do not. If you are running a monitoring or status query and the reminder fires, you have hit a false positive — we prefer those over false negatives that let solo implementation slip through. See `.claude/hooks/dialectic-guard.sh`.

**"I'm getting `BLOCKED: Solo implementation detected`."** Expected on standard and full tier feature branches. Use `/execute-team` for team-mode execution, or `/execute-prp` for the sequential equivalent. Direct edits to `src/` and `tests/` via Edit/Write are intentionally blocked on those tiers; the block does not apply on light or iterative tier.

**"`./scripts/setup.sh` says 'refusing to run inside a parent git repo'."** You are running setup in a directory that is a child of an existing git checkout (for example, you cloned the distribution inside another project). `git init` in your new repo first, or move the distribution to its own top-level directory.

**"Team commands aren't working."** Team mode requires Claude Code with the experimental agent-teams feature enabled. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your Claude Code settings (`.claude/settings.json` or user-level). Sequential commands (`/review-plan`, `/execute-prp`, `/review-code`, `/security-audit`) do not require this flag. See `docs/guides/agent-teams.md`.

**"Slash commands don't work / nothing happens when I type `/new-feature`."** You are probably on a non-Claude-Code platform (Cursor, OpenCode, generic CLI). The workflows are platform-portable: see `adapters/<your-platform>/README.md` for how to invoke the equivalent prompt template from `prompts/workflows/<stage>.md`. The methodology and artifacts are identical; only the command surface differs.

## Next Reading

- `dialectic.md` — the full specification of this distribution: the tier system, the stances, the gates, and the reasoning.
- `CLAUDE.md` — operating principles and known gotchas for agents working in this repo.
- `docs/guides/agent-teams.md` — design rationale and enablement for team mode.
- `docs/guides/sync-from-upstream.md` — how to pull methodology updates from the parent template into this distribution without losing hand-written content.
- Per-platform adapter guides: `adapters/claude-code/README.md`, `adapters/cursor/README.md`, `adapters/opencode/README.md`, `adapters/generic/README.md`.
