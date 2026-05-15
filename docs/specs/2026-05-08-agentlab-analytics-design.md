# AgentLab — Design Spec (Agentic Analytics Lab)

**Date:** 2026-05-08 (rev 3)
**Status:** v1 design
**Scope:** Build a Claude Code plugin (also usable as a Cursor project skill) that behaves like an **Agentic Analytics Lab** answering questions about user-connected data.

---

## Revision note (rev 3)

Major changes vs the prior draft:

- **Layered organization model** — Executive / Understanding / Execution / Communication / Meta — implemented as a **compressed roster of 8 capability-tagged agents**, not 18 one-off agents.
- **Manager = Claude Code main session.** No agent file authors orchestration; orchestration policy lives entirely in the **skill body**. Subagents return to the manager; **no peer-to-peer agent messaging** (matches Claude Code reality).
- **Critic + Reflection promoted** — `critic` agent runs after analytical answers above a complexity threshold to flag weak conclusions, sampling issues, or missing evidence.
- **Memory is structured, not vibes.** Three explicit memory shapes (episodic, semantic, preferences) live in the engagement notebook with JSON schemas.
- **Governance is enforced at the edges** (policies + hooks), not inside an agent prompt.
- **Tools / runtimes / agents are clearly separated** in vocabulary.

---

## 1. Goal

Given:

1. one or more **datalake** MCPs (Postgres, BigQuery, Prometheus, Mongo, Neo4j, log stores, …),
2. one or more **catalog** MCPs (vector DB, Confluence, dbt manifest, markdown corpus exposed via MCP),

answer any analytical question by **planning**, **grounding in catalog meaning**, **constructing executable code**, **executing via the datalake**, **interpreting bounded results**, and (when warranted) **critiquing** the conclusion before persisting.

Behave like a **team in a company**: a Chief Analytics Orchestrator (the Claude session) dispatches specialized engineers; findings, hypotheses, experiments, and learned semantics accumulate per workspace.

---

## 2. Vocabulary (locked)

| Term | Meaning |
|------|---------|
| **Skill** | The team brief + manager policy. One file: `skills/agentlab/SKILL.md`. |
| **Manager** | The Claude Code main session at runtime. Not an authored file. |
| **Agent** | One file in `agents/` — a Claude Code subagent definition. Frontmatter (`name`, `description`, `model`, `capabilities`) + body playbook. |
| **Capability** | A tag on an agent indicating what kind of work it can perform (e.g. `discovery`, `quality`, `query`, `forecasting`). Used by the manager to route work and by humans to find the right agent. |
| **Tool** | Any callable surface — usually an MCP tool method exposed by a server in the user's session. |
| **Runtime** | An external execution engine (Postgres, Trino, Spark, sandbox Python). Reached **via** a tool. |
| **Notebook** | `.agentlab/` in the user's workspace — engagement memory + artifacts. |
| **Policy** | Static markdown rule the manager and agents must respect (governance, PII, access). Lives in `policies/`. |

`agents/` contains **agents**. `policies/` contains **policies**. Tools and runtimes are **external** — never embedded.

---

## 3. Critical principle

> **LLM thinks in queries. The datalake thinks in rows.**

- Never dump large result sets into context for "thinking."
- Author **SQL, PromQL, Cypher, MQL, log DSL, or sandbox code**; execute via MCP; only **bounded** results (≤ 100 rows, or aggregates) return for interpretation.
- Save every executed query/code as an artifact under `.agentlab/artifacts/`.
- ≤ 5-row sanity samples are allowed only when validating a join or type — never `SELECT *` for exploration.

---

## 4. Setup contract

The user (or `discovery` during onboarding) registers two kinds of external resources via MCP:

- **Datalakes** — execute queries/programs over rows.
- **Catalogs** — retrieve descriptive context (vector / fts / structured).

Registrations land in `.agentlab/context.json`. No catalog content is authored by us.

---

## 5. Agent roster (v1: 8 agents, capability-tagged)

Each agent file declares `capabilities: [...]` in YAML frontmatter. The manager dispatches **by capability** (preferred) or by `name`.

