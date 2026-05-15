# AgentLab — hooks

This directory ships the v1.1 **policy enforcement layer**: Claude Code plugin hooks that gate tool calls before they reach an MCP server.

## What it enforces

For every tool call matching `mcp__.*`, the `PreToolUse` hook runs `scripts/policy-check.sh`, which:

1. **MCP allowlist (`policies/access.md`)** — denies if the MCP server in the tool name is not registered under `.agentlab/context.json#/data_sources[].mcp_server` or `#/catalogs[].mcp_server`.
2. **Write-class veto (`policies/access.md`)** — denies `INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / MERGE / TRUNCATE / GRANT / REVOKE` and Mongo write operators (`$set`, `$unset`, `$inc`, `$push`, `$pull`) unless **both**:
   - the datalake is tagged `writable` in registration, **and**
   - a fresh consent token exists at `.agentlab/.consent_token` (modified < 10 minutes ago).
3. **PII heuristic (`policies/pii.md`)** — denies tool inputs that project name-heuristic PII fields (email, phone, ssn, dob, address, ip, card, password, etc.) unmasked. Strictness: set **`AGENTLAB_PII_STRICTNESS`** (`strict` \| `default` \| `lenient`) in the environment that launches Claude Code; if unset, the hook uses **`default`** (notebook `preferences` is not read by this shell hook).

Hooks are loaded automatically when this plugin is enabled (Claude Code merges `hooks/hooks.json` from each enabled plugin with user/project hooks).

## When checks are skipped

The script intentionally fails open when the workspace is unprepared, so the hook never blocks normal authoring flows:

- `jq` is not installed.
- `.agentlab/context.json` does not exist (workspace not yet bootstrapped).
- Tool is not an MCP tool.
- `preferences.pii_strictness = "lenient"` (PII check only).

## Verdict semantics

The script always exits 0 and emits a single JSON object on stdout matching Claude Code's `PreToolUse` output schema:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny",
    "permissionDecisionReason": "<shown to Claude on deny / to user on allow>"
  },
  "systemMessage": "<short user-facing warning, on deny only>"
}
```

## Manual checks

Smoke-test from the plugin root:

```bash
# Allowed: server is in the allowlist (assumes context.json registers postgres-fpl)
echo '{"tool_name":"mcp__postgres-fpl__query","tool_input":{"sql":"SELECT id FROM teams LIMIT 5"},"cwd":"'"$PWD"'"}' \
  | ./hooks/scripts/policy-check.sh | jq

# Denied: unregistered server
echo '{"tool_name":"mcp__unknown-server__query","tool_input":{"sql":"SELECT 1"},"cwd":"'"$PWD"'"}' \
  | ./hooks/scripts/policy-check.sh | jq

# Denied: PII projection
echo '{"tool_name":"mcp__postgres-fpl__query","tool_input":{"sql":"SELECT email, name FROM users"},"cwd":"'"$PWD"'"}' \
  | ./hooks/scripts/policy-check.sh | jq

# Denied: write-class without consent
echo '{"tool_name":"mcp__postgres-fpl__query","tool_input":{"sql":"DELETE FROM users WHERE id=1"},"cwd":"'"$PWD"'"}' \
  | ./hooks/scripts/policy-check.sh | jq
```

## Limitations

- **Name-based PII heuristic only.** Catalog flags from `domain-specialist` are not yet routed into hook context; the manager applies them at dispatch time, but the hook itself only knows the regex list in Appendix A of `policies/pii.md`.
- **Lexical write-class detection.** Comments containing `DELETE` will trip the veto. Authors should keep query strings free of misleading literals or override via per-call user consent.
- **Single-language regex.** The same regex applies to every paradigm. False positives in PromQL / Cypher are possible; tune `pii_names` in the script when needed.
- **Bash + jq dependency.** A future version may ship a small Node/Python implementation for parity with non-Unix environments.

## Disabling

To skip enforcement temporarily:

```bash
mv hooks/hooks.json hooks/hooks.json.disabled
```

Or disable the plugin entirely. The skill body still expects agents to respect `policies/*.md` at the prompt level even without the hook.
