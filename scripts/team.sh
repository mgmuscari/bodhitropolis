#!/usr/bin/env bash
# team.sh — Unified team interface for dialectic workflow
# Detects environment and routes to appropriate backend (Claude Code or OpenCode Ensemble)
#
# Usage:
#   scripts/team.sh create <team_name>
#   scripts/team.sh spawn <name> <agent_type> <prompt_file> [model]
#   scripts/team.sh tasks-add <task_file>
#   scripts/team.sh tasks-claim <task_id>
#   scripts/team.sh message <to> <message_file> [--approve]
#   scripts/team.sh status
#   scripts/team.sh shutdown <member> [--force]
#   scripts/team.sh cleanup [--force]
#   scripts/team.sh broadcast <message_file>
#   scripts/team.sh results <from>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Detect environment
ENV_TYPE="$("${SCRIPT_DIR}/detect-env.sh")"

if [ "${ENV_TYPE}" = "unknown" ]; then
    echo "ERROR: Could not detect environment (Claude Code or OpenCode)" >&2
    echo "Ensure you're running inside one of these tools." >&2
    exit 1
fi

echo "[team] Environment: ${ENV_TYPE}" >&2

case "${1:-}" in
    create)
        TEAM_NAME="${2:?Usage: team.sh create <team_name>}"
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code team create — use Claude Code's TeamCreate tool"
            # This is invoked by the orchestrator (Claude Code itself), not a script
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            team_create "${TEAM_NAME}"
        fi
        ;;
    spawn)
        NAME="${2:?Usage: team.sh spawn <name> <agent_type> <prompt_file> [model]}"
        AGENT_TYPE="${3:?Usage: team.sh spawn <name> <agent_type> <prompt_file> [model]}"
        PROMPT_FILE="${4:?Usage: team.sh spawn <name> <agent_type> <prompt_file> [model]}"
        MODEL="${5:-}"
        
        if [ ! -f "${PROMPT_FILE}" ]; then
            echo "ERROR: Prompt file not found: ${PROMPT_FILE}" >&2
            exit 1
        fi
        
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code spawn — use Claude Code's Agent spawn tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            SPAWN_ARGS="name:${NAME} agent:${AGENT_TYPE} prompt_file:${PROMPT_FILE}"
            [ -n "${MODEL}" ] && SPAWN_ARGS+=" model:${MODEL}"
            echo "TODO: OpenCode spawn — ${SPAWN_ARGS}"
        fi
        ;;
    tasks-add)
        TASK_FILE="${2:?Usage: team.sh tasks-add <task_file>}"
        if [ ! -f "${TASK_FILE}" ]; then
            echo "ERROR: Task file not found: ${TASK_FILE}" >&2
            exit 1
        fi
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code tasks-add — use TaskCreate tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode tasks-add — use team_tasks_add"
        fi
        ;;
    tasks-claim)
        TASK_ID="${2:?Usage: team.sh tasks-claim <task_id>}"
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code tasks-claim — use TaskUpdate tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode tasks-claim — use team_claim ${TASK_ID}"
        fi
        ;;
    message)
        TO="${2:?Usage: team.sh message <to> <message_file> [--approve]}"
        MESSAGE_FILE="${3:?Usage: team.sh message <to> <message_file> [--approve]}"
        APPROVE=""
        if [ "${4:-}" = "--approve" ]; then
            APPROVE="true"
        fi
        if [ ! -f "${MESSAGE_FILE}" ]; then
            echo "ERROR: Message file not found: ${MESSAGE_FILE}" >&2
            exit 1
        fi
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code message — use SendMessage tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode message — team_message to=${TO} approve=${APPROVE:-false}"
        fi
        ;;
    status)
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code status — use TaskList tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode status — use team_status"
        fi
        ;;
    shutdown)
        MEMBER="${2:?Usage: team.sh shutdown <member> [--force]}"
        FORCE=""
        if [ "${3:-}" = "--force" ]; then
            FORCE="true"
        fi
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code shutdown — use shutdown_request tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode shutdown — team_shutdown member=${MEMBER} force=${FORCE:-false}"
        fi
        ;;
    cleanup)
        FORCE=""
        if [ "${1:-}" = "--force" ]; then
            FORCE="true"
        fi
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code cleanup — use TeamDelete tool"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode cleanup — team_cleanup force=${FORCE:-false}"
        fi
        ;;
    broadcast)
        MESSAGE_FILE="${2:?Usage: team.sh broadcast <message_file>}"
        if [ ! -f "${MESSAGE_FILE}" ]; then
            echo "ERROR: Message file not found: ${MESSAGE_FILE}" >&2
            exit 1
        fi
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code broadcast — send to all teammates via SendMessage"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode broadcast — use team_broadcast"
        fi
        ;;
    results)
        FROM="${2:?Usage: team.sh results <from>}"
        if [ "${ENV_TYPE}" = "claude-code" ]; then
            echo "TODO: Claude Code results — retrieve from message history"
        elif [ "${ENV_TYPE}" = "opencode" ]; then
            echo "TODO: OpenCode results — use team_results from=${FROM}"
        fi
        ;;
    *)
        echo "Usage: team.sh {create|spawn|tasks-add|tasks-claim|message|status|shutdown|cleanup|broadcast|results} [args...]" >&2
        echo "" >&2
        echo "Detected environment: ${ENV_TYPE}" >&2
        exit 1
        ;;
esac
