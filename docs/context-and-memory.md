# `context.json` vs notebook memory

`.agentlab/context.json` is **registrations only**: datalake and catalog MCP allowlist entries plus optional `use_case` framing. It does **not** store findings, hypotheses, preferences, or other engagement memory.

**Notebook memory** (episodic, semantic, preferences, artifact index, experiments, open questions) lives in the **memory adapter** (memory-superagents): PostgreSQL table `agentlab_notebook`, accessed via MCP tools **`notebook.load`** and **`notebook.patch`** using the workspace absolute path as `project`.

**Canonical schemas**

- Registrations file: `schemas/context.schema.json`
- Notebook payload (adapter): `schemas/notebook.schema.json`
- Field-level docs (shapes unchanged): `memory/episodic.schema.json`, `memory/semantic.schema.json`, `memory/preferences.schema.json`
- Orchestration: `skills/agentlab/SKILL.md`, `agents/memory.md`

---

## Vocabulary

| Term in this repo | Meaning |
|-------------------|---------|
| **Datalake context** | `data_sources[]` in `context.json` — MCP servers that **execute**. |
| **Catalog context** | `catalogs[]` in `context.json` — MCP servers that **retrieve semantics**. |
| **Notebook memory** | JSON payload in the adapter (`notebook.load`): findings, term_cache, hypotheses, etc. |
| **Working memory** | In-chat only; slim dispatch slices between agents. |

---

## `context.json` fields (registrations + framing)

| Field | Role |
|-------|------|
| `context_version` | Schema generation; bump when the **registrations** shape changes (v3 = slim file). |
| `use_case` | Optional workspace framing (domain, description, timestamps). |
| `data_sources[]` | Datalake allowlist (`mcp_server` must match Claude MCP config). |
| `catalogs[]` | Catalog allowlist. |

Hooks (`policy-check.sh`) read **only** this file for MCP allowlist and datalake `writable` tags. **PII strictness** is not in `context.json` anymore: set **`AGENTLAB_PII_STRICTNESS`** (`strict` \| `default` \| `lenient`) in the environment that launches Claude Code, or rely on default behavior.

---

## Notebook payload (adapter)

Same logical fields as before, now under `notebook` in **`notebook.load`** / merge keys in **`notebook.patch`**. See `schemas/notebook.schema.json`.

| Bucket | Keys in `notebook` |
|--------|---------------------|
| Episodic | `findings[]`, loosely `open_questions[]` |
| Semantic | `term_cache`, `concept_mapping`, `hypotheses[]`, `semantic_links[]` |
| Preferences | `preferences` (includes optional `pii_strictness` for documentation; hooks use env unless you duplicate for tooling) |
| Index | `artifacts[]`, `experiments[]` |

Cognitive mapping (episodic / semantic / procedural / reflective) is unchanged in meaning; only **storage location** moved from file to adapter. Procedural playbooks remain in `skills/` and `agents/`; reflective output remains critique-linked **findings** and **hypotheses** updates inside the notebook payload.

---

## Quick reference

```
context.json          →  allowlist + use_case (git-friendly, hook-local)
agentlab_notebook     →  full notebook JSON (MCP: notebook.load / notebook.patch)
.agentlab/artifacts/  →  files on disk; paths indexed in notebook.artifacts[]
```
