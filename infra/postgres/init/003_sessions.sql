-- Session registry: SessionStart/resume hooks upsert rows via agentlab-provider session-record.

CREATE TABLE IF NOT EXISTS agentlab_sessions (
    session_id TEXT PRIMARY KEY,
    session_source TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    agent_type TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    transcript_path TEXT NOT NULL DEFAULT '',
    project_dir TEXT NOT NULL DEFAULT '',
    hook_payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agentlab_sessions_project_dir ON agentlab_sessions (project_dir);
CREATE INDEX IF NOT EXISTS idx_agentlab_sessions_updated_at ON agentlab_sessions (updated_at DESC);

COMMENT ON TABLE agentlab_sessions IS 'Claude Code SessionStart lifecycle; updated by agentlab-provider session-record from hook stdin.';
COMMENT ON COLUMN agentlab_sessions.session_source IS 'SessionStart hook "source": startup | resume | clear | compact.';
COMMENT ON COLUMN agentlab_sessions.project_dir IS 'Workspace root ($CLAUDE_PROJECT_DIR) passed from the hook shell.';
