-- Local dev seed for docker-compose postgres-environment (agentlab_environment).
-- MCP server names match docs/claude-mcp-postgres.md — register the same IDs with Claude:
--   claude mcp add … postgres-environment -- ./tools/mcp-postgres-environment.sh
--   claude mcp add … postgres-pgvector-catalog -- ./tools/mcp-postgres-pgvector-catalog.sh
-- Hydrate merges these rows into .agentlab/context.json on SessionStart.

INSERT INTO agentlab_data_sources (registration_id, exec_paradigm, mcp_server, purpose, tags)
VALUES (
    'local_environment_sql',
    'sql',
    'postgres-environment',
    'AgentLab hydrate DB on 127.0.0.1:5433 — registration tables only (readonly dev MCP)',
    ARRAY['readonly', 'dev']
);

INSERT INTO agentlab_catalogs (registration_id, retrieval, mcp_server, scope, purpose, tags)
VALUES (
    'local_pgvector_catalog',
    'vector',
    'postgres-pgvector-catalog',
    'localhost',
    'pgvector-backed catalog on 127.0.0.1:5434 (semantic / glossary MCP)',
    ARRAY['dev']
);
