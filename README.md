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
- **Per-workspace notebook**: `.agentlab/context.json` stores registrations, preferences, hypotheses, findings, and artifact index
- **Reproducible artifacts**: `.agentlab/artifacts/queries/`, `reports/`, `visualizations/`, `critiques/`, …
- **Token-efficient handoffs**: downstream agents consume **artifact paths + tiny JSON summaries** instead of large tables
- **Script-first analytics (optional)**: for heavy compute, `methods` can generate a Python script artifact and execute it in a Python sandbox MCP backend
- **Governance**:
  - Human-readable policies: `policies/access.md`, `policies/pii.md`
  - Claude Code hook enforcement at tool-call boundary: `hooks/scripts/policy-check.sh`

---

## Getting started (Claude Code)

### Prerequisites

- Claude Code installed and authenticated
- At least one MCP **datalake** connected in your Claude Code session
- Optional but recommended: an MCP **catalog** (glossary / dbt docs / wiki / vector retrieval)
- Optional (recommended for heavy analytics): an MCP **Python sandbox** backend (Dockerized sandbox is a common approach)

### Install the plugin (from GitHub, recommended)

Claude Code can treat this repo as a **marketplace**. Add it once, then install **AgentLab** like any catalog plugin.

Inside Claude Code, run ([discover-plugins](https://code.claude.com/docs/en/discover-plugins)):

```text
/plugin marketplace add kumarabd/superagents
/plugin install agentlab@superagents
/reload-plugins
```

Or from a terminal ([plugins reference — CLI](https://code.claude.com/docs/en/plugins-reference)):

```bash
claude plugin marketplace add kumarabd/superagents
claude plugin install agentlab@superagents --scope user
```

Equivalent Git URL forms also work:

```bash
claude plugin marketplace add https://github.com/kumarabd/superagents.git
```

Pick **user**, **project**, or **local** scope depending on whether you want the plugin globally, committed for the team (`--scope project`), or only for yourself in one checkout (`--scope local`).

Then open Claude Code in the **workspace** where you want `.agentlab/` bootstrapped and run:

```text
/agentlab:agentlab
```

### Install the plugin (clone + local path, developers)

Clone and install from disk (no marketplace cache):

```bash
git clone https://github.com/kumarabd/superagents.git
cd superagents
claude plugin install "$(pwd)" --scope local
```

### Try without installing (dev / one-off)

From the cloned repo root:

```bash
claude --plugin-dir "$(pwd)"
```

---

## Onboarding (register your datalake + catalog)

AgentLab must know which MCP servers it is allowed to use. Registration is stored in `.agentlab/context.json` under:

- `data_sources[]` (datalakes; execute)
- `catalogs[]` (catalogs; retrieve meaning)

Example:

```text
/agentlab:agentlab
Register these sources:
- datalake id=pg_main, paradigm=sql, mcp_server=postgres-prod, tags=[warehouse]
- catalog id=glossary, retrieval=vector, mcp_server=postgres-pgvector-catalog (Postgres MCP → pgvector DB on port 5434), tags=[semantics]
```

Once registered, the hook will **deny** MCP tool calls to servers not in this allowlist.

### Optional: hydrate registrations from Postgres

For a **global** allowlist stored in PostgreSQL (same registrations for every Claude session), build `tools/agentlab-provider`, set `AGENTLAB_PG_DSN`, and run `agentlab-provider hydrate`, or rely on the **`SessionStart`** hook after `docker compose up` (the hook also **`session-record`**s Claude session metadata into **`agentlab_sessions`**). See [`docs/environment-hydrate.md`](docs/environment-hydrate.md).

### Postgres MCP (Claude Code + Docker Compose)

After `docker compose up -d`, register two Postgres MCP servers with **`claude mcp add`** pointing at **`tools/mcp-postgres-environment.sh`** and **`tools/mcp-postgres-pgvector-catalog.sh`** (or inline `npx`). Details: [`docs/claude-mcp-postgres.md`](docs/claude-mcp-postgres.md).

### Notebook explorer (UI)

Browse **environment vs memory** in `.agentlab/context.json`: [`tools/agentlab-context-explorer/README.md`](tools/agentlab-context-explorer/README.md) (open `index.html` or run `serve.cjs`).

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

Notebook schema + template:

- `schemas/context.schema.json`
- `templates/context.init.json`

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

- `.claude-plugin/`: `plugin.json` + `marketplace.json` so Claude Code can install via `/plugin marketplace add kumarabd/superagents`
- `tools/agentlab-provider/`: Go CLI (`hydrate`, **`session-record`**, `ping`) backed by the environment Postgres on **5433**
- `skills/agentlab/SKILL.md`: orchestrator policy (manager loop, dispatch rules)
- `agents/*.md`: specialist agents (frontmatter + full playbooks)
- `schemas/`, `templates/`: engagement notebook schema + seed
- `memory/`: memory schemas
- `policies/`: access + PII policies
- `hooks/`: Claude Code hook enforcement