| Agent | Capabilities (tags) | Purpose |
|------|---------------------|---------|
| `architect` | `planning`, `hypothesis`, `kpi-definition`, `task-decomposition` | Frame the problem; emit an analytical plan with KPIs, dimensions, and a small DAG of next steps. Generate hypotheses worth testing. |
| `discovery` | `discovery`, `profiling`, `quality`, `registration`, `freshness` | Onboard new datalakes/catalogs; profile distributions; flag quality and freshness; surface candidate semantic links (without authoring catalog). |
| `domain-specialist` | `semantics`, `glossary`, `term-resolution`, `disambiguation` | Retrieve meaning from catalog MCPs; produce a lake-agnostic markdown brief with cited evidence. |
| `query` | `query`, `sql`, `promql`, `cypher`, `mql`, `logs`, `federation` | Translate concepts into the lake's native paradigm; execute via MCP; return bounded results + saved query artifacts. |
| `methods` | `statistics`, `time-series`, `forecasting`, `anomaly-detection`, `causal`, `experimentation`, `optimization`, `ml-modeling`*  | Apply quantitative methods to bounded `query` outputs (or a sandbox MCP). Modular subsections per capability. ML/causal optional in v1. |
| `narrative` | `interpretation`, `storytelling`, `report-writing`, `visualization-spec` | Produce a written answer + report artifact; emit a **visualization spec** (Vega-Lite / chart-intent JSON) — actual rendering is left to a tool/runtime. |
| `critic` | `critique`, `reflection`, `peer-review`, `sampling-check` | Review an analytical answer for sampling bias, weak evidence, contradictions, low confidence. Emits a critique artifact + verdict (`pass`, `revise`, `reject`). |
| `memory` | `memory-read`, `memory-write`, `compaction`, `recall` | Maintain episodic / semantic / preferences memory in the notebook; serve recall queries; run compaction. |

**Capability tags as v2 splits.** Each capability listed above can later become its own agent (e.g. `forecasting` splits out of `methods`). Until then, the **same file** owns multiple capabilities; the body has clear sub-sections per capability so dispatch instructions can target one without invoking the others.

`monitor`, `experimentation` (full lifecycle), `recommendation`, `governance-advisor`, `ops` — **deferred to v2**. Governance in v1 is **policy + hooks**, not an agent.

---

## 6. Manager (skill) responsibilities

The skill body encodes:

1. **Identity & critical principle**.
2. **Capability dispatch table** (`capability → agent name`).
3. **Per-query loop** (§7) including the **critic gate**.
4. **Memory hooks** — when manager reads/writes episodic / semantic / preferences memory.
5. **Policy gates** — read `policies/*.md` on bootstrap; agents must comply.
6. **Bootstrap** — create `.agentlab/` and `context.json` from `templates/context.init.json` if missing.
7. **Out-of-scope behaviors** — refuse politely with a route to onboard or extend.

The manager **does not run as a subagent**. It is the main Claude Code thread. Loops between specialists are coordinated by the manager re-dispatching, not by agents talking to each other.

---

## 7. Per-question loop

```
User question
   ↓
[manager classifies]
   ↓
(optional) architect — plan + hypotheses + KPIs
   ↓
(optional) discovery — if data unknown / quality unclear / freshness suspect
   ↓
(optional) domain-specialist — when DS triggers fire (terms ambiguous, fuzzy time, prior disambiguation)
   ↓
query — author + execute against lake; bounded results + artifact
   ↓
(optional) methods — when stats / forecasting / causal / ML needed beyond native lake DSL
   ↓
narrative — produce answer + report artifact + visualization spec
   ↓
(optional) critic — review when complexity > threshold; verdict {pass, revise, reject}
   ↓
manager merges notebook (findings, memory updates), replies to user
```

Loops:

- `query` returns `needs_disambiguation` → manager re-dispatches `domain-specialist` once, then asks user.
- `critic` returns `revise` → manager re-dispatches the relevant agent **once** with the critique attached. `reject` → manager surfaces the issue to the user.
- All loops have a small fixed budget (default: 1 retry per stage) to keep latency bounded.

---

## 8. Domain Specialist — when to dispatch (lazy)

Dispatch `domain-specialist` if **any** holds:

- Term not in skill brief and not in `term_cache`.
- Metric / entity ambiguous ("form," "revenue," "active user").
- Multiple plausible catalog matches.
- Fuzzy time scope ("recently," "lately," "last quarter").
- Prior `query` returned `needs_disambiguation`.

If none fire → skip to `query` directly. `query` must escalate via `needs_disambiguation` rather than guess.

**DS hard rules:** cite catalog evidence; **do not** name lake artifacts; surface ambiguity. (Full convention in `agents/domain-specialist.md`.)

---

## 9. Query — bounded execution contract

- Translate question (+ optional DS brief) into the lake's `exec_paradigm`.
- ≤ 100 rows or aggregates only to manager.
- Save query to `.agentlab/artifacts/queries/YYYYMMDD-{slug}-{8char}.{ext}`.
- Update `concept_mapping` when a stable `concept → lake expression` is learned.

---

## 10. Critic gate

