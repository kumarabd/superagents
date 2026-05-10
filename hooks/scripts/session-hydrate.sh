#!/usr/bin/env bash
# SessionStart hook: hydrate global registrations into .agentlab/context.json.
# Fail-open if DSN or binary missing. Session metadata from stdin is not used for SQL (v1).

set -uo pipefail

if [[ -z "${AGENTLAB_PG_DSN:-}" ]]; then
  echo "agentlab session-hydrate: AGENTLAB_PG_DSN unset; skipping hydrate." >&2
  exit 0
fi

BIN="${AGENTLAB_PROVIDER_BIN:-${AGENTLAB_ENV_BIN:-}}"
if [[ -z "$BIN" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  plugin_root="$(cd "${script_dir}/../.." && pwd)"
  if [[ -x "${plugin_root}/tools/agentlab-provider/agentlab-provider" ]]; then
    BIN="${plugin_root}/tools/agentlab-provider/agentlab-provider"
  elif [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -x "${CLAUDE_PLUGIN_ROOT}/tools/agentlab-provider/agentlab-provider" ]]; then
    BIN="${CLAUDE_PLUGIN_ROOT}/tools/agentlab-provider/agentlab-provider"
  elif command -v agentlab-provider >/dev/null 2>&1; then
    BIN="$(command -v agentlab-provider)"
  fi
fi

if [[ -z "$BIN" ]]; then
  echo "agentlab session-hydrate: agentlab-provider not found; set AGENTLAB_PROVIDER_BIN (or legacy AGENTLAB_ENV_BIN) or build tools/agentlab-provider." >&2
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$project_dir" ]] && command -v jq >/dev/null 2>&1; then
  project_dir="$(jq -r '.cwd // empty')"
fi

if [[ -z "$project_dir" ]]; then
  echo "agentlab session-hydrate: CLAUDE_PROJECT_DIR unset and hook cwd missing; skipping hydrate." >&2
  exit 0
fi

exec "$BIN" hydrate --project-dir "$project_dir"
