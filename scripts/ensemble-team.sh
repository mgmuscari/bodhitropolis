#!/usr/bin/env bash
# ensemble-team.sh — OpenCode Ensemble team commands for dialectic workflow
# This script provides helper functions for orchestrating dialectic teams
# in OpenCode using the ensemble plugin's tool set.
#
# Usage: source scripts/ensemble-team.sh
#        Then call functions like: ensemble_team_create, ensemble_plan_review, etc.
#
# These functions output tool call instructions that the OpenCode orchestrator
# will execute. They serve as both documentation and generation templates.

set -euo pipefail

# ============================================================================
# Helper: Check if we're in OpenCode
# ============================================================================
ensemble_check_env() {
    if ! command -v opencode &>/dev/null; then
        echo "ERROR: opencode not found in PATH" >&2
        return 1
    fi
    if ! [ -f "opencode.json" ]; then
        echo "ERROR: opencode.json not found in current directory" >&2
        return 1
    fi
}

# ============================================================================
# Team Lifecycle
# ============================================================================

# Create a new team
# Usage: ensemble_team_create "team-name"
ensemble_team_create() {
    local team_name="${1:?Usage: ensemble_team_create <team_name>}"
    echo "team_create(name: \"${team_name}\")"
}

# Shutdown a team member
# Usage: ensemble_team_shutdown <member_name> [--force]
ensemble_team_shutdown() {
    local member="${1:?Usage: ensemble_team_shutdown <member> [--force]}"
    local force="${2:-false}"
    echo "team_shutdown(member: \"${member}\", force: ${force})"
}

# Cleanup the team (shuts down all members and removes team data)
# Usage: ensemble_team_cleanup [--force]
ensemble_team_cleanup() {
    local force="${1:-false}"
    echo "team_cleanup(force: ${force}, acknowledge_uncommitted: false)"
}

# ============================================================================
# Task Management
# ============================================================================

# Add tasks to the shared board
# Usage: ensemble_tasks_add "task1" "task2" ...
# Each task is a JSON object: {"content": "...", "priority": "high", "depends_on": []}
ensemble_tasks_add() {
    local tasks_json="$1"
    echo "team_tasks_add(tasks: ${tasks_json})"
}

# Claim a task
# Usage: ensemble_task_claim <task_id>
ensemble_task_claim() {
    local task_id="${1:?Usage: ensemble_task_claim <task_id>}"
    echo "team_claim(task_id: \"${task_id}\")"
}

# Complete a task
# Usage: ensemble_task_complete <task_id>
ensemble_task_complete() {
    local task_id="${1:?Usage: ensemble_task_complete <task_id>}"
    echo "team_tasks_complete(task_id: \"${task_id}\")"
}

# ============================================================================
# Messaging
# ============================================================================

# Send a message to a team member
# Usage: ensemble_message <to> <text> [--approve]
ensemble_message() {
    local to="${1:?Usage: ensemble_message <to> <text> [--approve]}"
    local text="${2:?Usage: ensemble_message <to> <text> [--approve]}"
    local approve="${3:-false}"
    echo "team_message(to: \"${to}\", text: \"${text}\", approve: ${approve})"
}

# Broadcast a message to all team members
# Usage: ensemble_broadcast <text>
ensemble_broadcast() {
    local text="${1:?Usage: ensemble_broadcast <text>}"
    echo "team_broadcast(text: \"${text}\")"
}

# Get results from a team member
# Usage: ensemble_results <from>
ensemble_results() {
    local from="${1:?Usage: ensemble_results <from>}"
    echo "team_results(from: \"${from}\")"
}

# ============================================================================
# Status & Health
# ============================================================================

# Get team status
# Usage: ensemble_status
ensemble_status() {
    echo "team_status()"
}

# Health check: verify teammates started within timeout
# Usage: ensemble_health_check <timeout_seconds>
# Returns a bash loop that polls team_status
ensemble_health_check() {
    local timeout="${1:-90}"
    local interval=10
    echo "# Health check: poll team_status every ${interval}s for ${timeout}s"
    echo "for i in $(seq 1 $((timeout / interval))); do"
    echo "  sleep ${interval}"
    echo "  team_status()"
    echo "done"
}

