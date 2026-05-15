-- AgentLab environment registration counts + detail
-- datalake: local_environment_sql (postgres-environment @ 127.0.0.1:5433)
-- authored: 2026-05-14

SELECT 'agentlab_data_sources' AS source_table, COUNT(*) AS row_count, NULL AS registration_id, NULL AS mcp_server
FROM agentlab_data_sources
UNION ALL
SELECT 'agentlab_catalogs', COUNT(*), NULL, NULL
FROM agentlab_catalogs
UNION ALL
SELECT 'agentlab_data_sources', NULL, registration_id::text, mcp_server
FROM agentlab_data_sources
UNION ALL
SELECT 'agentlab_catalogs', NULL, registration_id::text, mcp_server
FROM agentlab_catalogs
ORDER BY source_table, row_count DESC NULLS LAST, registration_id;
