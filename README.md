# AgentLab — Agentic Analytics Lab

AgentLab is a **Claude Code plugin** (and Cursor-friendly skill files) for **agentic analytics** over your connected data systems.

It answers analytical questions by coordinating capability-tagged specialist agents over:

- **Datalakes (execute)**: Postgres / BigQuery / Prometheus / Mongo / logs / graph DBs — exposed via MCP
- **Catalogs (retrieve meaning)**: dbt docs, wikis, glossaries, vector stores — exposed via MCP

### Core principle

> **LLM thinks in queries. The datalake thinks in rows.**

AgentLab writes queries/code, executes them via MCP, and only brings back **bounded** results for interpretation. Every executed query is saved as an artifact for reproducibility.

### Design doc

See `docs/specs/2026-05-08-agentlab-analytics-design.md`.

**GitHub repo:** [https://github.com/kumarabd/superagents](https://github.com/kumarabd/superagents)

---

## Features

- **Multi-agent workflow**: plan → (optional) semantic grounding → query execution → (optional) methods → narrative → (optional) critique
- **Per-workspace registrations**: `.agentlab/context.json` stores **datalake + catalog** MCP allowlist only (`schemas/context.schema.json`)
- **Notebook memory (external)**: findings, hypotheses, preferences, artifact index, … live in the **memory adapter** — MCP **`notebook.load`** / **`notebook.patch`** (`schemas/notebook.schema.json`); see memory-superagents plugin
- **Reproducible artifacts**: `.agentlab/artifacts/queries/`, `reports/`, `visualizations/`, `critiques/`, …
- **Token-efficient handoffs**: downstream agents consume **artifact paths + tiny JSON summaries** instead of large tables
- **Script-first analytics (optional)**: for heavy compute, `methods` can generate a Python script artifact and execute it in a Python sandbox MCP backend
- **Governance**:
  - Human-readable policies: `policies/access.md`, `policies/pii.md`
  - Claude Code hook enforcement at tool-call boundary: `hooks/scripts/policy-check.sh`

---

## Getting started (Claude Code)

This is the **minimal path**: install the plugin, bring up local Postgres with Docker Compose, export env vars for **hydrate + hooks**, register the two Postgres MCP servers, then bootstrap the notebook in each workspace.

### Prerequisites

- Claude Code installed and authenticated ([install](https://code.claude.com/docs))
- **[Git clone of this repo](#2-local-data-plane-docker-compose)** on disk (Compose file, MCP launcher scripts under `tools/`, SQL init). The plugin alone does **not** run Postgres for you — clone [https://github.com/kumarabd/superagents](https://github.com/kumarabd/superagents) for **`docker compose`** and MCP helper scripts.
- **Node.js 20+** (or **nvm**) if you use the repo MCP scripts — they invoke `npx @modelcontextprotocol/server-postgres`.

---

### 1. Install the AgentLab plugin from GitHub

Register the marketplace from the public repo, then install the **`agentlab`** plugin. See [discover plugins](https://code.claude.com/docs/en/discover-plugins) and the [plugins CLI](https://code.claude.com/docs/en/plugins-reference).

**In Claude Code** (slash commands):

```text
/plugin marketplace add https://github.com/kumarabd/superagents.git
/plugin install agentlab@superagents
/reload-plugins
```

**From a terminal:**

```bash
claude plugin marketplace add https://github.com/kumarabd/superagents.git
claude plugin install agentlab@superagents --scope user
```

The marketplace **`name`** in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) is **`superagents`**; the plugin id is **`agentlab`**, so the install selector is **`agentlab@superagents`**.

**Shorthand:** if your Claude build supports org/repo shortcuts, **`kumarabd/superagents`** may work the same as the **`https://github.com/kumarabd/superagents.git`** URL for **`marketplace add`**.

Use **`user`**, **`project`**, or **`local`** scope depending on whether the plugin should apply globally, per committed project config, or a single checkout.

**Developers:** install from a local clone without going through the GitHub marketplace cache:

```bash
git clone https://github.com/kumarabd/superagents.git
cd superagents
claude plugin install "$(pwd)" --scope local
```

**One-off / dev:**

```bash
claude --plugin-dir "$(pwd)"
```

#### Hook hydration + binary location

Session start runs **`hooks/scripts/session-hydrate.sh`**, which calls **`agentlab-provider`** (`hydrate` + **`session-record`**) when **`AGENTLAB_PG_DSN`** is set. Claude resolves the hook from an **installed copy** under **`~/.claude/plugins/cache/`** (example: **`…/superagents/agentlab/<version>/`**), **not** from `plugins/marketplaces/…`.

- If hydrate logs **`agentlab-provider not found`**, either place a built binary at **`tools/agentlab-provider/agentlab-provider`** inside that **cache** tree, **or** set **`AGENTLAB_PROVIDER_BIN`** to an **absolute path** to your built binary.

Build once (from repo):

```bash
cd tools/agentlab-provider && go build -o agentlab-provider ./cmd/agentlab-provider
```

Desktop/GUI Claude often does **not** inherit shell-only `export`s — set **`AGENTLAB_PG_DSN`** / **`AGENTLAB_PROVIDER_BIN`** the same way you inject env for GUI apps on your OS, **or** launch **`claude` from a shell** where those vars are set.

Debugging: **`AGENTLAB_HYDRATE_DEBUG=1`**, **`claude --debug-file /tmp/claude.log`**, and see [Claude hooks debugging](https://docs.claude.com/en/docs/claude-code/hooks-guide#limitations-and-troubleshooting).

---

### 2. Local data plane (Docker Compose)

From the **cloned repo root** (where **`docker-compose.yml`** lives):

```bash
docker compose up -d
```

Confirm host ports (**required** for `127.0.0.1` MCP + hydrate):

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

You should see **`0.0.0.0:5433`** → environment DB (**`agentlab_environment`**) and **`0.0.0.0:5434`** → pgvector DB (**`agentlab_vectors`**). Hydration and **`AGENTLAB_PG_DSN` always target 5433** — not 5434.

Default credentials (change for non-local use) match [`docker-compose.yml`](docker-compose.yml): user **`agentlab`**, password **`agentlab_local_change_me`**.

**First-time DB init** runs SQL under **`infra/postgres/init/`** (registrations + **`agentlab_sessions`**). If you **`docker compose down -v`** and **`up`** again, data is recreated from init scripts.

---

### 3. Environment variables

| Variable | Purpose |
|----------|---------|
| **`AGENTLAB_PG_DSN`** | **Required** for automatic hydrate + `session-record`. Example: `postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment` |
| **`AGENTLAB_PROVIDER_BIN`** | Optional. Absolute path to **`agentlab-provider`** if the plugin cache copy is missing or not executable |
| **`AGENTLAB_HYDRATE_DEBUG`** | Set to **`1`** for verbose hook stderr |
| **`AGENTLAB_ENVIRONMENT_PG_URL`** / **`AGENTLAB_PGVECTOR_PG_URL`** | Optional overrides for the MCP launcher scripts (defaults match Compose) |

MCP launchers: [`tools/mcp-postgres-environment.sh`](tools/mcp-postgres-environment.sh), [`tools/mcp-postgres-pgvector-catalog.sh`](tools/mcp-postgres-pgvector-catalog.sh).

Manual connectivity check (after `go build`):

```bash
export AGENTLAB_PG_DSN='postgresql://agentlab:agentlab_local_change_me@127.0.0.1:5433/agentlab_environment'
./tools/agentlab-provider/agentlab-provider ping
```

---

### 4. Register Postgres MCP servers in Claude Code

Compose only runs databases. On the machine where **Claude Code** runs, register **stdio** MCP entries with **`claude mcp add`** using **absolute paths** to **this repo’s** `tools/mcp-*.sh` (paths must exist when Claude spawns the server — your debug log will show **`ENOENT`** if they point at another project).

```bash
REPO="/absolute/path/to/superagents"   # your clone

claude mcp add --transport stdio --scope user postgres-environment -- \
  "${REPO}/tools/mcp-postgres-environment.sh"

claude mcp add --transport stdio --scope user postgres-pgvector-catalog -- \
  "${REPO}/tools/mcp-postgres-pgvector-catalog.sh"
```

Verify:

```bash
claude mcp list
claude mcp get postgres-environment
```

Server **names** (`postgres-environment`, `postgres-pgvector-catalog`) must match **`data_sources[].mcp_server`** and **`catalogs[].mcp_server`** (seed data and hydrate map to these IDs). Inline `npx`, **nvm**/Node troubleshooting, and **docker run** alternatives: **[`docs/claude-mcp-postgres.md`](docs/claude-mcp-postgres.md)**.

---

### 5. Hydrate, sessions, and the notebook

- **Registers + allowlist:** Rows in **`agentlab_data_sources`** / **`agentlab_catalogs`** merge into **`.agentlab/context.json`** on **`hydrate`** (startup/resume **`SessionStart`** hook or manual CLI). [**`docs/environment-hydrate.md`**](docs/environment-hydrate.md) covers merge semantics, SQL, and `003_sessions`/migrations.

- **Session rows:** Claude’s **`session_id`** from the **`SessionStart`** payload is **`session-record`**’d into **`agentlab_sessions`** (no separate UUID minted).

- **Notebook (“memory”):** Episodic / semantic / preferences data is **not** in `context.json`. Install **[claude-memory](https://github.com/kumarabd/memory-superagents)** from GitHub (`/plugin marketplace add https://github.com/kumarabd/memory-superagents.git`, then `claude-memory@claude-memory`) and use **`notebook.load`** / **`notebook.patch`** with the workspace absolute path as `project`. Shape: [**`schemas/notebook.schema.json`**](schemas/notebook.schema.json). Conceptual mapping: [**`docs/context-and-memory.md`**](docs/context-and-memory.md).

- **PII hook strictness:** `context.json` no longer holds `preferences`. For `PreToolUse` PII heuristics, set **`AGENTLAB_PII_STRICTNESS`** (`strict` \| `default` \| `lenient`) where Claude Code launches, or rely on the default. See [`hooks/README.md`](hooks/README.md).

- **Other MCP memory plugins** (e.g. cross-project `memory.*` events) are separate — do **not** confuse their **`DATABASE_URL`** with **`AGENTLAB_PG_DSN`** (**5433** / **`agentlab_environment`** for AgentLab hydrate only).

---

### 6. Bootstrap each workspace

Open Claude Code **in** the repo or project directory, then:

```text
/agentlab:agentlab
```

Manually registering extra backends (names must match Claude MCP config):

```text
/agentlab:agentlab
Register these sources:
- datalake id=pg_main, paradigm=sql, mcp_server=postgres-prod, tags=[warehouse]
- catalog id=glossary, retrieval=vector, mcp_server=postgres-pgvector-catalog (Postgres MCP → pgvector DB on port 5434), tags=[semantics]
```

**`PreToolUse`** hooks deny MCP calls to servers **not** listed under **`context.json`** registrations (see [Governance](#governance-pii--access)).

### Notebook explorer (UI)

Notebook explorer: [`tools/agentlab-context-explorer/README.md`](tools/agentlab-context-explorer/README.md) — open `index.html` or run **`serve.cjs`** with `NOTEBOOK_DATABASE_URL` + `npm install --prefix tools/agentlab-context-explorer` to auto-merge **`/api/merged`** (disk `context.json` + DB `notebook.load` parity).

---

## Usage examples

### Grounded metric question

```text
/agentlab:agentlab
What is our weekly active users trend over the last 8 weeks? Break down by platform.
```

### Hypothesis-shaped prompt

```text
/agentlab:agentlab
I think conversion dropped after last release. Can you validate and explain why?
```

---

## Outputs (what gets created in your project)

```
<your-project>/
└── .agentlab/
    ├── context.json
    ├── snapshots/
    └── artifacts/
        ├── plans/
        ├── queries/
        ├── results/
        ├── scripts/
        ├── models/
        ├── reports/
        ├── critiques/
        └── visualizations/
```

Notebook schema + templates:

- `schemas/context.schema.json` (registrations file)
- `schemas/notebook.schema.json` (memory adapter payload)
- `templates/context.init.json` (slim `context.json` seed)

---

## Governance (PII + access)

- **Policies**: `policies/access.md`, `policies/pii.md`
- **Hook enforcement**: `hooks/hooks.json` runs `hooks/scripts/policy-check.sh` on `mcp__.*` tool calls
  - allowlist: MCP server must be registered in `.agentlab/context.json`
  - write-class: blocks INSERT/UPDATE/DELETE/etc. unless writable + fresh `.agentlab/.consent_token`
  - PII heuristic: blocks obvious PII field projections unless `preferences.pii_strictness = "lenient"`

Hook smoke tests are in `hooks/README.md`.

---

## Cursor usage

Cursor includes a pointer skill at `.cursor/skills/agentlab/SKILL.md` which points to the canonical team brief at `skills/agentlab/SKILL.md`. You can follow the same workflow manually in a single chat, but Claude Code is recommended for true subagent isolation + hook enforcement.

---

## Repository layout

- `.claude-plugin/`: `plugin.json` + `marketplace.json` so Claude Code can install via **`/plugin marketplace add https://github.com/kumarabd/superagents.git`**
- `tools/agentlab-provider/`: Go CLI (`hydrate`, **`session-record`**, `ping`) backed by the environment Postgres on **5433**
- `skills/agentlab/SKILL.md`: orchestrator policy (manager loop, dispatch rules)
- `agents/*.md`: specialist agents (frontmatter + full playbooks)
- `schemas/`, `templates/`: engagement **registrations** schema + seed (`context.schema.json`); **notebook** payload schema (`notebook.schema.json`) for the memory adapter
- `memory/`: memory schemas
- `policies/`: access + PII policies
- `hooks/`: Claude Code hook enforcement

