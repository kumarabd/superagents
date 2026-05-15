# AgentLab `context.json` + notebook explorer

Static viewer: **Environment** (slim `.agentlab/context.json`) vs **Memory** (notebook payload). With the dev server, **`/api/merged`** loads the file plus **`agentlab_notebook`** from Postgres (same data as MCP **`notebook.load`**).

## Open locally (no server)

1. Open `index.html` in a browser (**File → Open** or drag the file).
2. **Choose file** — pick `.agentlab/context.json` (registrations-only is fine).

Or **Paste JSON** — paste a merged document (registrations + notebook keys) if you are not using the server.

## Dev server: merged load (notebook proxy)

1. **Install the optional Postgres client** (once), from repo root:

   ```bash
   npm install --prefix tools/agentlab-context-explorer
   ```

2. **Point at the same database as the memory MCP** (table `agentlab_notebook`), then start the server from the **project root** (directory that should match `workspace_key` rows, usually `process.cwd()`):

   ```bash
   export NOTEBOOK_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/claude_memory'
   node tools/agentlab-context-explorer/serve.cjs
   ```

   `DATABASE_URL` is accepted if `NOTEBOOK_DATABASE_URL` is unset.

3. Open `http://127.0.0.1:8765/` — the UI calls **`/api/merged`**, which reads **`AGENTLAB_CONTEXT`** (default `./.agentlab/context.json`) and merges in the notebook row for **`NOTEBOOK_PROJECT`** or **`AGENTLAB_PROJECT_DIR`** or **`process.cwd()`**.

### API routes

| Route | Purpose |
|-------|---------|
| `GET /api/context` | Raw `context.json` from disk |
| `GET /api/notebook?project=/abs/path` | JSON matching MCP **`notebook.load`** (`workspace_key`, `version`, `notebook`, …) |
| `GET /api/merged?project=/abs/path` | Single JSON: registrations + notebook keys (for the explorer UI) |
| `GET /api/bootstrap` | `{ contextPath, project, notebookDatabase }` — quick health JSON |

If the `agentlab_notebook` table is missing, `/api/notebook` still returns 200 with empty notebook and `_proxy.error`; `/api/merged` fills memory tabs with defaults.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `NOTEBOOK_DATABASE_URL` / `DATABASE_URL` | Postgres DSN for `agentlab_notebook` |
| `NOTEBOOK_PROJECT` / `AGENTLAB_PROJECT_DIR` | Workspace key (defaults to `process.cwd()`) |
| `AGENTLAB_CONTEXT` | Path to `context.json` (default `./.agentlab/context.json` relative to cwd) |
| `PORT` | HTTP port (default `8765`) |

`serve.cjs` uses Node **`http`** / **`fs`** plus optional **`pg`** for the proxy.
