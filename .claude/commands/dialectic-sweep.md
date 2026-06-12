You are running a **codebase-scale Dialectic audit** via a dynamic Workflow. This is the scaled form of the dialectic: many finders fan out across the codebase, independent skeptics try to refute each finding, and only findings that survive cross-examination are reported. Use it when the scope is **larger than a single PR diff** — whole-subsystem or whole-codebase bug hunts, security sweeps, and quality audits.

## When to use this vs. the team commands

- **One PR / one branch diff** → `/review-code-team` or `/security-audit-team` (live, human-in-the-loop, message-gated).
- **A whole subsystem or the whole codebase** → this command (`/dialectic-sweep`): background, resumable, fans out across hundreds of files.
- This is **Claude-Code-only** (it uses the `Workflow` tool). On OpenCode/portable backends, scope the work down and use the team/sequential path instead.

⚠️ A sweep consumes **substantially more tokens** than a normal session — it spawns one finder per dimension plus several skeptics per finding. Scope it deliberately the first time (narrow `paths`, fewer dimensions), then widen.

## Instructions

### 1. Scope the sweep

Determine, from the user's request:
- **scope** — a short human label (e.g. `"auth subsystem"`).
- **paths** — the directories/globs finders should focus on (default `["."]` = whole repo; prefer narrowing).
- **dimensions** — any subset of `correctness`, `security`, `performance`, `convention` (default: all four).
- **skeptics** — refuters per finding (optional; defaults to a budget-scaled 3–5).
- Derive a **scope-slug** (lowercase, hyphen-separated) for the artifact filename.

If the user gave a `+<N>k` token directive this turn, the workflow auto-scales the skeptic count to it — no action needed.

### 2. Run the workflow

Invoke the saved workflow, passing the scope as `args`:

```
Workflow({ name: "dialectic-sweep", args: { scope, paths, dimensions, skeptics, conventions } })
```

For `conventions`, pass a short excerpt of the project's key conventions/invariants from CLAUDE.md so finders cite the right rules.

The run executes in the background and returns one consolidated result. **It is resumable** — if it is interrupted, re-invoke `Workflow` with the same `scriptPath`/`name` and `resumeFromRunId` (the prior run's `runId`); completed agents return cached results instantly and only new work runs. Watch live progress with `/workflows`.

### 3. Synthesize the report

The workflow returns:
```
{ scope, paths, dimensions, skepticsPerFinding, counts: { raw, survived, deduped, droppedByVerify }, findings: [...] }
```

Each finding has `title, finalSeverity, file, line, description, evidence, remediation, dimension, votes, refutes`.

Write the report to `docs/audits/<scope-slug>-sweep.md` using the audit conventions (`docs/audits/TEMPLATE.md`):

```markdown
# Dialectic Sweep: <scope>

## Scope
Paths swept: <paths>. Dimensions: <dimensions>. Skeptics per finding: <N>.
What was NOT examined.

## Methodology
Codebase-scale dynamic workflow. Each dimension was audited by an independent finder; every
finding was then cross-examined by <N> independent skeptics (distinct lenses), each instructed to
refute it. Only findings that survived a majority of skeptics are reported. Raw findings: <raw>;
survived verification: <survived>; after dedup: <deduped>; dropped by skeptics: <droppedByVerify>.

## Findings Summary
| # | Severity (final) | Dimension | Title | Location |
|---|------------------|-----------|-------|----------|

## Detailed Findings
### Finding 1: <title>
**Severity:** <finalSeverity>  **Dimension:** <dimension>
**Location:** file:line
**Description:** ...
**Evidence:** ...
**Survived:** <votes - refutes>/<votes> skeptics
**Remediation:** ...

## What This Sweep Did NOT Find
Explicit limitations: paths/dimensions not covered, and that skeptics default to refuting when
they cannot confirm a finding by reading the code (so the report is conservative).

## Remediation Priority
Ordered by final severity, with effort notes.
```

### 4. Commit

`docs: dialectic sweep for <scope-slug>`

### 5. Report to the user

- Counts: raw → survived → deduped, and how many the skeptics dropped.
- Any CRITICAL/HIGH findings needing immediate attention.
- Note the run is resumable and how to widen scope (more paths/dimensions/skeptics) for a follow-up pass.
