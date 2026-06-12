# Dialectic Workflow: Claude Code vs OpenCode Ensemble — Tool Mapping

This document maps the dialectic team commands between Claude Code (experimental agent teams) and OpenCode (ensemble plugin). Both backends implement the same dialectic protocol — only the tool calls differ.

## Environment Detection

| Check | Claude Code | OpenCode |
|-------|-------------|----------|
| Env var | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `OPENCODE_VERSION` |
| Config file | `.claude/settings.json` | `opencode.json` |
| Agent defs | `.claude/agents/*.md` | `.opencode/agents/*.md` |
| Commands | `.claude/commands/*.md` | `.opencode/commands/*.md` |
| Binary | `claude` | `opencode` |

Run `scripts/detect-env.sh` to auto-detect.

## Tool Mapping

### Team Lifecycle

| Operation | Claude Code | OpenCode Ensemble |
|-----------|-------------|-------------------|
| Create team | `TeamCreate(team_name)` | `team_create(name)` |
| Delete team | `TeamDelete()` | `team_cleanup(force, acknowledge_uncommitted)` |
| Shutdown member | `shutdown_request(to)` | `team_shutdown(member, force)` |

### Task Management

| Operation | Claude Code | OpenCode Ensemble |
|-----------|-------------|-------------------|
| Create task | `TaskCreate(name, description)` | `team_tasks_add(tasks: [{...}])` |
| Assign task | `TaskUpdate(task_id, assignee)` | `team_claim(task_id)` |
| Complete task | Implicit (agent finishes) | `team_tasks_complete(task_id)` |
| List tasks | `TaskList()` | `team_status()` / `team_tasks_list()` |

### Agent Spawning

| Operation | Claude Code | OpenCode Ensemble |
|-----------|-------------|-------------------|
| Spawn agent | `Agent spawn(name, subagent_type, team_name, model, run_in_background)` | `team_spawn(name, agent, prompt, model, worktree, plan_approval)` |
| Agent type param | `subagent_type` | `agent` |
| Background exec | `run_in_background: true` | Implicit (always concurrent) |
| Worktree isolation | Shared tree | `worktree: true/false` |

### Messaging

| Operation | Claude Code | OpenCode Ensemble |
|-----------|-------------|-------------------|
| Send message | `SendMessage(to, text)` | `team_message(to, text, approve)` |
| Broadcast | Not available | `team_broadcast(text)` |
| Get results | Message history | `team_results(from)` |
| Approval gate | Manual (agent coordination) | `approve: true/false` parameter |

## Command Mapping

All four team commands have identical structure in both backends:

1. Gather context (read PRP, PRD, CLAUDE.md, git diff)
2. Create team
3. Create tasks (2 tasks, no dependencies)
4. Spawn teammates (both in parallel)
5. Assign/claim tasks
6. Health check (90s timeout)
7. Manage exchange (orchestrator intervenes)
8. Synthesize artifact
9. Shutdown and cleanup
10. Report

### `/review-plan-team`

| Step | Claude Code | OpenCode |
|------|-------------|----------|
| Team | `TeamCreate(team_name: "plan-review-{slug}")` | `team_create(name: "plan-review-{slug}")` |
| Tasks | `TaskCreate` x2 | `team_tasks_add(tasks: [...])` |
| Spawn | `Agent spawn(name: "interlocutor", subagent_type: "interlocutor", team_name: "...", model: "opus", run_in_background: true)` | `team_spawn(name: "interlocutor", agent: "interlocutor", prompt: "...", model: "lmstudio/qwen3.6-35b-a3b")` |
| Assign | `TaskUpdate(task_id, assignee: "interlocutor")` | `team_claim(task_id)` |
| Health | `TaskList()` | `team_status()` |
| Shutdown | `shutdown_request(to: "interlocutor")` | `team_shutdown(member: "interlocutor", force: true)` |
| Delete | `TeamDelete()` | `team_cleanup(force: true)` |

### `/execute-team`

