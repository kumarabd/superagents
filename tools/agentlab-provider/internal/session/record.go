package session

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Record upserts SessionStart hook JSON (stdin) into agentlab_sessions.
// Expected fields include session_id, source, cwd, transcript_path, model (see Claude Code hooks).
func Record(ctx context.Context, pool *pgxpool.Pool, stdin io.Reader, projectDir string) error {
	data, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return fmt.Errorf("empty hook JSON on stdin")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("parse hook JSON: %w", err)
	}

	sid, _ := payload["session_id"].(string)
	if strings.TrimSpace(sid) == "" {
		return fmt.Errorf("session_id missing in hook payload")
	}

	source, _ := payload["source"].(string)
	model, _ := payload["model"].(string)
	agentType, _ := payload["agent_type"].(string)
	cwd, _ := payload["cwd"].(string)
	transcript, _ := payload["transcript_path"].(string)

	hookPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal hook_payload: %w", err)
	}

	const q = `INSERT INTO agentlab_sessions (
		session_id, session_source, model, agent_type, cwd, transcript_path, project_dir, hook_payload
	) VALUES (
		$1, $2, $3, $4, $5, $6, $7, $8::jsonb
	)
	ON CONFLICT (session_id) DO UPDATE SET
		session_source = EXCLUDED.session_source,
		model = EXCLUDED.model,
		agent_type = EXCLUDED.agent_type,
		cwd = EXCLUDED.cwd,
		transcript_path = EXCLUDED.transcript_path,
		project_dir = EXCLUDED.project_dir,
		hook_payload = EXCLUDED.hook_payload,
		updated_at = now()`

	_, err = pool.Exec(ctx, q,
		sid,
		source,
		model,
		agentType,
		cwd,
		transcript,
		projectDir,
		hookPayload,
	)
	if err != nil {
		return fmt.Errorf("upsert agentlab_sessions: %w", err)
	}
	return nil
}
