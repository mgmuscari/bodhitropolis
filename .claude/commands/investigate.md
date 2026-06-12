You are operating in the **Proposer** stance for benchmark-driven investigation and optimization.

## Workflow

This skill sets the working mode to **iterative tier** — direct implementation with TDD, driven by empirical feedback loops.

### Step 1: Establish baseline
- Run the relevant benchmark, test suite, or profiling tool
- Record current metrics (accuracy, latency, error rate, throughput)
- Identify the specific failure or performance issue to investigate
- For a long-running benchmark, watch build, or CI job, use the **`Monitor`** tool to stream its
  output and surface regressions/errors as they appear — instead of re-running and polling by hand.

### Step 2: Investigate
- Analyze telemetry, error logs, or profiling data
- Trace the code path involved
- Form a hypothesis about the root cause

### Step 3: Fix (TDD)
- Write a test that reproduces the issue (RED)
- Implement the minimum fix (GREEN)
- Refactor if needed
- Commit test + fix together

### Step 4: Validate
- Re-run the benchmark/test from Step 1
- Compare metrics to baseline
- If improved: document the fix and move to next issue
- If not improved or new issues found: loop back to Step 2

### Step 5: Review
- When the investigation loop is complete, run /review-code
- Document findings in appropriate design docs

## Driving the loop with `/goal`

The investigate loop (Step 2 → Step 4 → back to Step 2) is exactly the shape `/goal` automates:
keep working turn after turn until a measurable condition holds. Instead of manually re-prompting
each cycle, set a bounded completion condition up front, e.g.:

```text
/goal benchmark X reports accuracy ≥ 0.92 AND `pytest -q` exits 0, with each turn surfacing the
latest number, or stop after 15 turns
```

A fast model checks the condition against what you've surfaced in the transcript after each turn,
so the condition must be something **your own output demonstrates** (a printed metric, a test exit
code) — it does not run commands itself. Always include a turn/time bound (`or stop after N turns`)
so an unproductive loop terminates. `/goal` replaces the manual "loop back to Step 2"; it does
**not** replace the tests or the TDD gate — every fix still needs its RED test first.

## Rules

- **TDD is mandatory** — every fix has a test
- **Profile before optimizing** — use telemetry and measurement, not intuition
- **Atomic commits** — each fix is one commit (test + implementation)
- **Document findings** — update CLAUDE.md Known Gotchas if the issue could recur

## Tier

If `.dialectic-tier` is not already set, set it to `iterative`:
```bash
echo "iterative" > .dialectic-tier
```

This enables direct implementation without team mode, while preserving TDD requirements and code review before PR.
