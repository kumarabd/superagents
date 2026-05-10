#!/usr/bin/env bash
# AgentLab — PreToolUse policy enforcer.
#
# Fires on tool_name ~ /mcp__.*/. Reads JSON event from stdin and emits a
# PreToolUse hookSpecificOutput JSON object on stdout. Exit code is always 0;
# decisions are conveyed via JSON.
#
# Decisions:
#   allow — passes all three checks
#   deny  — failed at least one check; permissionDecisionReason explains
#
# Checks (in order):
#   1. MCP allowlist     — tool's mcp server must be registered in
#                          .agentlab/context.json#/data_sources[].mcp_server
#                          or #/catalogs[].mcp_server
#   2. Write-class veto  — tool_input strings must not contain unconsented
#                          INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/MERGE/TRUNCATE
#                          unless the matching datalake is tagged "writable" AND
#                          .agentlab/.consent_token exists and is fresh (<10min).
#   3. PII heuristic     — tool_input strings must not project regex-flagged PII
#                          columns unmasked (heuristic only; catalog flags win
#                          when domain-specialist ran).
#
# Limitations:
#   - Heuristics are intentionally conservative; a strict parse of every
#     paradigm is out of scope.
#   - PII catalog flags from domain-specialist are not yet machine-readable; the
#     skill body adds them at dispatch time. This script enforces the static
#     name-based heuristic (Appendix A of policies/pii.md).
#
# Required tools: jq.

set -u
set -o pipefail

input="$(cat)"

emit_allow() {
  jq -n --arg msg "${1:-}" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: $msg
    }
  }'
  exit 0
}

emit_deny() {
  jq -n --arg msg "$1" --arg sys "${2:-AgentLab policy check denied a tool call.}" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    },
    systemMessage: $sys
  }'
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  emit_allow "policy-check: jq not available; skipping enforcement (install jq for v1.1 policy enforcement)."
fi

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

# Only act on MCP tools. Other tools fall through (the matcher should already
# narrow, but we guard regardless).
case "$tool_name" in
  mcp__*) ;;
  *) emit_allow "policy-check: non-MCP tool, no policy applied." ;;
esac

# Locate workspace context.
project_dir="${CLAUDE_PROJECT_DIR:-$cwd}"
context_path="$project_dir/.agentlab/context.json"

if [ ! -f "$context_path" ]; then
  emit_allow "policy-check: no .agentlab/context.json (workspace not bootstrapped); skipping enforcement."
fi

# Extract MCP server id from tool_name. Format: mcp__<server>__<method>.
# Use parameter expansion for portability across BSD / GNU userlands.
rest="${tool_name#mcp__}"
mcp_server="${rest%%__*}"

# ─── 1. Allowlist check ────────────────────────────────────────────────────
allowlist_json="$(jq '[.data_sources[]?.mcp_server, .catalogs[]?.mcp_server]' "$context_path" 2>/dev/null || echo '[]')"

if [ "$allowlist_json" = "[]" ]; then
  emit_deny "MCP server '$mcp_server' rejected: no datalakes/catalogs registered in .agentlab/context.json. Run discovery (registration mode) first." "AgentLab access policy: server not registered."
fi

if ! printf '%s' "$allowlist_json" | jq -e --arg s "$mcp_server" 'index($s)' >/dev/null; then
  emit_deny "MCP server '$mcp_server' is not in this workspace's registered allowlist. Register it via discovery or remove the tool call." "AgentLab access policy: server not in allowlist."
fi

# Identify whether the server is a writable datalake.
is_writable="$(jq --arg s "$mcp_server" '
  (.data_sources[]? | select(.mcp_server==$s) | (.tags // [] | index("writable") != null))
  // false
' "$context_path" 2>/dev/null | head -n 1)"
[ -z "$is_writable" ] && is_writable="false"

# Flatten tool_input string scalars for downstream regex scans.
tool_input_text="$(printf '%s' "$input" | jq -r '.tool_input | [.. | strings] | join("\n")' 2>/dev/null || echo "")"

# ─── 2. Write-class veto ───────────────────────────────────────────────────
write_class_pattern='\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|TRUNCATE|GRANT|REVOKE)\b|\$set|\$unset|\$inc|\$push|\$pull'

if printf '%s' "$tool_input_text" | grep -qiE "$write_class_pattern"; then
  if [ "$is_writable" != "true" ]; then
    emit_deny "Write-class operation detected against datalake '$mcp_server' which is not tagged 'writable'. Refusing per policies/access.md." "AgentLab access policy: write-class blocked on read-only source."
  fi
  consent_file="$project_dir/.agentlab/.consent_token"
  if [ ! -f "$consent_file" ]; then
    emit_deny "Write-class operation against '$mcp_server' requires explicit user consent recorded at .agentlab/.consent_token. Refusing." "AgentLab access policy: write requires recorded consent."
  fi
  consent_age=$(( $(date +%s) - $(stat -f %m "$consent_file" 2>/dev/null || stat -c %Y "$consent_file" 2>/dev/null || echo 0) ))
  if [ "$consent_age" -gt 600 ]; then
    emit_deny "Write consent token at .agentlab/.consent_token is stale (> 10 min). Refresh via the manager and retry." "AgentLab access policy: stale consent token."
  fi
fi

# ─── 3. PII heuristic ──────────────────────────────────────────────────────
# Heuristic: an unmasked column projection (i.e. the bare identifier appears
# without a wrapping function call) of any of these names is denied.
pii_names='email|e_mail|mail|phone|mobile|tel|ssn|nin|national_id|passport|aadhaar|pan|dob|date_of_birth|birthdate|addr|address|street|postcode|zip|ip|ip_addr|client_ip|card|pan_number|cvv|iban|account_no|password|pwd|secret|token|api_key'

# Skip if the workspace asks for lenient strictness.
strictness="$(jq -r '.preferences.pii_strictness // "default"' "$context_path" 2>/dev/null)"

if [ "$strictness" != "lenient" ]; then
  if printf '%s' "$tool_input_text" | grep -qiE "(^|[^a-zA-Z0-9_])($pii_names)([^a-zA-Z0-9_(]|$)"; then
    if [ "$strictness" = "strict" ]; then
      emit_deny "Tool input projects a heuristic PII field unmasked. Mask, hash, or aggregate per policies/pii.md (strict mode)." "AgentLab PII policy: PII column reference blocked."
    else
      # Default mode: require the field to be wrapped in a masking/aggregating fn.
      # Conservative check — if the literal name appears bare (not followed by '('),
      # treat it as a projection.
      emit_deny "Tool input appears to project a heuristic PII field unmasked. Wrap with a masking or aggregating function (HASH/MASK/COUNT/AVG) or override via preferences.pii_strictness=lenient. See policies/pii.md." "AgentLab PII policy: PII column reference blocked."
    fi
  fi
fi

emit_allow "policy-check: passed allowlist + write-class + PII heuristics."
