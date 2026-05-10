(function () {
  "use strict";

  function escapeHtml(s) {
    if (s == null || s === "") return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      context_version: raw.context_version ?? null,
      use_case: raw.use_case ?? null,
      data_sources: Array.isArray(raw.data_sources) ? raw.data_sources : [],
      catalogs: Array.isArray(raw.catalogs) ? raw.catalogs : [],
      preferences: raw.preferences && typeof raw.preferences === "object" ? raw.preferences : {},
      term_cache: raw.term_cache && typeof raw.term_cache === "object" ? raw.term_cache : {},
      concept_mapping:
        raw.concept_mapping && typeof raw.concept_mapping === "object" ? raw.concept_mapping : {},
      hypotheses: Array.isArray(raw.hypotheses) ? raw.hypotheses : [],
      semantic_links: Array.isArray(raw.semantic_links) ? raw.semantic_links : [],
      findings: Array.isArray(raw.findings) ? raw.findings : [],
      open_questions: Array.isArray(raw.open_questions) ? raw.open_questions : [],
      artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
      experiments: Array.isArray(raw.experiments) ? raw.experiments : [],
    };
  }

  function findingWhen(f) {
    return f.timestamp || f.date || "";
  }

  function findingText(f) {
    return f.answer || f.summary || "";
  }

  function tagsCell(tags) {
    if (!Array.isArray(tags) || !tags.length) return "—";
    return tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(" ");
  }

  function renderEnv(ctx) {
    const el = document.getElementById("envMount");
    const useCaseBlock =
      ctx.use_case == null
        ? "<p class=\"muted\">No use_case set.</p>"
        : typeof ctx.use_case === "object"
          ? `<dl class="dl-flat">
            ${Object.entries(ctx.use_case)
              .map(
                ([k, v]) =>
                  `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`
              )
              .join("")}
          </dl>
          <details><summary>Raw use_case JSON</summary><pre class="raw">${escapeHtml(JSON.stringify(ctx.use_case, null, 2))}</pre></details>`
          : `<p>${escapeHtml(String(ctx.use_case))}</p>`;

    const dsRows = ctx.data_sources
      .map(
        (r) => `<tr>
        <td>${escapeHtml(r.id ?? "—")}</td>
        <td>${escapeHtml(r.mcp_server ?? "—")}</td>
        <td>${escapeHtml(r.exec_paradigm ?? "—")}</td>
        <td>${tagsCell(r.tags)}</td>
        <td class="truncate" title="${escapeHtml(r.purpose ?? "")}">${escapeHtml(r.purpose ?? "—")}</td>
      </tr>`
      )
      .join("");

    const catRows = ctx.catalogs
      .map(
        (r) => `<tr>
        <td>${escapeHtml(r.id ?? "—")}</td>
        <td>${escapeHtml(r.mcp_server ?? "—")}</td>
        <td>${escapeHtml(r.retrieval ?? "—")}</td>
        <td>${escapeHtml(r.scope ?? "—")}</td>
        <td>${tagsCell(r.tags)}</td>
        <td class="truncate" title="${escapeHtml(r.purpose ?? "")}">${escapeHtml(r.purpose ?? "—")}</td>
      </tr>`
      )
      .join("");

    const prefEntries = Object.entries(ctx.preferences);
    const prefRows =
      prefEntries.length === 0
        ? "<tr><td colspan=\"2\" class=\"muted\">No preference keys.</td></tr>"
        : prefEntries
            .map(
              ([k, v]) => `<tr>
          <td><code>${escapeHtml(k)}</code></td>
          <td>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}</td>
        </tr>`
            )
            .join("");

    el.innerHTML = `
      <div class="grid-two">
        <div class="card">
          <h2>Meta</h2>
          <p><span class="pill">context_version ${escapeHtml(String(ctx.context_version ?? "?"))}</span></p>
        </div>
        <div></div>
      </div>
      <div class="card">
        <h2>Use case</h2>
        ${useCaseBlock}
      </div>
      <div class="grid-two">
        <div class="card">
          <h2>Datalakes <span class="pill">${ctx.data_sources.length}</span></h2>
          <table class="data">
            <thead><tr><th>id</th><th>mcp_server</th><th>exec_paradigm</th><th>tags</th><th>purpose</th></tr></thead>
            <tbody>${dsRows || "<tr><td colspan=\"5\" class=\"muted\">None registered.</td></tr>"}</tbody>
          </table>
        </div>
        <div class="card">
          <h2>Catalogs <span class="pill">${ctx.catalogs.length}</span></h2>
          <table class="data">
            <thead><tr><th>id</th><th>mcp_server</th><th>retrieval</th><th>scope</th><th>tags</th><th>purpose</th></tr></thead>
            <tbody>${catRows || "<tr><td colspan=\"6\" class=\"muted\">None registered.</td></tr>"}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>Preferences</h2>
        <table class="data">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>${prefRows}</tbody>
        </table>
      </div>
    `;
  }

  function renderConceptMapping(obj, depth) {
    if (depth > 8) return "<p class=\"muted\">…</p>";
    if (obj == null) return "—";
    if (typeof obj !== "object") return escapeHtml(String(obj));
    const entries = Object.entries(obj);
    if (!entries.length) return "<span class=\"muted\">empty</span>";
    return `<div class="concept-nested">${entries
      .map(([k, v]) => {
        if (v != null && typeof v === "object" && !Array.isArray(v)) {
          return `<div><strong>${escapeHtml(k)}</strong>${renderConceptMapping(v, depth + 1)}</div>`;
        }
        return `<div><strong>${escapeHtml(k)}</strong>: ${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}</div>`;
      })
      .join("")}</div>`;
  }

  function artifactTypeCounts(artifacts) {
    const m = {};
    for (const a of artifacts) {
      const t = a.type || "unknown";
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }

  function renderBars(counts) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return "<p class=\"muted\">No artifacts.</p>";
    const max = Math.max(...entries.map(([, n]) => n), 1);
    return `<div class="bars">${entries
      .map(([label, n]) => {
        const pct = (n / max) * 100;
        return `<div class="row"><label>${escapeHtml(label)}</label><div class="bar"><span style="width:${pct}%"></span></div><span>${n}</span></div>`;
      })
      .join("")}</div>`;
  }

  let currentCtx = null;
  let findingFilter = "";

  function findingOrigIndex(ctx, f) {
    return ctx.findings.indexOf(f);
  }

  function wireFindingButtons(ctx) {
    document.querySelectorAll(".finding-detail").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-orig-idx") || "-1", 10);
        const f = i >= 0 ? ctx.findings[i] : null;
        if (f) openFindingModal(f);
      });
    });
  }

  function openFindingModal(f) {
    const modal = document.getElementById("modal");
    const body = document.getElementById("modalBody");
    const title = document.getElementById("modalTitle");
    title.textContent = f.id ? `Finding ${f.id}` : "Finding";

    const bodyText = findingText(f);
    const arts = Array.isArray(f.artifacts) ? f.artifacts : [];
    body.innerHTML = `
      <div class="modal-block"><h3>Question</h3><p>${escapeHtml(f.question || "—")}</p></div>
      <div class="modal-block"><h3>Answer / summary</h3><p>${escapeHtml(bodyText || "—")}</p></div>
      <div class="modal-block"><h3>Artifacts</h3>${arts.length ? `<ul>${arts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "<p>—</p>"}</div>
      <div class="modal-block"><h3>Other</h3><p>critic_verdict: ${escapeHtml(f.critic_verdict ?? "—")}\ntimestamp/date: ${escapeHtml(findingWhen(f) || "—")}</p></div>
    `;
    modal.hidden = false;
  }

  function closeModal() {
    document.getElementById("modal").hidden = true;
  }

  function renderMemory(ctx) {
    currentCtx = ctx;
    const el = document.getElementById("memMount");
    const typeCounts = artifactTypeCounts(ctx.artifacts);

    const termEntries = Object.entries(ctx.term_cache);
    const hypStatus = [...new Set(ctx.hypotheses.map((h) => h.status).filter(Boolean))];

    el.innerHTML = `
      <section id="episodic" class="card">
        <h2>Episodic</h2>
        <h3>Findings <span class="pill">${ctx.findings.length}</span></h3>
        <div class="filter-row">
          <label for="findingSearch">Filter</label>
          <input type="search" id="findingSearch" placeholder="question, id, date…" value="${escapeHtml(findingFilter)}" />
        </div>
        <table class="data">
          <thead><tr><th>When</th><th>id</th><th>Question</th><th>critic</th><th>#art</th><th></th></tr></thead>
          <tbody id="findingTbody">${renderFindingsBody(ctx)}</tbody>
        </table>
        <h3>Open questions <span class="pill">${ctx.open_questions.length}</span></h3>
        ${ctx.open_questions.length ? `<ul>${ctx.open_questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>` : "<p class=\"muted\">None.</p>"}
      </section>

      <section id="semantic" class="card">
        <h2>Semantic</h2>
        <h3>Term cache <span class="pill">${termEntries.length}</span></h3>
        <div class="filter-row">
          <label for="termSearch">Search terms</label>
          <input type="search" id="termSearch" placeholder="filter keys or values…" />
        </div>
        <table class="data" id="termTable">
          <thead><tr><th>Term</th><th>Resolution</th></tr></thead>
          <tbody>${termEntries
            .map(
              ([k, v]) =>
                `<tr data-k="${escapeHtml(k)}" data-v="${escapeHtml(v)}"><td><code>${escapeHtml(k)}</code></td><td>${escapeHtml(v)}</td></tr>`
            )
            .join("") || "<tr><td colspan=\"2\" class=\"muted\">Empty.</td></tr>"}</tbody>
        </table>
        <h3>Concept mapping</h3>
        ${renderConceptMapping(ctx.concept_mapping, 0)}
        <h3>Hypotheses <span class="pill">${ctx.hypotheses.length}</span></h3>
        <div class="filter-row">
          <label for="hypoStatus">Status</label>
          <select id="hypoStatus"><option value="">all</option>${hypStatus.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select>
        </div>
        <table class="data" id="hypoTable">
          <thead><tr><th>id</th><th>statement</th><th>status</th><th>created</th></tr></thead>
          <tbody>${renderHypoRows(ctx.hypotheses, "")}</tbody>
        </table>
        <h3>Semantic links <span class="pill">${ctx.semantic_links.length}</span></h3>
        <table class="data">
          <thead><tr><th>from</th><th>to</th><th>kind</th><th>weight</th></tr></thead>
          <tbody>${ctx.semantic_links
            .map(
              (l) => `<tr>
            <td class="truncate" title="${escapeHtml(l.from || "")}">${escapeHtml(l.from ?? "—")}</td>
            <td class="truncate" title="${escapeHtml(l.to || "")}">${escapeHtml(l.to ?? "—")}</td>
            <td>${escapeHtml(l.kind ?? "—")}</td>
            <td>${l.weight != null ? escapeHtml(String(l.weight)) : "—"}</td>
          </tr>`
            )
            .join("") || "<tr><td colspan=\"4\" class=\"muted\">None.</td></tr>"}</tbody>
        </table>
      </section>

      <section id="index" class="card">
        <h2>Index &amp; runs</h2>
        <h3>Artifacts by type</h3>
        ${renderBars(typeCounts)}
        <h3>Artifacts <span class="pill">${ctx.artifacts.length}</span></h3>
        <table class="data">
          <thead><tr><th>type</th><th>created</th><th>path</th><th>description</th></tr></thead>
          <tbody>${ctx.artifacts
            .map(
              (a) => `<tr>
            <td>${escapeHtml(a.type ?? "—")}</td>
            <td>${escapeHtml(a.created_at ?? a.created ?? "—")}</td>
            <td class="truncate" title="${escapeHtml(a.path || "")}">${escapeHtml(a.path ?? "—")}</td>
            <td class="truncate" title="${escapeHtml(a.description || "")}">${escapeHtml((a.description || "").slice(0, 80))}${(a.description || "").length > 80 ? "…" : ""}</td>
          </tr>`
            )
            .join("") || "<tr><td colspan=\"4\" class=\"muted\">None.</td></tr>"}</tbody>
        </table>
        <h3>Experiments <span class="pill">${ctx.experiments.length}</span></h3>
        <table class="data">
          <thead><tr><th>id</th><th>name</th><th>status</th><th>hypothesis_id</th><th>created</th></tr></thead>
          <tbody>${ctx.experiments
            .map(
              (e) => `<tr>
            <td>${escapeHtml(e.id ?? "—")}</td>
            <td class="truncate" title="${escapeHtml(e.name || "")}">${escapeHtml(e.name ?? "—")}</td>
            <td>${escapeHtml(e.status ?? "—")}</td>
            <td>${escapeHtml(e.hypothesis_id ?? "—")}</td>
            <td>${escapeHtml(e.created_at ?? "—")}</td>
          </tr>`
            )
            .join("") || "<tr><td colspan=\"5\" class=\"muted\">None.</td></tr>"}</tbody>
        </table>
      </section>
    `;

    wireFindingButtons(ctx);

    const fs = document.getElementById("findingSearch");
    if (fs) {
      fs.addEventListener("input", () => {
        findingFilter = fs.value;
        const tb = document.getElementById("findingTbody");
        if (tb && currentCtx) {
          tb.innerHTML = renderFindingsBody(currentCtx);
          wireFindingButtons(currentCtx);
        }
      });
    }

    const ts = document.getElementById("termSearch");
    if (ts) {
      ts.addEventListener("input", () => {
        const q = ts.value.trim().toLowerCase();
        document.querySelectorAll("#termTable tbody tr").forEach((row) => {
          const k = (row.getAttribute("data-k") || "").toLowerCase();
          const v = (row.getAttribute("data-v") || "").toLowerCase();
          row.style.display = !q || k.includes(q) || v.includes(q) ? "" : "none";
        });
      });
    }

    const hs = document.getElementById("hypoStatus");
    if (hs) {
      hs.addEventListener("change", () => {
        const st = hs.value;
        const tb = document.querySelector("#hypoTable tbody");
        if (tb && currentCtx) tb.innerHTML = renderHypoRows(currentCtx.hypotheses, st);
      });
    }
  }

  function renderFindingsBody(ctx) {
    const q = findingFilter.trim().toLowerCase();
    let list = ctx.findings.slice();
    if (q) {
      list = list.filter((f) => {
        const blob = [f.question, findingText(f), f.id, findingWhen(f), (f.critic_verdict || "").toString()]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort((a, b) => String(findingWhen(b)).localeCompare(String(findingWhen(a))));

    if (!list.length) return "<tr><td colspan=\"6\" class=\"muted\">No matching findings.</td></tr>";

    return list
      .map((f) => {
        const qshort = (f.question || "").slice(0, 72) + ((f.question || "").length > 72 ? "…" : "");
        const arts = Array.isArray(f.artifacts) ? f.artifacts.length : 0;
        const oi = findingOrigIndex(ctx, f);
        return `<tr>
        <td>${escapeHtml(findingWhen(f))}</td>
        <td>${escapeHtml(f.id ?? "—")}</td>
        <td class="truncate" title="${escapeHtml(f.question || "")}">${escapeHtml(qshort || "—")}</td>
        <td>${escapeHtml(f.critic_verdict ?? "—")}</td>
        <td>${arts}</td>
        <td><button type="button" class="linkish finding-detail" data-orig-idx="${oi}">View</button></td>
      </tr>`;
      })
      .join("");
  }

  function renderHypoRows(hypotheses, statusFilter) {
    const list = statusFilter ? hypotheses.filter((h) => h.status === statusFilter) : hypotheses;
    if (!list.length) return "<tr><td colspan=\"4\" class=\"muted\">None.</td></tr>";
    return list
      .map(
        (h) => `<tr>
      <td>${escapeHtml(h.id ?? "—")}</td>
      <td class="truncate" title="${escapeHtml(h.statement || "")}">${escapeHtml((h.statement || "").slice(0, 100))}${(h.statement || "").length > 100 ? "…" : ""}</td>
      <td>${escapeHtml(h.status ?? "—")}</td>
      <td>${escapeHtml(h.created_at ?? "—")}</td>
    </tr>`
      )
      .join("");
  }

  function setDataset(ctx) {
    const statusEl = document.getElementById("loadStatus");
    findingFilter = "";
    renderEnv(ctx);
    renderMemory(ctx);
    statusEl.textContent = "Loaded notebook.";
  }

  function parseAndLoad(text) {
    try {
      const raw = JSON.parse(text);
      const ctx = normalize(raw);
      if (!ctx) throw new Error("Invalid JSON root");
      setDataset(ctx);
    } catch (e) {
      document.getElementById("loadStatus").textContent =
        "Invalid JSON: " + (e && e.message ? e.message : String(e));
    }
  }

  function initTabs() {
    const tabs = document.querySelectorAll('[role="tab"]');
    const panels = [
      document.getElementById("panel-env"),
      document.getElementById("panel-mem"),
    ];
    tabs.forEach((tab, idx) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t, i) => {
          t.setAttribute("aria-selected", String(i === idx));
        });
        panels.forEach((p, i) => {
          p.hidden = i !== idx;
          p.classList.toggle("active", i === idx);
        });
      });
    });
  }

  document.getElementById("fileInput").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => parseAndLoad(String(r.result || ""));
    r.readAsText(f);
  });

  document.getElementById("pasteLoadBtn").addEventListener("click", () => {
    const t = document.getElementById("pasteArea").value;
    parseAndLoad(t);
  });

  document.querySelector(".modal-close").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });

  function tryFetchContext() {
    if (!window.location.protocol.startsWith("http")) return;
    fetch("/api/context")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.text();
      })
      .then(parseAndLoad)
      .catch(() => {
        /* optional server not running — user can load file */
      });
  }

  initTabs();
  tryFetchContext();
})();
