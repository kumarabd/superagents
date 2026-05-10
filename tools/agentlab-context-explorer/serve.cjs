/**
 * Dev server: static files from this directory + GET /api/context
 *
 * From repository root:
 *   node tools/agentlab-context-explorer/serve.cjs
 *
 * Override path:
 *   AGENTLAB_CONTEXT=/path/to/context.json node tools/agentlab-context-explorer/serve.cjs
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
const CONTEXT_PATH =
  process.env.AGENTLAB_CONTEXT || path.join(process.cwd(), ".agentlab", "context.json");

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
  console.error("agentlab-context-explorer http://127.0.0.1:" + PORT + "/");
  console.error("  context file: " + CONTEXT_PATH);
});