Run `critic` on any analytical answer above a complexity threshold (heuristics: > 1 source, time-series with < 30 points, methods agent invoked, hypothesis being confirmed, user-flagged "important"). Critic emits:

```json
{
  "verdict": "pass | revise | reject",
  "issues": [
    { "kind": "sampling | confidence | contradiction | missing_evidence | bias", "detail": "…" }
  ],
  "suggested_action": "…",
  "critique_artifact": ".agentlab/artifacts/critiques/…md"
}
```

Manager's response to verdict:

- `pass` — persist finding as-is.
- `revise` — re-dispatch upstream agent with critique attached; bounded retry.
- `reject` — present issue to user; do **not** persist as a finding (record under `open_questions`).

---

## 11. Memory model (three shapes)

All three live inside `.agentlab/context.json` (or sibling files referenced from it). The `memory` agent is the only writer-by-default for semantic and preferences memory; manager writes episodic memory directly.

| Shape | What | Schema | Writer |
|------|------|--------|--------|
| **Episodic** | Per-question outcomes: question, answer, artifacts, evidence, timestamps, supersession links | `memory/episodic.schema.json` | Manager (after `narrative` + optional `critic`) |
| **Semantic** | Long-lived concepts: term resolutions, concept→lake mappings, lightweight relationship edges between concepts, hypotheses confirmed/rejected | `memory/semantic.schema.json` | `memory` agent (with manager merging) |
| **Preferences** | User/workspace preferences: default time window, audience (executive vs engineer), preferred chart kinds, tolerated row caps, notification style | `memory/preferences.schema.json` | `memory` agent (set/get) or manager when explicit |

The `memory` agent supports two operations the manager can call directly:

- `recall(query, kind)` — retrieve relevant items from a memory shape.
- `commit(items, kind)` — write structured memory entries.

Vector indexing of semantic memory is **out of scope for v1**; we use plain text + structured fields. A future v2 may externalize semantic memory to a vector MCP.

---

## 12. Governance & policies (enforced, not advised)

Static markdown documents in `policies/` that **the manager and every agent must read** before processing tasks that touch the listed concerns:

| Policy | Purpose | Enforcement |
|--------|---------|-------------|
| `policies/pii.md` | PII handling: never include PII columns in artifacts; mask in samples; refuse if catalog flags a table as PII without explicit user consent | Manager dispatch refuses to send slices with PII fields to specialist agents; `query` refuses to return PII rows in samples; `hooks/scripts/policy-check.sh` re-applies a name-heuristic regex at the tool-call boundary |
| `policies/access.md` | Access boundaries: which datalakes are read-only; allowed `mcp_server` ids; required user confirmation for write actions | Manager bootstrap rejects unrecognized servers; agents refuse writes; the `PreToolUse` hook denies unregistered MCP servers and write-class verbs without a fresh `.agentlab/.consent_token` |

`hooks/` (Claude Code plugin) is the **shipped enforcement layer** in v1.1 — `hooks/hooks.json` registers a `PreToolUse` hook against `mcp__.*` that runs `hooks/scripts/policy-check.sh`. The hook fails open when the workspace is not bootstrapped or `jq` is missing, so it never blocks normal authoring.

A formal **Governance Agent** is deferred to v2; v1 treats governance as static policy + hook enforcement.

---

## 13. Engagement notebook

Per-workspace state, created on first invocation by copying `templates/context.init.json`.

```
<user-project>/
└── .agentlab/
    ├── context.json
    ├── snapshots/                ← optional, before compaction
    └── artifacts/
        ├── queries/
        ├── models/
        ├── reports/
        ├── plans/                ← architect outputs
        ├── critiques/            ← critic outputs
        └── visualizations/       ← narrative chart specs
```

`context.json` (registrations only — `schemas/context.schema.json`):

```json
{
  "context_version": 3,
  "use_case": null,
  "data_sources": [],
  "catalogs": []
}
```

**Notebook payload** (memory adapter MCP `notebook.load` / `schemas/notebook.schema.json`):

```json
{
  "term_cache": {},
  "concept_mapping": {},
  "preferences": { "row_cap": 100 },
  "hypotheses": [],
  "experiments": [],
  "findings": [],
  "semantic_links": [],
  "open_questions": [],
  "artifacts": []
}
```

`semantic_links[]` is the seed of the long-term knowledge graph. v1 keeps it as a flat array of typed edges; v2 may externalize.

---

## 14. Bundled vs runtime paths

