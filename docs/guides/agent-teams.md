# Agent Teams Mode

Team mode runs Dialectic stances as concurrent agent teammates rather than sequential invocations. Same artifact types at the same paths, with additional fields capturing the dialectical exchange.

## Prerequisites

Claude Code with agent teams enabled. Add to your Claude Code settings (`.claude/settings.json` or user-level settings):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

**Note:** Agent teams is an experimental Claude Code feature. The API surface may change.

## Commands

| Command | Replaces | What It Does |
|---------|----------|--------------|
| `/review-plan-team <prp>` | `/review-plan` | Interlocutor critiques PRP while Proposer revises in real time |
| `/execute-team <prp>` | `/execute-prp` + `/review-code` | Proposer implements tasks; Code Reviewer reviews each commit before the next begins |
| `/security-audit-team` | `/security-audit` | Security Auditor and Skeptical Client debate findings as separate agents |

All team commands produce artifacts at the **same paths** as their sequential equivalents, with additional team-specific fields (exchange trails, severity adjustments). Standard fields remain in the same position — team-mode artifacts are strict supersets. CI, close-feature.sh, and the PR template work without modification.

## When to Use Team Mode vs. Sequential

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Quick review of a small PRP | `/review-plan` | Lower cost, sufficient for simple plans |
| Complex PRP with many integration points | `/review-plan-team` | Real-time feedback catches issues before the PRP is finalized |
| Simple implementation (few tasks) | `/execute-prp` then `/review-code` | Sequential is cheaper |
| Large implementation (many tasks) | `/execute-team` | Incremental review catches issues per-commit, not post-hoc |
| Security audit (any complexity) | `/security-audit-team` | Dual-agent dialectic produces more defensible reports |

## Pipeline with Team Mode

Team commands slot into the same pipeline positions as their sequential equivalents. You can mix sequential and team commands freely:

```
/generate-prp → /review-plan-team → /execute-team → /security-audit-team
```

Or mix:

```
/generate-prp → /review-plan → /execute-team → /security-audit
```

**Important:** `/review-plan-team` requires an existing PRP. It enhances the review phase — it does not generate the PRP from scratch. Always run `/generate-prp` first.

## Cost Implications

Each teammate is a separate Claude instance. A team with 2 agents costs approximately 2-3x a single invocation. Team mode is opt-in precisely because of this cost.

**Tips for reducing cost:**
- Use team mode only when the added dialectical quality justifies the cost
- For cost-sensitive projects, edit agent definitions in `.claude/agents/` to set `model: haiku` for critic agents (interlocutor, code-reviewer, skeptical-client). This reduces cost but may degrade critique quality.
- `/security-audit-team` is the highest-value team command — the dual-agent dialectic materially improves audit defensibility

## Customizing Agent Definitions

Agent definitions live in `.claude/agents/`. Each file has YAML frontmatter (name, tools, model) and a markdown body (system prompt). You can customize:

- **Tools:** Change which tools an agent can access
- **Model:** Use `model: opus` (required for team mode). Do NOT use `model: inherit` — it doesn't resolve properly (bug #32368).
- **Prompt body:** Adjust the agent's behavior, communication style, or review focus

See `AGENTS.md` for the mapping between stances and agent definitions.

## Known Bugs and Workarounds

### Bug #24316: Agent definitions don't load for team members (RESOLVED)

**Original problem:** When `team_name` was set on an Agent spawn, `subagent_type` was ignored — teammates spawned as `general-purpose` with full tool access, so tool restrictions and stance priming from `.claude/agents/*.md` were lost.

**Status: resolved** (verified 2026-04-22 with a live probe — a `proposer` spawned with `team_name` set and *no* inlined prose self-reported correct stance priming and correct tool grants, including `SendMessage`/`WebSearch`). Both the `tools:` frontmatter **and** the body prose now load for team members. The inline-stance workaround has been removed from the team commands; agent definitions are once again the single source of truth for team and sequential spawns alike.

**Remaining caveat:** keep every tool a stance's body prose references in that stance's `tools:` grant. Before the fix, the `tools:` line could load restrictively (blocking a tool the prose told the agent to use) while the body failed to prime — a partial load that silently broke stances. Frontmatter and body must stay consistent.

### Bug #32368: Model inheritance broken — FIXED (verified 2026-06-01)

**Problem (historical):** Teammates got hardcoded model IDs instead of inheriting parent config; `model: inherit` didn't resolve properly. Agents could spawn with the wrong model, go idle, or produce poor results.

**Verification:** Ran a live probe on 2026-06-01 — spawned team agents with no explicit `model:` (both a stance with a `model: opus` def and a `general-purpose` agent with no def model pin). Both spawned and produced coherent, capable output without going idle or degrading. The failure mode is gone.

**Current practice (defense-in-depth, no longer load-bearing):**
1. All agent definitions still use `model: opus` explicitly (not `inherit`)
2. All team spawn calls still include `model: "opus"` explicitly

These explicit `model:` settings are kept as cheap insurance.

**Caveat:** Spawned team members do not get a model-ID line injected into their context (the team lead does), so the probe confirms capable operation, not Opus-vs-Sonnet specifically — but the catastrophic idle/degrade mode is gone.

### Bug: Environment propagation

**Problem:** Bedrock/proxy env vars don't propagate to tmux-spawned teammates.

**Workaround:** Set environment variables in `.claude/settings.json` `env` block instead of shell environment.

### Health check and abort mechanism

All team commands include a health check after spawning:
- If teammates haven't started within 90 seconds, the team is shut down
- The user is notified with options: retry the team command, use sequential fallback, or check Claude Code version
- Teams **never** silently fall back to solo implementation

## Limitations

- **Experimental:** Feature-gated, may change. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **No session resumption:** If a session breaks mid-team, work must restart. Partial progress is preserved in git (commits are incremental).
- **One team per session:** Cannot run multiple team commands simultaneously.
- **File conflict prevention:** Critic agents are read-only (no Write/Edit tools). In `/execute-team`, the Proposer and Reviewer coordinate via message-gating to avoid concurrent git operations.
- **Stance enforcement:** Agent definitions (`.claude/agents/*.md`) load for team members (bug #24316 resolved, see above), so tool restrictions are enforced from the definitions — no inline-stance duplication needed.

## How It Works

### Message-Based Coordination

Unlike the sequential pipeline where each stage runs to completion before the next begins, team mode agents communicate directly via `SendMessage`. The Interlocutor sends yield points to the Proposer as they're found. The Proposer responds and revises. The exchange continues until it stabilizes.

### Tool-Level Stance Enforcement

In sequential mode, stance constraints are enforced by prompt instructions ("you cannot write code"). In team mode, constraints are enforced at the tool level — the Interlocutor agent literally does not have the `Write` or `Edit` tools. This makes the constraint architectural, not behavioral.

### The Lead Writes Artifacts

Review and audit artifacts are written by the team lead (the main Claude Code session), not by individual agents. Agents communicate findings via messages; the lead synthesizes them into the standard artifact format. This keeps critic agents truly read-only while producing artifacts identical to those from sequential commands.
