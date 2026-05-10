# `context.json`: registration, memory kinds, and how they relate

`.agentlab/context.json` is the **workspace engagement notebook**: one JSON file per project that mixes (1) **registrations / connection context** for MCP backends, (2) **preferences**, and (3) **persisted memory** distilled from analyst runs.

This document maps each top-level field to **datalake vs catalog context** vs **memory** (including cognitive-style buckets: episodic, semantic, procedural, reflective).

**Canonical schemas**

- Engagement notebook: `schemas/context.schema.json`
- Shared memory-shape docs (field-level): `memory/episodic.schema.json`, `memory/semantic.schema.json`, `memory/preferences.schema.json`
- Orchestration (when things are read/written): `skills/agentlab/SKILL.md`, `agents/memory.md`

---

## Vocabulary

| Term in this repo | Meaning |
|-------------------|---------|
| **Datalake context** | *Registration* rows in `data_sources[]` pointing at MCP servers that **execute** (SQL, PromQL, Cypher, etc.). Rows live **in external systems**. |
| **Catalog context** | *Registration* rows in `catalogs[]` pointing at MCP servers that **retrieve semantics** (vector search, docs, glossary). Semantic *content* usually lives outside the notebook. |
| **Notebook memory** | Fields whose values are authored or merged **by AgentLab** during engagement (answers, glossary cache, hypotheses, artifact index). |
| **Working memory** | **Not stored in `context.json`.** Whatever the manager session keeps in-chat and passes in slim **dispatch slices** for the current question. |

---

## Field-by-field: memory or context?

### System / framing

| Field | Classification | Role |
|-------|----------------|------|
| `context_version` | Neither memory nor MCP context | Bump when the notebook **shape** evolves; tooling validation. |
| `use_case` | **Hybrid** | Describes the workspace session (domain, description, timestamps). Helps route tone and framing; resembles “product mode” meta-context. |

---

### External systems (registrations — not “learned narrative memory”)

These entries **do not store your business rows or catalog snippets**. They only record **allowed MCP backends** (`id`, `mcp_server`, `exec_paradigm`/`retrieval`, `tags`, …) so hooks and orchestration stay consistent.

| Field | Classification | Separate? |
|-------|----------------|-----------|
| `data_sources[]` | **Datalake execution context** | Yes — registers **execute-capable** backends (Postgres, Prometheus, …). |
| `catalogs[]` | **Catalog retrieval context** | Yes — registers **retrieve-capable** backends (docs, vectors, glossary). |

Treat these as **connectivity allowlists**, not summaries of facts about the domain. Facts from catalogs arrive at runtime via MCP tools into the session; distilled glossaries optionally land in `term_cache`.

---

### Notebook memory fields (explicit in `agents/memory.md`)

These are **`context.json`** fields that match the librarian `memory` agent’s three canonical kinds:

#### Episodic memory (what happened, when)

| Field | Stored in schema | Produced / consumed by |
|-------|------------------|------------------------|
| `findings[]` | `finding` (`schemas/context.schema.json`) | Manager appends after `narrative` (often after optional `critic`). Each finding is roughly one **episode**: question → answer → artifact refs → timestamps; optional critic linkage. |

Documented episodic slice: `memory/episodic.schema.json` mirrors `finding` semantics.

Related but not structured “successful episodes”:

| Field | Notes |
|-------|-------|
| `open_questions[]` | Loose strings capturing unresolved prompts (e.g. critic `reject` paths), not full episodic objects. |

#### Semantic memory (stable meaning and structure in this workspace)

| Field | Role |
|-------|------|
| `term_cache` | Canonical phrase ↔ concept/resolution snippets (typically from Domain Specialist merges). Speeds grounding; skips redundant DS. |
| `concept_mapping` | Abstract concept → `{ datalake_id → expression hints }`, learned/filled by Query. |
| `hypotheses[]` | Falsifiable claims and status (`open`, `confirmed`, …) with optional evidence refs. |
| `semantic_links[]` | Lightweight edges between conceptual labels (`from` / `to` / `kind`) with optional evidence refs. |

Documented collectively in `memory/semantic.schema.json` (conceptual grouping of sibling keys).

#### Preferences memory (behavioral knobs)

| Field | Role |
|-------|------|
| `preferences` | Workspace defaults (`row_cap`, `audience`, `critic_threshold`, `tone`, chart prefs, PII strictness if set). |

Documented in `memory/preferences.schema.json`.

---

### Index and lineage (supports several memory narratives)

| Field | Classification |
|-------|----------------|
| `artifacts[]` | **Artifact index**: paths + `type` + description + timestamps. Indexes queries, scripts, reports, critiques, Vega-Lite specs, result summaries, … |
| `experiments[]` | Tracks experiment designs/results metadata (often surfaced by `methods`). Fits **semantic** + **episodic** hybrid (structured runs with artifact pointers). |

---

## Cognitive buckets: episodic, semantic, procedural, reflective

The repo intentionally names **three** librarian kinds (`episodic`, `semantic`, `preferences`). Popular cognitive labels overlap as follows inside **this** codebase.

### Episodic

**Primary**

- **`findings[]`** — definitive episode ledger for answered questions (+ optional `critic_verdict` / `critique_artifact` when the critic path ran and merged).

### Semantic

**Primary**

- **`term_cache`**, **`concept_mapping`**, **`hypotheses[]`**, **`semantic_links[]`** — distilled meaning and learned bridges for this workspace.
- **`use_case`** (when set) — stable framing of domain / purpose.

**Secondary**

- **`artifacts[]`** when indexing stable reference assets you treat as canon for the workspace.

### Procedural

There is **no top-level `procedural_memory`** array today.

“How we do repeatable work” maps to:

- **Static procedures** bundled with the plugin: `skills/*.md`, `agents/*.md`, `policies/*.md`.
- **Per-workspace procedures** emerging as reusable **artifacts**, e.g.:
  - `artifacts[]` entries with `type: "script"` (analysis scripts run in a Python sandbox)
  - recurring `query` artifacts and Vega-Lite specs under `.agentlab/artifacts/visualizations/` (referenced by `artifacts[]`).

So procedural memory is split: **immutable team playbooks** in the repo vs **replayable runnable assets** indexed from the notebook.

### Reflective

There is **no separate `reflections[]`** table.

Closest implementation:

1. **`critic` agent outputs** persisted as **`critique` artifacts**; when merged, **`findings[].critique_artifact`** points at the file and **`findings[].critic_verdict`** ∈ `pass | revise | reject`.

2. **Hypothesis updates** (`hypotheses[]` status) after critic-aligned passes.

Reflective traces are **thin by design**:

- For **`reject`**, the skill often avoids persisting a normal finding; items may land in **`open_questions`** instead.

Many findings **omit** `critic_verdict` / `critique_artifact` when the critic step was **skipped** (common for trivial single-source runs) or when the manager did not merge critic output into the finding.

---

## Quick reference diagram
