#!/usr/bin/env bash
# SessionStart hook: hydrate global registrations into .agentlab/context.json.
# Fail-open if DSN or binary missing. Session metadata from stdin is not used for SQL (v1).
#
# If context.json exists: merge data_sources + catalogs from Postgres (other keys untouched).
# If missing: hydrate seeds from templates/context.init.json (--template), then merges from DB.

set -uo pipefail

debug() {
  if [[ "${AGENTLAB_HYDRATE_DEBUG:-}" == "1" ]]; then
    printf 'agentlab session-hydrate[debug]: %s\n' "$*" >&2
  fi
}

debug "started (SessionStart hydrate hook)"

if [[ -z "${AGENTLAB_PG_DSN:-}" ]]; then
  echo "agentlab session-hydrate: AGENTLAB_PG_DSN unset; skipping hydrate." >&2
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
if [[ -z "$project_dir" ]] && command -v jq >/dev/null 2>&1; then
  project_dir="$(jq -r '.cwd // empty')"
fi

if [[ -z "$project_dir" ]]; then
  echo "agentlab session-hydrate: CLAUDE_PROJECT_DIR unset and hook cwd missing; skipping hydrate." >&2
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
exec "$BIN" hydrate "${extra[@]}" --project-dir "${project_dir}"
