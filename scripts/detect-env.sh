#!/usr/bin/env bash
# detect-env.sh — Detects whether we're running in Claude Code or OpenCode
# Output: "claude-code" or "opencode" or "unknown"
# Sets: ENV_TYPE, ENV_EXPERIMENTAL_TEAMS, ENV_TEAM_COMMANDS_DIR

set -euo pipefail

ENV_TYPE="unknown"
ENV_EXPERIMENTAL_TEAMS=""
ENV_TEAM_COMMANDS_DIR=""

# Check for Claude Code environment
if [ -n "${CLAUDE_CODE_VERSION:-}" ] || [ -n "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" ] || [ -d "${HOME}/.claude" ] && [ -f "${HOME}/.claude/settings.json" ]; then
    # Verify it's actually Claude Code by checking for .claude/agents directory
    if [ -d ".claude/agents" ] || [ -d "${HOME}/.claude/agents" ]; then
        ENV_TYPE="claude-code"
        ENV_EXPERIMENTAL_TEAMS="${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-0}"
        ENV_TEAM_COMMANDS_DIR=".claude/commands"
        # Check if teams are enabled
        if [ "${ENV_EXPERIMENTAL_TEAMS}" != "1" ]; then
            echo "WARNING: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is not set to 1" >&2
            echo "Team mode requires: export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1" >&2
        fi
        echo "${ENV_TYPE}"
        return 0 2>/dev/null || exit 0
    fi
fi

# Check for OpenCode environment
if [ -n "${OPENCODE_VERSION:-}" ] || [ -f "opencode.json" ] || [ -f "${HOME}/.opencode/opencode.json" ]; then
    # Verify it's actually OpenCode by checking for opencode binary or .opencode directory
    if command -v opencode &>/dev/null || [ -d ".opencode" ] || [ -d "${HOME}/.opencode" ]; then
        ENV_TYPE="opencode"
        # Check for ensemble plugin
        if grep -q "opencode-ensemble" opencode.json 2>/dev/null || grep -q "opencode-ensemble" "${HOME}/.opencode/opencode.json" 2>/dev/null; then
            ENV_EXPERIMENTAL_TEAMS="1"
            ENV_TEAM_COMMANDS_DIR=".opencode/commands"
        fi
        echo "${ENV_TYPE}"
        return 0 2>/dev/null || exit 0
    fi
fi

# Fallback: check environment variables
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    ENV_TYPE="claude-code"
    ENV_EXPERIMENTAL_TEAMS="${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-0}"
    ENV_TEAM_COMMANDS_DIR=".claude/commands"
    echo "${ENV_TYPE}"
    return 0 2>/dev/null || exit 0
fi

if [ -n "${OPENCODE_SESSION_ID:-}" ] || [ -n "${OPENCODE_VERSION:-}" ]; then
    ENV_TYPE="opencode"
    ENV_TEAM_COMMANDS_DIR=".opencode/commands"
    echo "${ENV_TYPE}"
    return 0 2>/dev/null || exit 0
fi

echo "unknown"
return 0 2>/dev/null || exit 0
