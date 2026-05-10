package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kumarabd/superagents/tools/agentlab-provider/internal/hydrate"
	"github.com/kumarabd/superagents/tools/agentlab-provider/internal/session"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Name:  "agentlab-provider",
		Usage: "AgentLab provider (hydrate context.json + record SessionStart metadata in Postgres)",
		Commands: []*cli.Command{
			{
				Name:  "hydrate",
				Usage: "Merge Postgres into data_sources/catalogs by id; then dedupe/sort every notebook array per context.schema (hypotheses, findings, …). Seeds from --template when missing.",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "project-dir",
						Aliases: []string{"p"},
						Usage:   "project root containing .agentlab/ (default: $CLAUDE_PROJECT_DIR or cwd)",
						EnvVars: []string{"CLAUDE_PROJECT_DIR"},
					},
					&cli.StringFlag{
						Name:    "context-path",
						Aliases: []string{"c"},
						Usage:   "override path to context.json",
					},
					&cli.StringFlag{
						Name:    "template",
						Aliases: []string{"t"},
						Usage:   "context seed JSON when .agentlab/context.json is absent (defaults: $AGENTLAB_CONTEXT_TEMPLATE, else ignored if file exists)",
						EnvVars: []string{"AGENTLAB_CONTEXT_TEMPLATE"},
					},
					&cli.BoolFlag{
						Name:  "dry-run",
						Usage: "print data_sources and catalogs JSON only; do not write file",
					},
				},
				Action: func(c *cli.Context) error {
					dsn := os.Getenv("AGENTLAB_PG_DSN")
					projectDir := c.String("project-dir")
					if projectDir == "" {
						wd, err := os.Getwd()
						if err != nil {
							return fmt.Errorf("project-dir not set and getwd failed: %w", err)
						}
						projectDir = wd
					}
					ctxPath := c.String("context-path")
					if ctxPath == "" {
						ctxPath = fmt.Sprintf("%s/.agentlab/context.json", projectDir)
					}
					return hydrate.Run(context.Background(), dsn, ctxPath, c.String("template"), c.Bool("dry-run"))
				},
			},
			{
				Name:  "ping",
				Usage: "Verify AGENTLAB_PG_DSN connects (optional sanity check)",
				Action: func(c *cli.Context) error {
					dsn := os.Getenv("AGENTLAB_PG_DSN")
					if dsn == "" {
						return fmt.Errorf("AGENTLAB_PG_DSN is not set")
					}
					pool, err := pgxpool.New(context.Background(), dsn)
					if err != nil {
						return err
					}
					defer pool.Close()
					return pool.Ping(context.Background())
				},
			},
			{
				Name:    "session-record",
				Aliases: []string{"record-session"},
				Usage:   "Read Claude Code SessionStart JSON from stdin; upsert into agentlab_sessions (same DSN as hydrate)",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "project-dir",
						Aliases: []string{"p"},
						Usage:   "workspace root stored on the row (default: $CLAUDE_PROJECT_DIR or cwd)",
						EnvVars: []string{"CLAUDE_PROJECT_DIR"},
					},
				},
				Action: func(c *cli.Context) error {
					dsn := os.Getenv("AGENTLAB_PG_DSN")
					if dsn == "" {
						return fmt.Errorf("AGENTLAB_PG_DSN is not set")
					}
					projectDir := c.String("project-dir")
					if projectDir == "" {
						wd, err := os.Getwd()
						if err != nil {
							return fmt.Errorf("project-dir not set and getwd failed: %w", err)
						}
						projectDir = wd
					}
					pool, err := pgxpool.New(context.Background(), dsn)
					if err != nil {
						return err
					}
					defer pool.Close()
					return session.Record(context.Background(), pool, os.Stdin, projectDir)
				},
			},
		},
	}
	if err := app.Run(os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
