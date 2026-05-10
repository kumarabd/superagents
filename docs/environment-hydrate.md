# Postgres-backed global environment hydrate

AgentLab can load **datalake** and **catalog** registrations from PostgreSQL and merge them into `.agentlab/context.json`. This keeps the same contract as manual registration ([`schemas/context.schema.json`](../schemas/context.schema.json)): [`hooks/scripts/policy-check.sh`](../hooks/scripts/policy-check.sh) and the skill still read **`data_sources[]`** and **`catalogs[]`** from the file.

**Merge semantics:** hydrate **replaces** `data_sources[]` and `catalogs[]` with the rows from Postgres (authoritative DB). Other top‑level JSON keys are **preserved** when the file already exists. If **`context.json` is missing**, hydrate can **seed** from [`templates/context.init.json`](../templates/context.init.json) via **`--template`** / **`AGENTLAB_CONTEXT_TEMPLATE`**, then merge the DB fields—see `agentlab-provider hydrate --help`.

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

- **Scaffold:** the script creates **`$CLAUDE_PROJECT_DIR/.agentlab/artifacts/`** (queries, results, scripts, models, reports, plans, critiques, visualizations), **`snapshots/`**, before calling hydrate—so hydrate can create **`context.json`** on first run without the AgentLab skill.
- **`context.json` present:** hydrate merges **`data_sources[]`** / **`catalogs[]`** from Postgres into the existing file (other keys unchanged).
- **`context.json` absent:** hydrate seeds from **`templates/context.init.json`**. The hook resolves `--template` in order: **`AGENTLAB_CONTEXT_TEMPLATE`** (must exist when set), else **`${CLAUDE_PLUGIN_ROOT}/templates/context.init.json`**, else this repo relative to [`session-hydrate.sh`](../hooks/scripts/session-hydrate.sh). If no template path exists and `context.json` is missing, hydrate fails loudly (needs a plugin checkout or **`AGENTLAB_CONTEXT_TEMPLATE`**).
- **Fail-open:** if `AGENTLAB_PG_DSN` is unset, or the `agentlab-provider` binary cannot be found, the script exits **0** and logs one line to stderr so Claude still starts.
- **Binary resolution:** set **`AGENTLAB_PROVIDER_BIN`** to the built executable (legacy: **`AGENTLAB_ENV_BIN`** is still honored by the hook), or place the binary at **`tools/agentlab-provider/agentlab-provider`** inside the plugin/repo checkout, or install `agentlab-provider` on `PATH`.
- Hook stdin carries Claude session fields (`session_id`, `cwd`, …); **v1 hydrate does not use them** for SQL—only **`CLAUDE_PROJECT_DIR`** (or hook `cwd`) picks the project for `context.json`.
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
   export CLAUDE_PROJECT_DIR=/path/to/workspace-with-or-without-.agentlab
   bash "$CLAUDE_PLUGIN_ROOT/hooks/scripts/session-hydrate.sh"
   ```

7. **Hook path uses `${CLAUDE_PLUGIN_ROOT}`.** That is set by Claude Code for **plugin-managed** hooks. If you only use project hooks, **`CLAUDE_PLUGIN_ROOT`** may differ or be unset—point **`AGENTLAB_PROVIDER_BIN`** at a built binary and ensure **`CLAUDE_PROJECT_DIR`** is set.

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
| [`infra/postgres-pgvector/init/001_enable_vector.sql`](../infra/postgres-pgvector/init/001_enable_vector.sql) | `CREATE EXTENSION vector` |
| [`tools/agentlab-provider/`](../tools/agentlab-provider/) | Go CLI (`urfave/cli/v2`, `pgx`) |
