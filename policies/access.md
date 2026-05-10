# Policy: Access boundaries

**Status:** v1.1 — advisory at the prompt level **and** enforced by `hooks/scripts/policy-check.sh` (`PreToolUse` hook). The hook denies tool calls to unregistered MCP servers and write-class operations without recorded consent.

Read by the manager on bootstrap and by every agent before issuing tool calls.

## Allowed surfaces

AgentLab agents may only call MCP tools belonging to:

1. **Datalakes** registered in `context.json#/data_sources` (`mcp_server` field is the allowlist).
2. **Catalogs** registered in `context.json#/catalogs`.
3. The Claude Code built-in file/edit tools, scoped to the user's workspace.

Any tool from an unregistered MCP server **must be refused**. The manager rejects dispatch slices that reference unknown server ids.

## Read vs write

Each registered datalake carries an implied **mode**:

- `read` — default. `query` is allowed to issue read-only operations native to the paradigm (`SELECT`, `MATCH`, `range_query`, `find`, etc.).
- `read_write` — only when the user has explicitly registered the datalake as writable (`tags: ["writable"]`).

Default behavior:

| Operation | `read` | `read_write` |
|-----------|--------|--------------|
| Read query | allowed | allowed |
| `INSERT` / `UPDATE` / `DELETE` / DDL / equivalent | refuse | require **per-call user confirmation** in chat |
| Long-running / unbounded scan | refuse without `LIMIT`/aggregation | refuse without `LIMIT`/aggregation |

`query` is the only agent that may issue write-class operations, and only after manager consent has been recorded as a finding entry.

## Manager bootstrap checks

On first per-question dispatch the manager:

1. Reads this file.
2. Verifies every `mcp_server` in `context.json#/data_sources` and `#/catalogs` resolves to an actually-loaded MCP server in the user session.
3. Refuses to dispatch if any server is missing — surfaces the gap to the user with a route to `discovery` for re-registration.

## Refusal behavior

When an agent or the manager refuses an action:

- Respond inline to the user with the rule violated and a one-line remediation.
- Persist the attempt under `open_questions` (not `findings`).
- Never silently downgrade — write attempts must not be re-issued as reads.

## Multi-tenant / shared workspaces

Out of scope for v1. Workspaces are assumed single-user.

## Hook integration (shipped, v1.1)

`hooks/hooks.json` registers a `PreToolUse` hook against `mcp__.*` that runs `hooks/scripts/policy-check.sh`. The script:

1. Rejects tool calls whose MCP server is not in the workspace allowlist (`.agentlab/context.json#/data_sources[].mcp_server` ∪ `#/catalogs[].mcp_server`).
2. Rejects write-class operations (`INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / MERGE / TRUNCATE / GRANT / REVOKE`, plus Mongo write operators) unless **both** the datalake is tagged `writable` and a fresh consent token exists at `.agentlab/.consent_token` (modified < 10 min).

The hook fails open when the workspace is not yet bootstrapped (`.agentlab/context.json` missing) or `jq` is unavailable, so it never blocks normal authoring.
