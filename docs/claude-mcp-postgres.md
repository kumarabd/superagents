# Claude Code: Postgres MCP for Docker Compose DBs

**You do not add MCP to `docker-compose.yml`.** Compose only runs Postgres. On the machine where **Claude Code** runs, use **`claude mcp add`** with a connection string to the published ports **5433** and **5434** on `127.0.0.1` (or use `docker run` below if you have no local Node).

| Database | Host port | DB name | Typical `mcp_server` id in `context.json` |
|----------|-----------|---------|---------------------------------------------|
| Registrations / hydrate | **5433** | `agentlab_environment` | `postgres-environment` |
| pgvector catalog | **5434** | `agentlab_vectors` | `postgres-pgvector-catalog` |

Server **names** must match **`data_sources[].mcp_server`** and **`catalogs[].mcp_server`** exactly (hooks allowlist).

Package: **`@modelcontextprotocol/server-postgres`** (read-only SQL + schema inspection).

Prerequisites:

- `docker compose up -d` from this repo so both databases listen on localhost.
- **Node.js 20+** for **`npx`** when using the repo scripts (they load **nvm** if present). See [Troubleshooting](#troubleshooting).
- Named Docker network **`agentlab`** exists only if you need **`docker run`** ([Option B](#optional-docker-run-no-node-on-host)).

---

## Recommended: launcher scripts + `claude mcp add`

Repo scripts under **`tools/`** source **nvm** (when **`~/.nvm/nvm.sh`** exists), run **`nvm use`** (default **22**), then **`exec npx @modelcontextprotocol/server-postgres …`**. Claude only needs to spawn a single executable path.

From the **datascientist** repo root (use **absolute paths** so Claude Code finds them from any cwd):

```bash
REPO="$(pwd)"   # or: REPO="$HOME/Documents/datascientist"

claude mcp add --transport stdio --scope user postgres-environment -- \
  "${REPO}/tools/mcp-postgres-environment.sh"

claude mcp add --transport stdio --scope user postgres-pgvector-catalog -- \
  "${REPO}/tools/mcp-postgres-pgvector-catalog.sh"
```

**Optional env overrides** (same for both scripts):

| Variable | Default |
|----------|---------|
| `NVM_DIR` | `$HOME/.nvm` |
| `AGENTLAB_NODE_VERSION` | `22` |
| `AGENTLAB_ENVIRONMENT_PG_URL` | URL for port **5433** / `agentlab_environment` |
| `AGENTLAB_PGVECTOR_PG_URL` | URL for port **5434** / `agentlab_vectors` |

You can pass env through Claude’s MCP config if your client supports **`env`** on stdio servers; otherwise export them in the shell before starting Claude Code, or edit the scripts locally.

**Project scope** (`.mcp.json` in one repo): use **`--scope project`** instead of **`user`**.

---

## Alternative: inline `bash -lc` + `npx`

Useful if you do not want to depend on repo paths. Claude Code often launches MCP **without** your interactive shell, so **`nvm use`** inside **`bash -lc`** avoids an old default Node breaking **`npx`** (change **`22`** as needed).

```bash
claude mcp add --transport stdio --scope user postgres-environment -- \
  bash -lc 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 --silent && exec npx -y @modelcontextprotocol/server-postgres "postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment"'

claude mcp add --transport stdio --scope user postgres-pgvector-catalog -- \
  bash -lc 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 --silent && exec npx -y @modelcontextprotocol/server-postgres "postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5434/agentlab_vectors"'
```

**Plain `npx` only** when **`node -v`** is already **18+** in a non-login environment:

```bash
claude mcp add --transport stdio --scope user postgres-environment -- \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment"

claude mcp add --transport stdio --scope user postgres-pgvector-catalog -- \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5434/agentlab_vectors"
```

Verify:

```bash
claude mcp list
claude mcp get postgres-environment
claude mcp get postgres-pgvector-catalog
```

---

## Optional: `docker run` (no Node on host)

Claude still runs **`claude mcp add`**, but the command is **`docker run`** so Node runs inside a container. Use Compose’s **`agentlab`** network so hostnames **`postgres-environment`** / **`postgres-pgvector`** resolve.

```bash
claude mcp add --transport stdio --scope user postgres-environment -- \
  docker run -i --rm --network agentlab \
  node:22-bookworm-slim \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://agentlab:agentlab_local_change_me@postgres-environment:5432/agentlab_environment"

claude mcp add --transport stdio --scope user postgres-pgvector-catalog -- \
  docker run -i --rm --network agentlab \
  node:22-bookworm-slim \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://agentlab:agentlab_local_change_me@postgres-pgvector:5432/agentlab_vectors"
```

Requires **`docker compose up -d`** first (DBs + network **`agentlab`**).

---

## Troubleshooting

### Postgres MCP shows “Failed to connect” but `docker compose` is up

1. **Check Node / `npx` version** (must be 18+; prefer **20 LTS**):

   ```bash
   node -v
   which npx
   ```

   If you use **nvm** and see **v11** (or anything below 18), upgrade and make it default, then **restart Claude Code**:

   ```bash
   nvm install 22
   nvm alias default 22
   hash -r
   node -v   # should show v22.x
   ```

   Quick sanity check (should print JSON-RPC, not npm errors). From repo root, pipe **`initialize`** into the launcher:

   ```bash
   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
     | ./tools/mcp-postgres-environment.sh
   ```

   Or mimic a bare environment with **`bash -lc`**:

   ```bash
   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
     | bash -lc 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && . "$NVM_DIR/nvm.sh" && nvm use 22 --silent && exec npx -y @modelcontextprotocol/server-postgres "postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment"'
   ```

2. **Remove broken MCP entries and re-add** after Node is fixed:

   ```bash
   claude mcp remove postgres-environment
   claude mcp remove postgres-pgvector-catalog
   ```

   Then run **`claude mcp add`** again using the **`tools/mcp-*.sh`** launchers (or **`docker run`**).

3. **SSL errors** (less common on localhost): append **`?sslmode=disable`** to the connection URL in `claude mcp add`.

### `plugin:…:memory` fails while `memory` works

You likely have **two** configs pointing at the same script; one uses a bad path (e.g. **`memory-superagents//`** with a double slash). Disable or fix the **plugin-scoped** MCP in that plugin’s settings and keep the entry that already shows **Connected**, or normalize the path to a single `/`.

---

## Security

- Change passwords for anything beyond local dev.
- `@modelcontextprotocol/server-postgres` is **read-only**; datalakes that need writes still require your governance flow (`writable` tag + consent where applicable).

## Related

- [`environment-hydrate.md`](environment-hydrate.md) — hydrate CLI uses port **5433** only.
- [`tools/mcp-postgres-environment.sh`](../tools/mcp-postgres-environment.sh), [`tools/mcp-postgres-pgvector-catalog.sh`](../tools/mcp-postgres-pgvector-catalog.sh) — MCP launchers.
- [Claude Code MCP docs](https://docs.claude.com/en/docs/claude-code/mcp.md) — `claude mcp add --transport stdio … -- <command>`.
