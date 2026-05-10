package hydrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run loads all global registrations from Postgres and merges data_sources and catalogs
// into contextPath. Other top-level keys are preserved on update. When contextPath is missing,
// if templatePath is non-empty Run seeds from that JSON file before merging. Writes atomically unless dryRun.
func Run(ctx context.Context, dsn, contextPath, templatePath string, dryRun bool) error {
	if dsn == "" {
		return errors.New("AGENTLAB_PG_DSN is empty")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("postgres connect: %w", err)
	}
	defer pool.Close()

	sources, err := loadDataSources(ctx, pool)
	if err != nil {
		return err
	}
	catalogs, err := loadCatalogs(ctx, pool)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(contextPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("read context: %w", err)
		}
		if strings.TrimSpace(templatePath) == "" {
			return fmt.Errorf("context file missing %s: set hydrate --template or AGENTLAB_CONTEXT_TEMPLATE to templates/context.init.json", contextPath)
		}
		tpl, err := os.ReadFile(templatePath)
		if err != nil {
			return fmt.Errorf("read template %s: %w", templatePath, err)
		}
		data = tpl
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("parse context json: %w", err)
	}

	doc["data_sources"] = sources
	doc["catalogs"] = catalogs

	if dryRun {
		preview := map[string]interface{}{
			"data_sources": sources,
			"catalogs":     catalogs,
		}
		b, err := json.MarshalIndent(preview, "", "  ")
		if err != nil {
			return err
		}
		fmt.Printf("%s\n", b)
		return nil
	}

	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal context: %w", err)
	}
	out = append(out, '\n')
	return atomicWrite(contextPath, out)
}

func loadDataSources(ctx context.Context, pool *pgxpool.Pool) ([]interface{}, error) {
	q := `SELECT registration_id, exec_paradigm, mcp_server, purpose, tags, schema_summary
	      FROM agentlab_data_sources ORDER BY registration_id`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("query agentlab_data_sources: %w", err)
	}
	defer rows.Close()

	var out []interface{}
	for rows.Next() {
		var id, paradigm, server, purpose string
		var tags []string
		var summary []byte
		if err := rows.Scan(&id, &paradigm, &server, &purpose, &tags, &summary); err != nil {
			return nil, fmt.Errorf("scan data_source row: %w", err)
		}
		obj := map[string]interface{}{
			"id":             id,
			"kind":           "datalake",
			"exec_paradigm":  paradigm,
			"mcp_server":     server,
			"purpose":        purpose,
			"tags":           tags,
		}
		if len(summary) > 0 {
			obj["schema_summary"] = json.RawMessage(summary)
		}
		out = append(out, obj)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func loadCatalogs(ctx context.Context, pool *pgxpool.Pool) ([]interface{}, error) {
	q := `SELECT registration_id, retrieval, mcp_server, scope, purpose, tags
	      FROM agentlab_catalogs ORDER BY registration_id`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("query agentlab_catalogs: %w", err)
	}
	defer rows.Close()

	var out []interface{}
	for rows.Next() {
		var id, server, purpose string
		var retrieval, scope pgtype.Text
		var tags []string
		if err := rows.Scan(&id, &retrieval, &server, &scope, &purpose, &tags); err != nil {
			return nil, fmt.Errorf("scan catalog row: %w", err)
		}
		obj := map[string]interface{}{
			"id":         id,
			"kind":       "catalog",
			"mcp_server": server,
			"purpose":    purpose,
			"tags":       tags,
		}
		if retrieval.Valid && retrieval.String != "" {
			obj["retrieval"] = retrieval.String
		}
		if scope.Valid && scope.String != "" {
			obj["scope"] = scope.String
		}
		out = append(out, obj)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func atomicWrite(contextPath string, data []byte) error {
	dir := filepath.Dir(contextPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir parent of context: %w", err)
	}
	tmp := filepath.Join(dir, fmt.Sprintf(".context.json.hydrate.%d.tmp", time.Now().UnixNano()))
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write temp context: %w", err)
	}
	if err := os.Rename(tmp, contextPath); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename context: %w", err)
	}
	return nil
}