# ============================================================================
# Dialectic Workflow Helpers
# ============================================================================

# Create a standard plan-review team
# Usage: ensemble_plan_review <prp_path>
ensemble_plan_review() {
    local prp_path="${1:?Usage: ensemble_plan_review <prp_path>}"
    local slug
    slug="$(basename "${prp_path}" .md)"
    local team_name="plan-review-${slug}"
    
    echo "# === Plan Review Team: ${team_name} ==="
    echo ""
    echo "# 1. Create team"
    ensemble_team_create "${team_name}"
    echo ""
    echo "# 2. Add tasks (both start simultaneously)"
    ensemble_tasks_add "[
      {\"content\": \"Interlocutor: Analyze PRP for structural weaknesses\", \"priority\": \"high\"},
      {\"content\": \"Proposer: Defend and revise PRP based on feedback\", \"priority\": \"high\"}
    ]"
    echo ""
    echo "# 3. Spawn teammates"
    echo "team_spawn(name: \"interlocutor\", agent: \"interlocutor\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo "team_spawn(name: \"proposer\", agent: \"proposer\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo ""
    echo "# 4. Health check (90s)"
    ensemble_health_check 90
    echo ""
    echo "# 5. Manage exchange (orchestrator monitors and intervenes)"
    echo ""
    echo "# 6. Shutdown and cleanup"
    ensemble_team_shutdown "interlocutor" "true"
    ensemble_team_shutdown "proposer" "true"
    ensemble_team_cleanup "true"
}

# Create an execution team (Proposer + Code Reviewer)
# Usage: ensemble_execute <prp_path>
ensemble_execute() {
    local prp_path="${1:?Usage: ensemble_execute <prp_path>}"
    local slug
    slug="$(basename "${prp_path}" .md)"
    local team_name="execute-${slug}"
    
    echo "# === Execute Team: ${team_name} ==="
    echo ""
    echo "# 1. Create team"
    ensemble_team_create "${team_name}"
    echo ""
    echo "# 2. Add tasks"
    ensemble_tasks_add "[
      {\"content\": \"Proposer: Implement all PRP tasks with TDD\", \"priority\": \"high\"},
      {\"content\": \"Code Reviewer: Review each commit incrementally\", \"priority\": \"high\"}
    ]"
    echo ""
    echo "# 3. Spawn teammates"
    echo "team_spawn(name: \"proposer\", agent: \"proposer\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo "team_spawn(name: \"code-reviewer\", agent: \"code-reviewer\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo ""
    echo "# 4. Message-gated workflow: Proposer commits -> sends to Reviewer -> waits for approve -> continues"
    echo ""
    echo "# 5. Shutdown and cleanup"
    ensemble_team_shutdown "proposer" "true"
    ensemble_team_shutdown "code-reviewer" "true"
    ensemble_team_cleanup "true"
}

# Create a security audit team (Auditor + Skeptical Client)
# Usage: ensemble_security_audit <slug>
ensemble_security_audit() {
    local slug="${1:?Usage: ensemble_security_audit <slug>}"
    local team_name="audit-${slug}"
    
    echo "# === Security Audit Team: ${team_name} ==="
    echo ""
    echo "# 1. Create team"
    ensemble_team_create "${team_name}"
    echo ""
    echo "# 2. Add tasks"
    ensemble_tasks_add "[
      {\"content\": \"Security Auditor: Conduct security audit and find vulnerabilities\", \"priority\": \"high\"},
      {\"content\": \"Skeptical Client: Challenge audit findings for defensibility\", \"priority\": \"high\"}
    ]"
    echo ""
    echo "# 3. Spawn teammates"
    echo "team_spawn(name: \"auditor\", agent: \"security-auditor\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo "team_spawn(name: \"client\", agent: \"skeptical-client\", prompt: \"...\", model: \"lmstudio/qwen3.6-35b-a3b\", worktree: true, plan_approval: false)"
    echo ""
    echo "# 4. Dual-agent dialectic: Auditor sends findings -> Client challenges -> Auditor defends"
    echo ""
    echo "# 5. Shutdown and cleanup"
    ensemble_team_shutdown "auditor" "true"
    ensemble_team_shutdown "client" "true"
    ensemble_team_cleanup "true"
}
