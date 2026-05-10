-- Global registration tables (v1): no session / workspace FK.
-- Hydrate loads all rows into context.json data_sources[] and catalogs[].

CREATE TABLE IF NOT EXISTS agentlab_data_sources (
    registration_id TEXT PRIMARY KEY,
    exec_paradigm     TEXT NOT NULL,
    mcp_server        TEXT NOT NULL,
    purpose           TEXT NOT NULL DEFAULT '',
    tags              TEXT[] NOT NULL DEFAULT '{}',
    schema_summary    JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agentlab_data_sources_mcp ON agentlab_data_sources (mcp_server);

CREATE TABLE IF NOT EXISTS agentlab_catalogs (
    registration_id TEXT PRIMARY KEY,
    retrieval         TEXT,
    mcp_server        TEXT NOT NULL,
    scope             TEXT,
    purpose           TEXT NOT NULL DEFAULT '',
    tags              TEXT[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agentlab_catalogs_mcp ON agentlab_catalogs (mcp_server);

COMMENT ON TABLE agentlab_data_sources IS 'Global datalake MCP registrations; hydrate emits kind=datalake.';
COMMENT ON TABLE agentlab_catalogs IS 'Global catalog MCP registrations; hydrate emits kind=catalog.';
