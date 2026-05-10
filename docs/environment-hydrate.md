# Postgres-backed global environment hydrate

AgentLab can load **datalake** and **catalog** registrations from PostgreSQL and merge them into `.agentlab/context.json`. This keeps the same contract as manual registration ([`schemas/context.schema.json`](../schemas/context.schema.json)): [`hooks/scripts/policy-check.sh`](../hooks/scripts/policy-check.sh) and the skill still read **`data_sources[]`** and **`catalogs[]`** from the file.

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

3. Insert rows (examples):

   ```sql
   INSERT INTO agentlab_data_sources (registration_id, exec_paradigm, mcp_server, purpose, tags)
   VALUES ('warehouse', 'sql', 'postgres-dev', 'Main warehouse', ARRAY['readonly']);

   INSERT INTO agentlab_catalogs (registration_id, retrieval, mcp_server, scope, purpose, tags)
   VALUES ('glossary', 'vector', 'postgres-pgvector-catalog', 'docs', 'pgvector embeddings', ARRAY[]::text[]);
   ```

4. Ensure `.agentlab/context.json` exists (bootstrap via [`templates/context.init.json`](../templates/context.init.json) if needed).

5. Build and run hydrate:

   ```bash
   cd tools/agentlab-provider
   go build -o agentlab-provider ./cmd/agentlab-provider
   export AGENTLAB_PG_DSN='postgresql://…'
   ./agentlab-provider hydrate --project-dir /path/to/your/project
   ```

   Preview without writing:

   ```bash
   ./agentlab-provider hydrate --project-dir /path/to/your/project --dry-run
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

- **Fail-open:** if `AGENTLAB_PG_DSN` is unset, or the `agentlab-provider` binary cannot be found, the script exits **0** and logs one line to stderr so Claude still starts.
- **Binary resolution:** set **`AGENTLAB_PROVIDER_BIN`** to the built executable (legacy: **`AGENTLAB_ENV_BIN`** is still honored by the hook), or place the binary at **`tools/agentlab-provider/agentlab-provider`** inside the plugin/repo checkout, or install `agentlab-provider` on `PATH`.
- Hook stdin carries Claude session fields (`session_id`, `cwd`, …); **v1 hydrate does not use them** for SQL—only **`CLAUDE_PROJECT_DIR`** (or hook `cwd`) picks the project for `context.json`.

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
