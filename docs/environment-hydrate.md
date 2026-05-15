# Postgres-backed global environment hydrate

AgentLab can load **datalake** and **catalog** registrations from PostgreSQL and merge them into `.agentlab/context.json`. This keeps the same contract as manual registration ([`schemas/context.schema.json`](../schemas/context.schema.json)): [`hooks/scripts/policy-check.sh`](../hooks/scripts/policy-check.sh) and the skill still read **`data_sources[]`** and **`catalogs[]`** from the file.

**Merge semantics:** Postgres only supplies **`data_sources[]`** and **`catalogs[]`**. Those are **merged by `id`** with the file (file-only ids stay; same **`id`** → **DB wins**; new DB ids added). Hydrate then **dedupes and sorts only** `data_sources` and `catalogs` (stable key: `id`). **Notebook memory** (findings, hypotheses, preferences, …) is **not** in `context.json`; use the memory adapter MCP tools **`notebook.load`** / **`notebook.patch`** (see [`schemas/notebook.schema.json`](../schemas/notebook.schema.json) and [`docs/context-and-memory.md`](context-and-memory.md)).

For how registrations relate to episodic/semantic memory in the notebook, see [`docs/context-and-memory.md`](context-and-memory.md).

## v1 model: global pool (no session scoping)

- Every hydrate run executes **`SELECT … ORDER BY registration_id`** over **`agentlab_data_sources`** and **`agentlab_catalogs`** with **no** `session_id` or workspace filter.
- **Security:** anyone who can reach this database and run hydrate gets **every** registered `mcp_server` in their allowlist. Intended for **single-tenant** local or trusted environments; multi-tenant setups should add filtering later.

## Docker Compose: two Postgres services

Compose defines Docker network **`agentlab`** (for optional `docker run --network agentlab` MCP — see [`docs/claude-mcp-postgres.md`](claude-mcp-postgres.md)). Normal setup uses **`claude mcp add`** with **`127.0.0.1:5433`** / **`:5434`** only.

| Service | Image | Host port | Database | Role |
|---------|--------|-----------|----------|------|
| `postgres-environment` | `postgres:16-alpine` | **5433** | `agentlab_environment` | Registration tables for **`agentlab-provider hydrate`** only |
| `postgres-pgvector` | `pgvector/pgvector:pg16` | **5434** | `agentlab_vectors` | **pgvector** extension enabled (`CREATE EXTENSION vector`); use for embedding tables / semantic catalog |

Hydration **never** connects to the pgvector instance—only to **`postgres-environment`**. Point your **catalog MCP** at **`localhost:5434`** / `agentlab_vectors` when you implement vector search in SQL.

Connection string for the vector DB (for MCP config or apps):

```text
postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5434/agentlab_vectors
```

## MCP servers: there is no bundled “gateway”

This repo does **not** ship an MCP server binary. You install whatever MCP implementation fits your stack (official Postgres MCP, custom gateway, etc.). The hook allowlist only checks that the tool prefix matches **`catalogs[].mcp_server`** or **`data_sources[].mcp_server`**—those strings must equal the **server name** in your Claude Code MCP configuration.

Recommended mental model:

1. **Environment / hydrate DB (5433)** — Used by `AGENTLAB_PG_DSN` and the Go CLI. You typically **do not** expose this through MCP unless you want tools to edit registration rows.
2. **Datalake MCP** — Points at your warehouse Postgres (or other backend); register its server name under **`data_sources[].mcp_server`**.
3. **Catalog MCP with pgvector** — Point a **Postgres-capable MCP** at **`postgres-pgvector`** (`127.0.0.1:5434`, DB `agentlab_vectors`). Choose a short server id in Claude config (example: **`postgres-pgvector-catalog`**) and use **that exact string** in `catalogs[].mcp_server` (and/or in the hydrate table `agentlab_catalogs.mcp_server`).

If you run a **custom multi-DB gateway MCP**, register **one** MCP server in Claude with whatever name you chose; put **that name** in `context.json` / Postgres registrations—there is no fixed “gateway” product name in AgentLab.

## Quick start

1. Start both Postgres services (repo root):

   ```bash
   docker compose up -d
   ```

   Hydrate / registration DSN (environment DB only):

   ```text
   postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment
   ```

2. Set DSN:

   ```bash
   export AGENTLAB_PG_DSN='postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment'
   ```

