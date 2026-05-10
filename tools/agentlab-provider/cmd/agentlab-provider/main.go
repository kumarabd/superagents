package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kumarabd/superagents/tools/agentlab-provider/internal/hydrate"
	"github.com/urfave/cli/v2"
)

func main() {
	app := &cli.App{
		Name:  "agentlab-provider",
		Usage: "AgentLab provider (Postgres-backed context hydration)",
		Commands: []*cli.Command{
			{
				Name:  "hydrate",
				Usage: "Merge Postgres agentlab_* rows into context.json data_sources/catalogs (replace). Seeds from --template when context.json is missing.",
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
		},
	}
	if err := app.Run(os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
