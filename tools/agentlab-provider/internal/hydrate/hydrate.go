package hydrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run loads global registrations from Postgres and merges them into context.json array fields using
// the same keyed merge rules as other top-level arrays (see mergeContextArray). Today only
// data_sources and catalogs come from Postgres; other arrays are unchanged unless you extend patch.
// Object keys besides arrays are untouched. Seeds from template when contextPath is missing.
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
	debugf("postgres rows loaded: %d data_sources, %d catalogs (targets agentlab_environment tables agentlab_* )", len(sources), len(catalogs))
	if len(sources) == 0 && len(catalogs) == 0 {
		debugf("hint: if you expected rows, AGENTLAB_PG_DSN must point at the postgres-environment DB where docker init ran (often port 5433), not pgvector.")
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

	patch := map[string][]interface{}{
		"data_sources": sources,
		"catalogs":     catalogs,
	}
	if err := applyArrayMerges(doc, patch); err != nil {
		return err
	}
	normalizeAllNotebookArrays(doc)
	debugMergedLens(doc)

	if dryRun {
		preview := map[string]interface{}{
			"data_sources": doc["data_sources"],
			"catalogs":     doc["catalogs"],
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

// normalizeAllNotebookArrays dedupes and sorts every top-level array in context.schema.json
// using the same keys as hydrate merge (hypotheses, findings, artifacts, …).
func normalizeAllNotebookArrays(doc map[string]interface{}) {
	normalizationKeys := []string{
		"data_sources",
		"catalogs",
		"hypotheses",
		"experiments",
		"findings",
		"semantic_links",
		"artifacts",
		"open_questions",
	}
	for _, k := range normalizationKeys {
		raw, ok := doc[k]
		if !ok || raw == nil {
			continue
		}
		ex, ok := raw.([]interface{})
		if !ok {
			continue
		}
		doc[k] = mergeContextArray(k, ex, nil)
	}
}

func applyArrayMerges(doc map[string]interface{}, patch map[string][]interface{}) error {
	for field, incoming := range patch {
		raw, exists := doc[field]
		if !exists {
			doc[field] = mergeContextArray(field, nil, incoming)
			continue
		}
		if raw == nil {
			doc[field] = mergeContextArray(field, nil, incoming)
			continue
		}
		existing, ok := raw.([]interface{})
		if !ok {
			return fmt.Errorf("context json %q must be a JSON array for hydrate merge, got %T", field, raw)
		}
		doc[field] = mergeContextArray(field, existing, incoming)
	}
	return nil
}

// mergeContextArray merges incoming array items into existing for AgentLab notebook fields.
// Incoming wins on duplicate keys. Stable sort orders are applied after merge.
func mergeContextArray(field string, existing []interface{}, incoming []interface{}) []interface{} {
	switch field {
	case "open_questions":
		return mergeOpenQuestions(existing, incoming)
	case "findings":
		return mergeObjectsByStableKey(existing, incoming, findingStableKey)
	case "semantic_links":
		return mergeObjectsByStableKey(existing, incoming, semanticLinkStableKey)
	case "artifacts":
		return mergeObjectsByStableKey(existing, incoming, artifactPathStableKey)
	case "data_sources", "catalogs", "hypotheses", "experiments":
		return mergeObjectsByStableKey(existing, incoming, idStableKey)
	default:
		// Postgres patch only touches known schema arrays; future keys fallback to concatenation-ish:
		if len(incoming) == 0 {
			return existing
		}
		if len(existing) == 0 {
			return append([]interface{}(nil), incoming...)
		}
		out := append(append([]interface{}(nil), existing...), incoming...)
		return out
	}
}

func idStableKey(m map[string]interface{}) string {
	s, _ := m["id"].(string)
	return s
}

func artifactPathStableKey(m map[string]interface{}) string {
	s, _ := m["path"].(string)
	return s
}

func findingStableKey(m map[string]interface{}) string {
	q, _ := m["question"].(string)
	ts, _ := m["timestamp"].(string)
	if ts == "" {
		ts, _ = m["created_at"].(string)
	}
	return q + "\x00" + ts
}

func semanticLinkStableKey(m map[string]interface{}) string {
	from, _ := m["from"].(string)
	to, _ := m["to"].(string)
	kind, _ := m["kind"].(string)
	return from + "\x01" + to + "\x01" + kind
}

func mergeObjectsByStableKey(existing []interface{}, incoming []interface{}, keyFn func(map[string]interface{}) string) []interface{} {
	by := make(map[string]map[string]interface{})
	var orphans []interface{}

	for _, raw := range existing {
		m, ok := raw.(map[string]interface{})
		if !ok {
			orphans = append(orphans, raw)
			continue
		}
		k := keyFn(m)
		if k == "" {
			orphans = append(orphans, shallowCopyMap(m))
			continue
		}
		by[k] = shallowCopyMap(m)
	}

	for _, raw := range incoming {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		k := keyFn(m)
		if k == "" {
			continue
		}
		by[k] = shallowCopyMap(m)
	}

	if len(by) == 0 {
		if len(orphans) == 0 {
			return []interface{}{}
		}
		return orphans
	}

	keys := make([]string, 0, len(by))
	for k := range by {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]interface{}, 0, len(by)+len(orphans))
	for _, k := range keys {
		out = append(out, by[k])
	}
	out = append(out, orphans...)
	return out
}

func mergeOpenQuestions(existing []interface{}, incoming []interface{}) []interface{} {
	seen := make(map[string]struct{})
	var ordered []string
	add := func(s string) {
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		ordered = append(ordered, s)
	}
	for _, raw := range existing {
		s, ok := raw.(string)
		if !ok {
			continue
		}
		add(s)
	}
	for _, raw := range incoming {
		s, ok := raw.(string)
		if !ok {
			continue
		}
		add(s)
	}
	sort.Strings(ordered)
	out := make([]interface{}, len(ordered))
	for i, s := range ordered {
		out[i] = s
	}
	return out
}

func shallowCopyMap(m map[string]interface{}) map[string]interface{} {
	c := make(map[string]interface{}, len(m))
	for k, v := range m {
		c[k] = v
	}
	return c
}

func debugf(format string, args ...interface{}) {
	if os.Getenv("AGENTLAB_HYDRATE_DEBUG") != "1" {
		return
	}
	fmt.Fprintf(os.Stderr, "agentlab-provider hydrate: "+format+"\n", args...)
}

func debugMergedLens(doc map[string]interface{}) {
	if os.Getenv("AGENTLAB_HYDRATE_DEBUG") != "1" {
		return
	}
	ds, _ := doc["data_sources"].([]interface{})
	cat, _ := doc["catalogs"].([]interface{})
	fmt.Fprintf(os.Stderr, "agentlab-provider hydrate: after merge+normalize: %d data_sources, %d catalogs in context.json\n", len(ds), len(cat))
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
