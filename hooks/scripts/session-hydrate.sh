#!/usr/bin/env bash
# SessionStart hook: hydrate .agentlab/context.json, then upsert SessionStart JSON into Postgres (agentlab_sessions).
# Fail-open if DSN or binary missing. Reads hook payload from stdin once; never blocks on jq + TTY.
#
# Hydrate merges DB registrations + normalizes notebook arrays; session-record stores session_id, source, cwd, etc.

set -uo pipefail

hook_json=""
if [[ ! -t 0 ]]; then
  hook_json="$(cat)" || true
fi

debug() {
  if [[ "${AGENTLAB_HYDRATE_DEBUG:-}" == "1" ]]; then
    printf 'agentlab session-hydrate[debug]: %s\n' "$*" >&2
  fi
}

debug "started (SessionStart hydrate + session-record)"
debug "hook stdin bytes=${#hook_json}"

if [[ -z "${AGENTLAB_PG_DSN:-}" ]]; then
  echo "agentlab session-hydrate: AGENTLAB_PG_DSN unset; skipping hydrate and session-record." >&2
  exit 0
fi
debug "AGENTLAB_PG_DSN is set (length=${#AGENTLAB_PG_DSN})"

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
debug "binary: $BIN"

project_dir="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$project_dir" ]] && command -v jq >/dev/null 2>&1 && [[ -n "$hook_json" ]]; then
  project_dir="$(printf '%s' "$hook_json" | jq -r '.cwd // empty')"
fi

if [[ -z "$project_dir" ]]; then
  echo "agentlab session-hydrate: CLAUDE_PROJECT_DIR unset and hook cwd missing; skipping hydrate and session-record." >&2
  exit 0
fi
debug "project_dir=$project_dir CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-<empty>}"

seed_template=""
if [[ -n "${AGENTLAB_CONTEXT_TEMPLATE:-}" && -f "${AGENTLAB_CONTEXT_TEMPLATE}" ]]; then
  seed_template="${AGENTLAB_CONTEXT_TEMPLATE}"
elif [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "${CLAUDE_PLUGIN_ROOT}/templates/context.init.json" ]]; then
  seed_template="${CLAUDE_PLUGIN_ROOT}/templates/context.init.json"
else
  script_dir_fallback="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root_fallback="$(cd "${script_dir_fallback}/../.." && pwd)"
  if [[ -f "${repo_root_fallback}/templates/context.init.json" ]]; then
    seed_template="${repo_root_fallback}/templates/context.init.json"
  fi
fi

ctx_dir="${project_dir}/.agentlab"
mkdir -p "${ctx_dir}/artifacts/"{queries,results,scripts,models,reports,plans,critiques,visualizations} "${ctx_dir}/snapshots"

extra=()
if [[ -n "${seed_template}" ]]; then
  extra+=(--template "${seed_template}")
  debug "template: $seed_template"
else
  debug "no template path resolved (ok if .agentlab/context.json already exists)"
fi

debug "running: $BIN hydrate --project-dir $project_dir (${#extra[@]} extra args)"
"$BIN" hydrate "${extra[@]}" --project-dir "${project_dir}"
hydrate_rc=$?

if [[ -n "$hook_json" ]]; then
  if printf '%s' "$hook_json" | "$BIN" session-record --project-dir "${project_dir}"; then
    debug "session-record ok"
  else
    echo "agentlab session-hydrate: session-record failed (non-fatal)" >&2
  fi
else
  debug "empty hook JSON; skipping session-record (manual run?)"
fi

exit "$hydrate_rc"
