# AgentLab `context.json` explorer

Dependency-free viewer for `.agentlab/context.json`: **Preferences & environment** vs **Memory** (episodic, semantic, index).

## Open locally (no server)

1. Open `index.html` in a browser via **File → Open** (or drag the file into the window).
2. Click **Choose file** and pick your `.agentlab/context.json`.

Or paste the full JSON under **Paste JSON** and click **Load from paste**.

## Optional dev server (auto-load context)

Run from your **analytics project/repo root** (where `.agentlab/context.json` lives):

```bash
node tools/agentlab-context-explorer/serve.cjs
```

Opens `http://127.0.0.1:8765/` and preloads `./.agentlab/context.json` via `fetch('/api/context')`.

Custom path:

```bash
AGENTLAB_CONTEXT=/path/to/context.json node tools/agentlab-context-explorer/serve.cjs
```

Different port:

```bash
PORT=9876 node tools/agentlab-context-explorer/serve.cjs
```

`serve.cjs` uses only Node’s built-in `http` / `fs` (CommonJS, works on typical Node 12+).