| Asset | Bundled (plugin) | Runtime (user's repo) |
|------|-------------------|------------------------|
| Skill body | `${CLAUDE_PLUGIN_ROOT}/skills/agentlab/SKILL.md` | n/a |
| Agents | `${CLAUDE_PLUGIN_ROOT}/agents/*.md` | n/a |
| Policies | `${CLAUDE_PLUGIN_ROOT}/policies/*.md` | n/a |
| Schemas | `${CLAUDE_PLUGIN_ROOT}/schemas/*.json`, `${CLAUDE_PLUGIN_ROOT}/memory/*.json` | n/a |
| Notebook | n/a | Memory adapter (`notebook.load` / `notebook.patch`) + `.agentlab/artifacts/...` + slim `.agentlab/context.json` |

Cursor / non-plugin contexts use repo-relative paths.

---

## 15. Project structure

```
datascientist/                            ← package root
├── .claude-plugin/
│   └── plugin.json
├── .cursor/
│   └── skills/agentlab/SKILL.md        ← pointer
├── skills/
│   └── agentlab/SKILL.md               ← orchestrator policy
├── agents/
│   ├── architect.md
│   ├── discovery.md
│   ├── domain-specialist.md
│   ├── query.md
│   ├── methods.md
│   ├── narrative.md
│   ├── critic.md
│   └── memory.md
├── hooks/
│   ├── hooks.json                        ← PreToolUse manifest
│   ├── README.md
│   └── scripts/
│       └── policy-check.sh
├── policies/
│   ├── pii.md
│   └── access.md
├── memory/
│   ├── episodic.schema.json
│   ├── semantic.schema.json
│   └── preferences.schema.json
├── schemas/
│   ├── context.schema.json
│   └── notebook.schema.json
├── templates/
│   └── context.init.json
├── README.md
└── docs/
    └── specs/
        └── 2026-05-08-agentlab-analytics-design.md  ← this file
```

`bin/` and a `monitor` agent are **not** in v1.1.

---

## 16. Out of scope (v1)

- Real chart rendering (we ship visualization **specs**; a tool/runtime renders them).
- Background monitoring + automated retraining (`monitor` agent deferred).
- Recommendation Agent (turning analyses into actions).
- Operationalization (deploy / schedule / alert).
- ML modeling and causal inference deep capabilities (slot exists in `methods`; full implementation deferred).
- Multi-user shared workspace state.
- A first-class **profiles/** layer (collapsed into one-file agents with capability tags).
- Inter-agent direct messaging (Claude Code does not support it; manager mediates).

---

## 17. Closed decisions

- **Manager = main thread.** No `agents/manager.md` or similar.
- **Eight agents** with capability tags, splitting later when capabilities outgrow a file.
- **Critic is mandatory above a complexity threshold**; not optional cosmetic review.
- **Memory is structured** with three named shapes, not freeform.
- **Governance via policy markdown + (v1.1) hooks**, not an agent.
- **Visualization** stops at chart-intent specs in v1; rendering is delegated to tools/runtimes.
- **Semantic graph** stays inline (`semantic_links[]`) until the notebook outgrows ~1k entries.
- **No Python orchestrator inside the skill** in v1. If we ever need deterministic control flow, we wrap this skill with the Claude Agent SDK externally rather than embedding code.

---

## 18. Open questions

- **Critic complexity threshold.** Static heuristics now; learn over time later?
- **Memory recall ranking.** Lexical / tag-based v1; vector store as v2?
- **Hooks scripting language.** v1.1 hooks in shell vs Node — pick when implementing.
- **Dispatch table maintenance.** Manager-side capability tags vs auto-derived from agent frontmatter? Auto-derive seems strictly better.

---

## 19. Worked example (FPL)

User: `/agentlab What is the trend in the Arsenal team recently?`

1. Manager classifies → analytical question.
2. **architect** (light): emits a tiny plan — KPI = team form (5-gw rolling), dimensions = team, gameweek; hypothesis = "form trending up if last 3 gw points > prior 5 gw avg."
3. **domain-specialist** (DS triggers fire): resolves `Arsenal → team:ARS`, `recently → last 5 gw`; cites `snippet-fpl-12`, `snippet-fpl-31`.
4. **query**: SQL against `fpl_pg`; bounded 5-row result; saves query artifact.
5. **methods** (skipped — native SQL is sufficient).
6. **narrative**: writes report with form trajectory + visualization spec (line chart of points by gw, with rolling avg).
7. **critic** (light, < 30 points trigger): verdict `pass` with note "small sample; trend confidence moderate."
8. **memory**: appends `finding`; updates `semantic_links` if new concept relations were found.
9. Manager replies inline + links to artifacts.

LLM context never holds more than a handful of catalog snippets and a 5-row table.