3. **Baseline registrations:** `docker compose` runs [`infra/postgres/init/002_seed_dev_optional.sql`](../infra/postgres/init/002_seed_dev_optional.sql) on first DB init—it inserts **`postgres-environment`** (datalake) and **`postgres-pgvector-catalog`** (catalog), matching [`docs/claude-mcp-postgres.md`](claude-mcp-postgres.md). **`docker compose down -v`** and **`up`** re-applies init (wiping data). Add your own rows with SQL as needed:

   ```sql
   INSERT INTO agentlab_data_sources (registration_id, exec_paradigm, mcp_server, purpose, tags)
   VALUES ('warehouse', 'sql', 'postgres-dev', 'Main warehouse', ARRAY['readonly']);

   INSERT INTO agentlab_catalogs (registration_id, retrieval, mcp_server, scope, purpose, tags)
   VALUES ('glossary', 'vector', 'postgres-pgvector-catalog', 'docs', 'pgvector embeddings', ARRAY[]::text[]);
   ```

4. Optionally ensure `.agentlab/context.json` exists; if absent, pass **`--template`** on hydrate (see step 5) so hydrate creates it from [`templates/context.init.json`](../templates/context.init.json) before merging DB rows.

5. Build and run hydrate (`--template` is required only when **`context.json` does not exist** yet):

   ```bash
   cd tools/agentlab-provider
   go build -o agentlab-provider ./cmd/agentlab-provider
   export AGENTLAB_PG_DSN='postgresql://…'
   # When context.json already exists:
   ./agentlab-provider hydrate --project-dir /path/to/your/project
   # First run (no context.json yet) — path is your checkout of this repo:
   ./agentlab-provider hydrate --project-dir /path/to/your/project \
     --template /path/to/superagents/templates/context.init.json
   ```

   Preview without writing:

   ```bash
   ./agentlab-provider hydrate --project-dir /path/to/your/project --dry-run \
     --template /path/to/superagents/templates/context.init.json
   ```

6. Check DB connectivity:

   ```bash
   ./agentlab-provider ping
   ```

## Column → JSON mapping

### `agentlab_data_sources` → `data_sources[]`

| Column | JSON field |
|--------|------------|
| `registration_id` | `id` |
| (constant) | `kind` = `"datalake"` |
| `exec_paradigm` | `exec_paradigm` |
| `mcp_server` | `mcp_server` |
| `purpose` | `purpose` |
| `tags` | `tags` |
| `schema_summary` | `schema_summary` (object), omitted if null |

`schema_summary` must satisfy `#/$defs/schemaSummary` in the context schema when present.

### `agentlab_catalogs` → `catalogs[]`

| Column | JSON field |
|--------|------------|
| `registration_id` | `id` |
| (constant) | `kind` = `"catalog"` |
| `retrieval` | `retrieval`, omitted if null or empty |
| `mcp_server` | `mcp_server` |
| `scope` | `scope`, omitted if null or empty |
| `purpose` | `purpose` |
| `tags` | `tags` |

## Claude Code `SessionStart` hook

[`hooks/hooks.json`](../hooks/hooks.json) runs [`hooks/scripts/session-hydrate.sh`](../hooks/scripts/session-hydrate.sh) on **`startup`** and **`resume`**.