| Step | Claude Code | OpenCode |
|------|-------------|----------|
| Team | `TeamCreate(team_name: "execute-{slug}")` | `team_create(name: "execute-{slug}")` |
| Tasks | `TaskCreate` x2 (Proposer + Code Reviewer) | `team_tasks_add(tasks: [...])` |
| Spawn | `Agent spawn(name: "proposer", subagent_type: "proposer", ...)` + `Agent spawn(name: "code-reviewer", subagent_type: "code-reviewer", ...)` | `team_spawn(name: "proposer", agent: "proposer", ...)` + `team_spawn(name: "code-reviewer", agent: "code-reviewer", ...)` |
| Message gate | `SendMessage(to: "code-reviewer", text: commit_sha)` → wait | `team_message(to: "code-reviewer", text: commit_sha, approve: false)` → wait for `approve: true` |
| Health | `TaskList()` | `team_status()` |
| Shutdown | `shutdown_request(to: "proposer")` + `shutdown_request(to: "code-reviewer")` | `team_shutdown(member: "proposer", force: true)` + `team_shutdown(member: "code-reviewer", force: true)` |

### `/review-code-team`

| Step | Claude Code | OpenCode |
|------|-------------|----------|
| Team | `TeamCreate(team_name: "review-{slug}")` | `team_create(name: "review-{slug}")` |
| Tasks | `TaskCreate` x2 (Code Reviewer + Defender) | `team_tasks_add(tasks: [...])` |
| Spawn | `Agent spawn(name: "code-reviewer", subagent_type: "code-reviewer", ...)` + `Agent spawn(name: "defender", subagent_type: "defender", ...)` | `team_spawn(name: "code-reviewer", agent: "code-reviewer", ...)` + `team_spawn(name: "defender", agent: "defender", ...)` |
| Finding exchange | `SendMessage(to: "defender", text: finding)` → wait for response | `team_message(to: "defender", text: finding)` → wait for response |
| Scope check | `bash scripts/check-defender-scope.sh {slug}` | `bash scripts/check-defender-scope.sh {slug}` (same) |
| Health | `TaskList()` | `team_status()` |
| Shutdown | `shutdown_request(to: "code-reviewer")` + `shutdown_request(to: "defender")` | `team_shutdown(member: "code-reviewer", force: true)` + `team_shutdown(member: "defender", force: true)` |

### `/security-audit-team`

| Step | Claude Code | OpenCode |
|------|-------------|----------|
| Team | `TeamCreate(team_name: "audit-{slug}")` | `team_create(name: "audit-{slug}")` |
| Tasks | `TaskCreate` x2 (Auditor + Client) | `team_tasks_add(tasks: [...])` |
| Spawn | `Agent spawn(name: "auditor", subagent_type: "security-auditor", ...)` + `Agent spawn(name: "client", subagent_type: "skeptical-client", ...)` | `team_spawn(name: "auditor", agent: "security-auditor", ...)` + `team_spawn(name: "client", agent: "skeptical-client", ...)` |
| Dual recipient | `SendMessage(to: "client", text: finding)` + `SendMessage(to: "team-lead", text: finding)` | `team_message(to: "client", text: finding)` + `team_message(to: "team-lead", text: finding)` |
| Health | `TaskList()` | `team_status()` |
| Shutdown | `shutdown_request(to: "auditor")` + `shutdown_request(to: "client")` | `team_shutdown(member: "auditor", force: true)` + `team_shutdown(member: "client", force: true)` |

## Architectural Differences

