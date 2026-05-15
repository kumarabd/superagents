---
artifacts:
  - path: .agentlab/artifacts/reports/20260514-env-reg-counts-e7f8a9b0.md
    type: report
    description: "Row counts and registration listing for agentlab_data_sources and agentlab_catalogs"
  - path: .agentlab/artifacts/visualizations/20260514-env-reg-counts-e7f8a9b0.vl.json
    type: visualization
    description: "Horizontal bar chart of row counts per AgentLab registry table"
finding:
  question: "How many rows are in agentlab_data_sources and agentlab_catalogs, and list registration_id and mcp_server for each?"
  answer: "Both agentlab_data_sources and agentlab_catalogs each contain exactly 1 registered entry. The single data source is local_environment_sql on postgres-environment; the single catalog is local_pgvector_catalog on postgres-pgvector-catalog."
  artifacts:
    - ".agentlab/artifacts/reports/20260514-env-reg-counts-e7f8a9b0.md"
    - ".agentlab/artifacts/queries/20260514-env-reg-counts-a1b2c3d4.sql"
    - ".agentlab/artifacts/results/20260514-env-reg-counts-a1b2c3d4.json"
---

# AgentLab Environment Registration Counts

**Question:** How many rows are in `agentlab_data_sources` and `agentlab_catalogs`, and what are the registration_id and mcp_server values for each?

## Answer

Both tables each contain **1 row**. The environment has one registered datalake (data source) and one registered catalog, making it a minimal single-source setup.

## Evidence

Source: `.agentlab/artifacts/results/20260514-env-reg-counts-a1b2c3d4.json`

### Row Counts

| Table                   | Row Count |
|-------------------------|-----------|
| agentlab_data_sources   | 1         |
| agentlab_catalogs       | 1         |

### agentlab_data_sources

| registration_id       | mcp_server           |
|-----------------------|----------------------|
| local_environment_sql | postgres-environment |

### agentlab_catalogs

| registration_id        | mcp_server                   |
|------------------------|------------------------------|
| local_pgvector_catalog | postgres-pgvector-catalog    |

## Why We Believe It

- Row counts are drawn directly from `.agentlab/artifacts/results/20260514-env-reg-counts-a1b2c3d4.json`, which reflects a live query against `postgres-environment` (port 5433).
- Preview rows from the dispatch slice confirm the exact registration_id and mcp_server values for both tables.

## Caveats

- Data freshness: counts reflect the state of the registry at query time (2026-05-14). New sources or catalogs registered after this query will not be reflected here.
- This is a minimal environment with a single datalake and single catalog; results are not representative of larger multi-source deployments.

## Visualization

- spec: `.agentlab/artifacts/visualizations/20260514-env-reg-counts-e7f8a9b0.vl.json`
- intent: horizontal bar chart showing row count (1) for each of the two AgentLab registry tables