- **Session registry:** After hydrate, the script pipes the **hook JSON on stdin** to **`agentlab-provider session-record`**, which **upserts** a row into **`agentlab_sessions`** (same Postgres as hydrate). Payload includes **`session_id`**, **`source`** (`startup`, `resume`, `clear`, `compact`), **`cwd`**, **`transcript_path`**, **`model`**, optional **`agent_type`**, plus a **`hook_payload`** JSONB snapshot. See Claude’s [SessionStart input](https://docs.anthropic.com/en/docs/claude-code/hooks#sessionstart). If **`session-record` fails**, stderr logs **non-fatal** and Claude still starts (**`hydrate` exit code** is still respected as the hook exit status).
- **Scaffold:** the script creates **`$CLAUDE_PROJECT_DIR/.agentlab/artifacts/`** (queries, results, scripts, models, reports, plans, critiques, visualizations), **`snapshots/`**, before calling hydrate—so hydrate can create **`context.json`** on first run without the AgentLab skill.
- **`context.json` present:** hydrate **merges Postgres into `data_sources[]` / `catalogs[]`** and **dedupes + sorts** those two arrays only.
- **`context.json` absent:** hydrate seeds from **`templates/context.init.json`**. The hook resolves `--template` in order: **`AGENTLAB_CONTEXT_TEMPLATE`** (must exist when set), else **`${CLAUDE_PLUGIN_ROOT}/templates/context.init.json`**, else this repo relative to [`session-hydrate.sh`](../hooks/scripts/session-hydrate.sh). If no template path exists and `context.json` is missing, hydrate fails loudly (needs a plugin checkout or **`AGENTLAB_CONTEXT_TEMPLATE`**).
- **Fail-open:** if `AGENTLAB_PG_DSN` is unset, or the `agentlab-provider` binary cannot be found, the script exits **0** and logs one line to stderr so Claude still starts.
- **Binary resolution:** set **`AGENTLAB_PROVIDER_BIN`** to the built executable (legacy: **`AGENTLAB_ENV_BIN`** is still honored by the hook), or place the binary at **`tools/agentlab-provider/agentlab-provider`** inside the plugin/repo checkout, or install `agentlab-provider` on `PATH`.
- The hook reads **stdin once** into **`hook_json`**. **`CLAUDE_PROJECT_DIR`** wins for the workspace root; otherwise **`cwd`** from the JSON (**`jq`**) selects **`project-dir`** for both hydrate and **`session-record`**. [`agentlab_sessions`](../infra/postgres/init/003_sessions.sql) is created only when init scripts run (**new volume**); existing DBs should apply **`003_sessions.sql`** manually (below).
- **Debug:** set **`AGENTLAB_HYDRATE_DEBUG=1`** in the environment that **launches** Claude Code (same process tree as hooks). The hook then prints **`agentlab session-hydrate[debug]: …`** lines to **stderr** for each step (DSN, binary path, `CLAUDE_PROJECT_DIR`, template, command). On success, hydrate itself is still quiet aside from those debug lines.

### Troubleshooting: “hydrate never seems to run”

1. **Successful hydrate is silent.** If you are not skipping, the hook does not print “success.” Check whether **`.agentlab/context.json`** **`data_sources`** / **`catalogs`** match Postgres (`SELECT * FROM agentlab_data_sources`) or touch the file mtime after **`docker compose up`** + session start.

2. **Plugin hooks only run if the AgentLab plugin is enabled** and loaded. In Claude Code: **`/plugin`** → **Installed** → ensure **agentlab** is on; open the **Errors** tab for hook/load failures (bad path, timeout, etc.).

3. **`AGENTLAB_PG_DSN`** must be set **where Claude Code runs** (GUI app often does **not** inherit your terminal `export`). Fix: set the variable in the **parent environment** of the Claude Code app, or use your OS launcher / `claude` CLI from a shell where it is exported—see [Claude Code environment / settings](https://code.claude.com/docs).

4. **`agentlab-provider` must exist** where the hook looks: **`AGENTLAB_PROVIDER_BIN`**, or **`$CLAUDE_PLUGIN_ROOT/tools/agentlab-provider/agentlab-provider`**, or **`PATH`**. Build: `cd tools/agentlab-provider && go build -o agentlab-provider ./cmd/agentlab-provider`.

5. **`CLAUDE_PROJECT_DIR` must be set** (or hook stdin must include **`cwd`** and **`jq`** must be installed for the fallback). If both are missing, stderr shows: **`CLAUDE_PROJECT_DIR unset and hook cwd missing; skipping hydrate.`**

6. **Reproduce without Claude** (same vars as the hook):

   ```bash
   export AGENTLAB_PG_DSN='postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment'
   export CLAUDE_PLUGIN_ROOT=/path/to/plugin-or-repo-with-.claude-plugin
   export AGENTLAB_HYDRATE_DEBUG=1
   export CLAUDE_PROJECT_DIR=/path/to/workspace-with-or-without-.agentlab   # required for manual shell runs
   bash "$CLAUDE_PLUGIN_ROOT/hooks/scripts/session-hydrate.sh" <<'EOF'
   {"session_id":"dev","cwd":"/path/to/project","hook_event_name":"SessionStart","source":"startup"}
   EOF
   ```

   Omitting **`CLAUDE_PROJECT_DIR`** without synthetic stdin leaves **hook JSON empty**—hydrate may still run if you set **`CLAUDE_PROJECT_DIR`**, but **`session-record`** is skipped until real SessionStart stdin is supplied.

7. **Hook path uses `${CLAUDE_PLUGIN_ROOT}`.** That is set by Claude Code for **plugin-managed** hooks. If you only use project hooks, **`CLAUDE_PLUGIN_ROOT`** may differ or be unset—point **`AGENTLAB_PROVIDER_BIN`** at a built binary and ensure **`CLAUDE_PROJECT_DIR`** is set.

8. **`connect: connection refused` on `127.0.0.1:5433`:** Postgres must listen on the **host**. Run `docker ps --format 'table {{.Names}}\t{{.Ports}}'` — you need **`0.0.0.0:5433->5432/tcp`** (or similar) on **`agentlab-environment-postgres`**. If you only see **`5432/tcp`** with no published port, Compose did not bind the port (wrong compose file, or containers started with plain **`docker run`** without **`-p`**) — bring the stack down and up from repo root per [`docker-compose.yml`](../docker-compose.yml).

9. **`context.json` never gains rows but “data is in Postgres”:** Registrations live only on **`agentlab_environment`** (Compose **5433**), in tables **`agentlab_data_sources`** / **`agentlab_catalogs`**. The **pgvector** DB on **5434** (`agentlab_vectors`) does **not** contain those tables—pointing **`AGENTLAB_PG_DSN`** there yields **zero rows** and a silent-looking no-op merge. Confirm with psql:

   ```bash
   psql 'postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment' \
     -c 'SELECT COUNT(*) FROM agentlab_data_sources; SELECT COUNT(*) FROM agentlab_catalogs;'
   ```

   Rebuild **`agentlab-provider`** after pulling changes (`go build ...`). Run with **`AGENTLAB_HYDRATE_DEBUG=1`** to print row counts merged from Postgres and final **`data_sources`** / **`catalogs`** lengths in **`context.json`**.

10. **`relation "agentlab_sessions" does not exist`:** Init scripts run **only on first Postgres volume creation**. Existing volumes need the DDL applied once:

   ```bash
   psql "$AGENTLAB_PG_DSN" -v ON_ERROR_STOP=1 -f infra/postgres/init/003_sessions.sql
   ```

### Session registry DDL

[`infra/postgres/init/003_sessions.sql`](../infra/postgres/init/003_sessions.sql) defines **`agentlab_sessions`**. Inspect rows:

```bash
psql "$AGENTLAB_PG_DSN" -c 'SELECT session_id, session_source, project_dir, updated_at FROM agentlab_sessions ORDER BY updated_at DESC LIMIT 10;'
```

Manual **`session-record`** (stdin must be SessionStart-shaped JSON):

```bash
printf '%s\n' '{"session_id":"test","cwd":"/tmp","hook_event_name":"SessionStart","source":"startup","model":"claude-sonnet"}' \
  | ./tools/agentlab-provider/agentlab-provider session-record --project-dir /tmp
```

## Validation

Strict validation against `schemas/context.schema.json` is not embedded in the binary in v1. After hydrate, you can validate manually:

```bash
jsonschema -i .agentlab/context.json schemas/context.schema.json
```

## Files

| Path | Role |
|------|------|
| [`docker-compose.yml`](../docker-compose.yml) | Environment Postgres + pgvector |
| [`docs/claude-mcp-postgres.md`](claude-mcp-postgres.md) | `claude mcp add` + [`tools/mcp-postgres-environment.sh`](../tools/mcp-postgres-environment.sh) / [`tools/mcp-postgres-pgvector-catalog.sh`](../tools/mcp-postgres-pgvector-catalog.sh) |
| [`infra/postgres/init/001_environment_schema.sql`](../infra/postgres/init/001_environment_schema.sql) | Registration DDL |
| [`infra/postgres/init/003_sessions.sql`](../infra/postgres/init/003_sessions.sql) | SessionStart registry (`agentlab_sessions`) |
| [`infra/postgres-pgvector/init/001_enable_vector.sql`](../infra/postgres-pgvector/init/001_enable_vector.sql) | `CREATE EXTENSION vector` |
| [`tools/agentlab-provider/`](../tools/agentlab-provider/) | Go CLI (`urfave/cli/v2`, `pgx`) |