### 1. Model Specification

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Default | Inherits from parent (bug #32368 fixed, verified 2026-06-01) | From `opencode.json` |
| Required override | `model: "opus"` in every spawn (defense-in-depth) | `model: "lmstudio/qwen3.6-35b-a3b"` (optional) |
| Enforcement | None (explicit `model: "opus"` kept as defense-in-depth) | No equivalent hook |

### 2. Agent Definition Loading

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Sequential mode | Loads `.claude/agents/*.md` | Loads `.opencode/agents/*.md` |
| Team mode | Loads `.claude/agents/*.md` (bug #24316 resolved 2026-04-22) | Loads `.opencode/agents/*.md` in team context |
| Workaround | None needed — inline-stance removed | None needed |
| Caveat | Keep body-referenced tools in the `tools:` grant (frontmatter + body must agree) | — |

### 3. Task Assignment Model

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Assignment | Explicit: `TaskUpdate(task_id, assignee)` | Pull-based: `team_claim(task_id)` |
| Dependencies | `addBlockedBy` available (but dialectic commands explicitly don't use it) | No dependency mechanism — all coordination via messages |

### 4. Approval Gating

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Mechanism | Manual agent coordination (Proposer waits for reviewer message) | `approve` parameter on `team_message` |
| `/execute-team` | Proposer waits for reviewer's message before next task | `team_message(approve: true)` gates next task |

### 5. Worktree Isolation

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Default | All agents share same working tree | `worktree: true` gives each agent isolated workspace |
| Race condition risk | Higher (concurrent git ops) | Lower (isolated worktrees) |
| Mitigation | Message-gating + sequential git ops | Worktree isolation + message-gating |

### 6. Cleanup

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Delete | `TeamDelete()` — explicit delete | `team_cleanup(force, acknowledge_uncommitted)` — handles uncommitted state |
| Force cleanup | Not available | `force: true` aborts mid-work |

## Agent Definitions

### Claude Code (6 agents)

| Agent | File |
|-------|------|
| proposer | `.claude/agents/proposer.md` |
| interlocutor | `.claude/agents/interlocutor.md` |
| code-reviewer | `.claude/agents/code-reviewer.md` |
| security-auditor | `.claude/agents/security-auditor.md` |
| skeptical-client | `.claude/agents/skeptical-client.md` |
| defender | `.claude/agents/defender.md` |

### OpenCode (6 agents)

| Agent | File |
|-------|------|
| proposer | `.opencode/agents/proposer.md` |
| interlocutor | `.opencode/agents/interlocutor.md` |
| code-reviewer | `.opencode/agents/code-reviewer.md` |
| security-auditor | `.opencode/agents/security-auditor.md` |
| skeptical-client | `.opencode/agents/skeptical-client.md` |
| defender | `.opencode/agents/defender.md` |

## Helper Scripts

| Script | Purpose |
|--------|---------|
| `scripts/detect-env.sh` | Detects Claude Code vs OpenCode |
| `scripts/team.sh` | Unified CLI that routes to correct backend |
| `scripts/claude-team.sh` | Claude Code tool call generators |
| `scripts/ensemble-team.sh` | OpenCode tool call generators |

## Known Bugs (Both Backends)

| Bug | Claude Code | OpenCode | Impact |
|-----|-------------|----------|--------|
| Agent defs not loading in team mode | #24316 **resolved** (verified 2026-04-22) | Loads in team context | None — inline-stance workaround removed; keep body tools in the `tools:` grant |
| Model inheritance broken | #32368 (partial fix in v2.1.44-45; re-verify before relaxing) | N/A (no inheritance) | Claude Code requires explicit `model: "opus"` |
| No built-in health check timeout | Manual implementation required | Manual implementation required | Orchestrator must poll + timeout |

## Dynamic Workflows (Claude Code only)

The `Workflow` tool (`/dialectic-sweep`, `/dialectic-migrate`) has **no OpenCode equivalent**. These codebase-scale stages are Claude-Code-native and are documented as a deliberate divergence — see `docs/guides/dynamic-workflows.md`. On OpenCode/portable backends, scope the work down to a branch and use the team or sequential path instead.

| Capability | Claude Code | OpenCode |
|------------|-------------|----------|
| Codebase-scale audit | `/dialectic-sweep` (Workflow) | Scope down → `/security-audit-team` or sequential |
| Codebase-scale migration | `/dialectic-migrate` (Workflow) | Scope down → feature branch + `/execute-team` |
