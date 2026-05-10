#!/usr/bin/env bash
# Launch @modelcontextprotocol/server-postgres for the AgentLab environment DB (hydrate / registrations).
# Use from Claude Code: claude mcp add ... -- "$(pwd)/tools/mcp-postgres-environment.sh"
#
# Env overrides:
#   NVM_DIR                    — default ~/.nvm
#   AGENTLAB_NODE_VERSION    — default 22
#   AGENTLAB_ENVIRONMENT_PG_URL — full postgres URL (default matches docker-compose port 5433)

set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
  nvm use "${AGENTLAB_NODE_VERSION:-22}" --silent
fi

URL="${AGENTLAB_ENVIRONMENT_PG_URL:-postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment}"

exec npx -y @modelcontextprotocol/server-postgres "${URL}"
