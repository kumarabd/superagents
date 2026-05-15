/**
 * Dev server: static files + GET /api/context, /api/notebook, /api/merged
 *
 * Notebook proxy: reads `agentlab_notebook` (same as MCP `notebook.load`) when
 * NOTEBOOK_DATABASE_URL or DATABASE_URL is set and `pg` is installed (`npm install`).
 *
 * From repository root:
 *   npm install --prefix tools/agentlab-context-explorer
 *   NOTEBOOK_DATABASE_URL=postgres://.../claude_memory node tools/agentlab-context-explorer/serve.cjs
 *
 * Override context path:
 *   AGENTLAB_CONTEXT=/path/to/context.json ...
 *
 * Workspace key for notebook row (defaults to process.cwd()):
 *   NOTEBOOK_PROJECT=/abs/path/to/project
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const readFile = promisify(fs.readFile);

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
const CONTEXT_PATH =
  process.env.AGENTLAB_CONTEXT || path.join(process.cwd(), ".agentlab", "context.json");

const NOTEBOOK_KEYS = [
  "term_cache",
  "concept_mapping",
  "preferences",
  "hypotheses",
  "experiments",
  "findings",
  "semantic_links",
  "open_questions",
  "artifacts",
];

function defaultNotebookPayload() {
  return {
    term_cache: {},
    concept_mapping: {},
    preferences: { row_cap: 100 },
    hypotheses: [],
    experiments: [],
    findings: [],
    semantic_links: [],
    open_questions: [],
    artifacts: [],
  };
}

function mergeNotebookPayload(raw) {
  const d = defaultNotebookPayload();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of NOTEBOOK_KEYS) {
      if (raw[k] !== undefined) d[k] = raw[k];
    }
  }
  return d;
}

let _pool = null;
let _poolFailed = false;

function getPool() {
  if (_poolFailed) return null;
  const url = process.env.NOTEBOOK_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!url.trim()) return null;
  try {
    const { Pool } = require("pg");
    if (!_pool) {
      _pool = new Pool({ connectionString: url, max: 3 });
    }
    return _pool;
  } catch (e) {
    _poolFailed = true;
    console.error("agentlab-context-explorer: install pg for notebook proxy: npm install --prefix tools/agentlab-context-explorer");
    console.error("  (" + (e && e.message) + ")");
    return null;
  }
}

function workspaceKeyFromRequest(url) {
  const q = url.searchParams.get("project");
  if (q && q.trim()) return q.trim();
  return (
    process.env.NOTEBOOK_PROJECT ||
    process.env.AGENTLAB_PROJECT_DIR ||
    process.cwd()
  );
}

async function notebookLoadFromDb(workspaceKey) {
  const pool = getPool();
  if (!pool) {
    return {
      workspace_key: workspaceKey,
      version: 0,
      updated_at: null,
      notebook: defaultNotebookPayload(),
      _proxy: { configured: false, reason: "no DATABASE_URL / NOTEBOOK_DATABASE_URL or pg missing" },
    };
  }
  try {
    const { rows } = await pool.query(
      `SELECT workspace_key, payload, version, updated_at
       FROM agentlab_notebook WHERE workspace_key = $1`,
      [workspaceKey]
    );
    if (!rows.length) {
      return {
        workspace_key: workspaceKey,
        version: 0,
        updated_at: null,
        notebook: defaultNotebookPayload(),
        _proxy: { configured: true, row: false },
      };
    }
    const r = rows[0];
    const notebook = mergeNotebookPayload(r.payload);
    return {
      workspace_key: r.workspace_key,
      version: Number(r.version) || 1,
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      notebook,
      _proxy: { configured: true, row: true },
    };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    return {
      workspace_key: workspaceKey,
      version: 0,
      updated_at: null,
      notebook: defaultNotebookPayload(),
      _proxy: {
        configured: true,
        error: msg.includes("agentlab_notebook") ? "table missing — run memory migrate in memory-superagents" : msg,
      },
    };
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const base = "http://localhost";
  const url = new URL(req.url || "/", base);

  if (url.pathname === "/api/context") {
    fs.readFile(CONTEXT_PATH, "utf8", (err, data) => {
      if (err) {
        send(res, 404, { "Content-Type": "application/json" }, JSON.stringify({ error: String(err.message) }));
        return;
      }
      send(res, 200, { "Content-Type": "application/json; charset=utf-8" }, data);
    });
    return;
  }

  if (url.pathname === "/api/notebook") {
    const workspaceKey = workspaceKeyFromRequest(url);
    notebookLoadFromDb(workspaceKey)
      .then((body) => {
        send(res, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(body));
      })
      .catch((err) => {
        send(
          res,
          500,
          { "Content-Type": "application/json; charset=utf-8" },
          JSON.stringify({ error: String(err.message || err) })
        );
      });
    return;
  }

  if (url.pathname === "/api/merged") {
    const workspaceKey = workspaceKeyFromRequest(url);
    (async () => {
      let contextText;
      try {
        contextText = await readFile(CONTEXT_PATH, "utf8");
      } catch (e) {
        send(res, 404, { "Content-Type": "application/json" }, JSON.stringify({ error: String(e.message) }));
        return;
      }
      const ctx = JSON.parse(contextText);
      const nb = await notebookLoadFromDb(workspaceKey);
      const merged = { ...ctx };
      const payload = nb.notebook || defaultNotebookPayload();
      for (const k of NOTEBOOK_KEYS) {
        merged[k] = payload[k];
      }
      send(res, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(merged));
    })().catch((err) => {
      send(
        res,
        500,
        { "Content-Type": "application/json; charset=utf-8" },
        JSON.stringify({ error: String(err.message || err) })
      );
    });
    return;
  }

  if (url.pathname === "/api/bootstrap") {
    const body = {
      contextPath: CONTEXT_PATH,
      project: workspaceKeyFromRequest(url),
      notebookDatabase: Boolean(
        (process.env.NOTEBOOK_DATABASE_URL || process.env.DATABASE_URL || "").trim() && !_poolFailed
      ),
    };
    send(res, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(body, null, 2));
    return;
  }

  let filePath = path.join(ROOT, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, { "Content-Type": "text/plain" }, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, { "Content-Type": "text/plain" }, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };
    send(res, 200, { "Content-Type": types[ext] || "application/octet-stream" }, data);
  });
});

server.listen(PORT, () => {
  const dbUrl = (process.env.NOTEBOOK_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  let pgOk = false;
  if (dbUrl) {
    try {
      require.resolve("pg");
      pgOk = true;
    } catch (_) {
      /* optional */
    }
  }
  console.error("agentlab-context-explorer http://127.0.0.1:" + PORT + "/");
  console.error("  context file: " + CONTEXT_PATH);
  console.error("  notebook key: NOTEBOOK_PROJECT or cwd → " + (process.env.NOTEBOOK_PROJECT || process.cwd()));
  if (!dbUrl) {
    console.error("  notebook proxy: off (set NOTEBOOK_DATABASE_URL or DATABASE_URL for /api/notebook + /api/merged)");
  } else if (!pgOk) {
    console.error("  notebook proxy: URL set but pg not installed — npm install --prefix tools/agentlab-context-explorer");
  } else {
    console.error("  notebook proxy: on (agentlab_notebook, same as MCP notebook.load)");
  }
});
