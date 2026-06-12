#!/usr/bin/env bash
# claude-team.sh — Claude Code team commands for dialectic workflow
# This script provides helper functions for orchestrating dialectic teams
# in Claude Code using the experimental agent teams API.
#
# Usage: source scripts/claude-team.sh
#        Then call functions like: claude_team_create, claude_plan_review, etc.
#
# These functions output tool call instructions that the Claude Code orchestrator
# will execute. They serve as both documentation and generation templates.
#
# Prerequisites:
#   - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in settings
#   - Claude Code v2.1.46+ recommended

set -euo pipefail

# ============================================================================
# Helper: Check if we're in Claude Code with teams enabled
# ============================================================================
claude_check_env() {
    if [ "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-0}" != "1" ]; then
        echo "ERROR: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is not set to 1" >&2
        echo "Add to .claude/settings.json:" >&2
        echo '  {"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}}' >&2
        return 1
    fi
}

# ============================================================================
# Team Lifecycle
# ============================================================================

# Create a new team
# Usage: claude_team_create "team-name"
claude_team_create() {
    local team_name="${1:?Usage: claude_team_create <team_name>}"
    echo "TeamCreate(team_name: \"${team_name}\")"
}

# Shutdown a team member
# Usage: claude_team_shutdown <member_name>
claude_team_shutdown() {
    local member="${1:?Usage: claude_team_shutdown <member>}"
    echo "shutdown_request(to: \"${member}\")"
}

# Cleanup the team
# Usage: claude_team_cleanup
claude_team_cleanup() {
    echo "TeamDelete()"
}

# ============================================================================
# Task Management
# ============================================================================

# Create a task
# Usage: claude_task_create <name> <description>
claude_task_create() {
    local name="${1:?Usage: claude_task_create <name> <description>}"
    local description="${2:?Usage: claude_task_create <name> <description>}"
    echo "TaskCreate(name: \"${name}\", description: \"${description}\")"
}

# Assign a task to a member
# Usage: claude_task_assign <task_id> <assignee>
claude_task_assign() {
    local task_id="${1:?Usage: claude_task_assign <task_id> <assignee>}"
    local assignee="${2:?Usage: claude_task_assign <task_id> <assignee>}"
    echo "TaskUpdate(task_id: \"${task_id}\", assignee: \"${assignee}\")"
}

# ============================================================================
# Messaging
# ============================================================================

# Send a message to a team member
# Usage: claude_message <to> <text>
claude_message() {
    local to="${1:?Usage: claude_message <to> <text>}"
    local text="${2:?Usage: claude_message <to> <text>}"
    echo "SendMessage(to: \"${to}\", text: \"${text}\")"
}

# ============================================================================
# Status & Health
# ============================================================================

# Get team status
# Usage: claude_status
claude_status() {
    echo "TaskList()"
}

# Health check: verify teammates started within timeout
# Usage: claude_health_check <timeout_seconds>
# Returns a bash loop that polls TaskList
claude_health_check() {
    local timeout="${1:-90}"
    local interval=10
    echo "# Health check: poll TaskList every ${interval}s for ${timeout}s"
    echo "for i in $(seq 1 $((timeout / interval))); do"
    echo "  sleep ${interval}"
    echo "  TaskList()"
    echo "done"
}

# ============================================================================
# Dialectic Workflow Helpers
# ============================================================================

# Create a standard plan-review team
# Usage: claude_plan_review <prp_path>
claude_plan_review() {
    local prp_path="${1:?Usage: claude_plan_review <prp_path>}"
    local slug
    slug="$(basename "${prp_path}" .md)"
    local team_name="plan-review-${slug}"
    
    echo "# === Plan Review Team: ${team_name} ==="
    echo ""
    echo "# 1. TeamCreate"
    claude_team_create "${team_name}"
    echo ""
    echo "# 2. TaskCreate x2 (both start simultaneously)"
    claude_task_create "Analyze PRP for structural weaknesses" "Interlocutor stance + instructions for {prp_path}"
    claude_task_create "Defend and revise PRP" "Proposer stance + instructions for {prp_path}"
    echo ""
    echo "# 3. Agent spawn x2 (run_in_background: true, model: \"opus\")"
    echo "Agent spawn(name: \"interlocutor\", subagent_type: \"interlocutor\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo "Agent spawn(name: \"proposer\", subagent_type: \"proposer\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo ""
    echo "# 4. TaskUpdate x2 (assign tasks)"
    echo "TaskUpdate(task_id: \"<task-a>\", assignee: \"interlocutor\")"
    echo "TaskUpdate(task_id: \"<task-b>\", assignee: \"proposer\")"
    echo ""
    echo "# 5. Health check (90s)"
    claude_health_check 90
    echo ""
    echo "# 6. Manage exchange (orchestrator monitors and intervenes)"
    echo ""
    echo "# 7. Shutdown and cleanup"
    claude_team_shutdown "interlocutor"
    claude_team_shutdown "proposer"
    claude_team_cleanup
}

# Create an execution team (Proposer + Code Reviewer)
# Usage: claude_execute <prp_path>
claude_execute() {
    local prp_path="${1:?Usage: claude_execute <prp_path>}"
    local slug
    slug="$(basename "${prp_path}" .md)"
    local team_name="execute-${slug}"
    
    echo "# === Execute Team: ${team_name} ==="
    echo ""
    echo "# 1. TeamCreate"
    claude_team_create "${team_name}"
    echo ""
    echo "# 2. TaskCreate x2"
    claude_task_create "Implement PRP tasks" "Proposer stance + TDD instructions for {prp_path}"
    claude_task_create "Review commits" "Code Reviewer stance + instructions for {prp_path}"
    echo ""
    echo "# 3. Agent spawn x2 (run_in_background: true, model: \"opus\")"
    echo "Agent spawn(name: \"proposer\", subagent_type: \"proposer\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo "Agent spawn(name: \"code-reviewer\", subagent_type: \"code-reviewer\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo ""
    echo "# 4. Message-gated workflow: Proposer commits -> SendMessage to reviewer -> waits -> continues"
    echo ""
    echo "# 5. Shutdown and cleanup"
    claude_team_shutdown "proposer"
    claude_team_shutdown "code-reviewer"
    claude_team_cleanup
}

# Create a security audit team (Auditor + Skeptical Client)
# Usage: claude_security_audit <slug>
claude_security_audit() {
    local slug="${1:?Usage: claude_security_audit <slug>}"
    local team_name="audit-${slug}"
    
    echo "# === Security Audit Team: ${team_name} ==="
    echo ""
    echo "# 1. TeamCreate"
    claude_team_create "${team_name}"
    echo ""
    echo "# 2. TaskCreate x2"
    claude_task_create "Security audit" "Security Auditor stance + instructions"
    claude_task_create "Challenge findings" "Skeptical Client stance + instructions"
    echo ""
    echo "# 3. Agent spawn x2 (run_in_background: true, model: \"opus\")"
    echo "Agent spawn(name: \"auditor\", subagent_type: \"security-auditor\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo "Agent spawn(name: \"client\", subagent_type: \"skeptical-client\", team_name: \"${team_name}\", model: \"opus\", run_in_background: true)"
    echo ""
    echo "# 4. Dual-agent dialectic: Auditor sends findings -> Client challenges -> Auditor defends"
    echo ""
    echo "# 5. Shutdown and cleanup"
    claude_team_shutdown "auditor"
    claude_team_shutdown "client"
    claude_team_cleanup
}
