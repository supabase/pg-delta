/** Self-contained HTML shell for dogfooding review reports. */
import type { ReportPayload } from "./report-core.ts";

const BUCKET_COLORS: Record<string, string> = {
  "both-converge": "#1a7f37",
  "old-fingerprint-gate": "#0969da",
  "accepted-difference-acl": "#bf8700",
  "old-fails-new-converges": "#bf8700",
  "new-fails-old-converges": "#cf222e",
  "both-fail": "#cf222e",
  "not-checked": "#656d76",
};

export function renderReportHtml(payload: ReportPayload): string {
  const dataJson = JSON.stringify(payload).replace(/<\//g, "\\u003c/");
  const runLabel = payload.runDir.split("/").pop() ?? payload.runDir;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dogfood report — ${escapeHtml(runLabel)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css" />
  <style>
    :root {
      --bg: #f6f8fa;
      --surface: #fff;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
      --accent: #1a7f37;
      --old-color: #8b949e;
      --new-color: #1a7f37;
      --warn-bg: #fff8c5;
      --max-width: 90rem;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.5 system-ui, sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .layout {
      display: grid;
      grid-template-columns: 14rem 1fr;
      min-height: 100vh;
    }
    nav {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 1rem 0.75rem;
    }
    nav h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin: 0 0.5rem 0.75rem;
    }
    nav a {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.5rem;
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--text);
    }
    nav a:hover { background: var(--bg); text-decoration: none; }
    nav a.active { background: #ddf4ff; font-weight: 600; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    main { padding: 1.5rem 2rem 3rem; max-width: var(--max-width); }
    h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
    .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .card .label { font-size: 0.75rem; color: var(--muted); }
    .card .value { font-size: 1.4rem; font-weight: 600; }
    .charts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
    .chart-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .chart-box h3 { margin: 0 0 0.5rem; font-size: 0.9rem; }
    .chart-box canvas { max-height: 280px; }
    .chart-controls { font-size: 0.8rem; margin-bottom: 0.5rem; }
    .filters {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .filters label {
      display: flex; align-items: center; gap: 0.35rem;
      font-size: 0.85rem; cursor: pointer;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 999px; padding: 0.25rem 0.65rem;
    }
    table.summary {
      width: 100%; border-collapse: collapse;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; overflow: hidden; margin-bottom: 2rem;
      font-size: 0.85rem;
    }
    table.summary th, table.summary td {
      border-bottom: 1px solid var(--border);
      padding: 0.5rem 0.75rem; text-align: left;
    }
    table.summary th { background: var(--bg); font-weight: 600; }
    table.summary tr.hidden { display: none; }
    table.summary tr.highlight { background: #fff8c5; }
    table.summary tr.mismatch { background: #fffbeb; }
    .badge {
      display: inline-block; font-size: 0.75rem; font-weight: 500;
      padding: 0.15rem 0.5rem; border-radius: 999px; color: #fff;
    }
    .scenario {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
    }
    .scenario-header {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem;
      padding: 0.75rem 1rem; cursor: pointer; user-select: none;
      background: var(--bg);
    }
    .scenario-header h2 { margin: 0; font-size: 1rem; flex: 1; min-width: 12rem; }
    .scenario-header .chevron { transition: transform 0.15s; }
    .scenario.open .chevron { transform: rotate(90deg); }
    .scenario-body { display: none; padding: 0 1rem 1rem; }
    .scenario.open .scenario-body { display: block; }
    .metrics-strip {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
      font-size: 0.8rem; color: var(--muted); margin-bottom: 0.75rem;
    }
    .chip {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 4px; padding: 0.15rem 0.45rem;
    }
    .chip.warn { background: var(--warn-bg); border-color: #d4a72c; }
    .chip.error { background: #ffebe9; border-color: #ff8182; color: #cf222e; }
    .mini-chart { height: 28px; max-width: 280px; margin: 0.25rem 0; }
    .tabs { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); }
    .tab {
      padding: 0.4rem 0.75rem; border: none; background: none;
      cursor: pointer; font-size: 0.85rem; color: var(--muted);
      border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .tab.active { color: var(--text); border-bottom-color: #0969da; font-weight: 600; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .sql-panes {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
      max-height: 480px; overflow: hidden;
    }
    .sql-pane {
      display: flex; flex-direction: column;
      border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    }
    .sql-pane .pane-label {
      background: var(--bg); padding: 0.35rem 0.6rem;
      font-size: 0.75rem; font-weight: 600; border-bottom: 1px solid var(--border);
    }
    .sql-pane .pane-label.old { color: var(--old-color); }
    .sql-pane .pane-label.new { color: var(--new-color); }
    .sql-scroll {
      overflow: auto; flex: 1; margin: 0;
      font-family: ui-monospace, monospace; font-size: 0.78rem;
    }
    .sql-scroll pre { margin: 0; padding: 0.5rem; }
    .diff-container { overflow-x: auto; font-size: 0.8rem; }
    .stmt-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .stmt-table th, .stmt-table td {
      border: 1px solid var(--border); padding: 0.4rem 0.6rem;
      vertical-align: top;
    }
    .stmt-table th { background: var(--bg); width: 2.5rem; text-align: center; }
    .stmt-table code { font-size: 0.78rem; white-space: pre-wrap; word-break: break-word; }
    .collapsible { margin-top: 0.75rem; }
    .collapsible summary { cursor: pointer; font-size: 0.85rem; color: var(--muted); }
    .collapsible pre {
      background: var(--bg); padding: 0.75rem; border-radius: 6px;
      overflow-x: auto; font-size: 0.75rem;
    }
    .error-box {
      background: #ffebe9; border: 1px solid #ff8182;
      border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem;
      font-size: 0.85rem; color: #cf222e;
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav id="nav"></nav>
    <main>
      <h1>Dogfood report</h1>
      <p class="meta" id="meta"></p>
      <div class="cards" id="cards"></div>
      <section class="charts" id="charts"></section>
      <div class="filters" id="filters"></div>
      <table class="summary" id="summary-table">
        <thead>
          <tr>
            <th>Scenario</th><th>Kind</th>
            <th>Old stmts</th><th>New stmts</th>
            <th>Plan ms (old → new)</th><th>Speedup</th>
            <th>Apply bucket</th><th>Prove</th><th>Diff</th>
          </tr>
        </thead>
        <tbody id="summary-body"></tbody>
      </table>
      <div id="scenarios"></div>
    </main>
  </div>
  <script id="payload" type="application/json">${dataJson}</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/languages/sql.min.js"></script>
  <script>
${CLIENT_SCRIPT}
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CLIENT_SCRIPT = `
const BUCKET_COLORS = ${JSON.stringify(BUCKET_COLORS)};
const payload = JSON.parse(document.getElementById("payload").textContent);

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function bucketBadge(bucket) {
  const color = BUCKET_COLORS[bucket] || "#656d76";
  return '<span class="badge" style="background:' + color + '">' + esc(bucket) + '</span>';
}

function formatMs(ms) {
  return ms < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

function scrollToScenario(id) {
  const el = document.getElementById("scenario-" + id);
  if (!el) return;
  el.classList.add("open");
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelectorAll("#summary-body tr").forEach(r => r.classList.remove("highlight"));
  const row = document.querySelector('#summary-body tr[data-id="' + id + '"]');
  if (row) row.classList.add("highlight");
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.id === id));
}

function renderMeta() {
  document.getElementById("meta").innerHTML =
    'Run: <code>' + esc(payload.runDir) + '</code> · Generated ' +
    new Date(payload.generatedAt).toLocaleString();
}

function renderCards() {
  const s = payload.summary;
  const cards = [
    ["Scenarios", s.scenarioCount],
    ["Stmt mismatches", s.stmtCountMismatches],
    ["Median speedup", s.medianSpeedup + "×"],
    ["Prove failed", s.proveFailed],
  ];
  document.getElementById("cards").innerHTML = cards.map(([l, v]) =>
    '<div class="card"><div class="label">' + esc(l) + '</div><div class="value">' + esc(v) + '</div></div>'
  ).join("");
}

function makeChartClickHandler(labels) {
  return (_evt, elements) => {
    if (!elements.length) return;
    scrollToScenario(labels[elements[0].index]);
  };
}

function renderCharts() {
  const charts = payload.summary.charts;
  const section = document.getElementById("charts");
  section.innerHTML =
    '<div class="chart-box"><h3>Plan time (ms)</h3><canvas id="chart-plan"></canvas></div>' +
    '<div class="chart-box"><h3>Speedup ratio</h3>' +
    '<div class="chart-controls"><label><input type="checkbox" id="log-speedup" /> Log scale</label></div>' +
    '<canvas id="chart-speedup"></canvas></div>' +
    '<div class="chart-box"><h3>Statement counts</h3><canvas id="chart-stmts"></canvas></div>' +
    '<div class="chart-box"><h3>Apply buckets</h3><canvas id="chart-buckets"></canvas></div>';

  const planCtx = document.getElementById("chart-plan");
  new Chart(planCtx, {
    type: "bar",
    data: {
      labels: charts.planTime.labels,
      datasets: [
        { label: "Old (pg-delta)", data: charts.planTime.oldMs, backgroundColor: "#8b949e" },
        { label: "New (pg-delta-next)", data: charts.planTime.newMs, backgroundColor: "#1a7f37" },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      onClick: makeChartClickHandler(charts.planTime.labels),
      plugins: { legend: { position: "bottom" } },
      scales: { x: { beginAtZero: true } },
    },
  });

  const speedupData = charts.speedup.ratios;
  const speedupChart = new Chart(document.getElementById("chart-speedup"), {
    type: "bar",
    data: {
      labels: charts.speedup.labels,
      datasets: [{ label: "Speedup ×", data: speedupData, backgroundColor: "#0969da" }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      onClick: makeChartClickHandler(charts.speedup.labels),
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    },
  });
  document.getElementById("log-speedup").addEventListener("change", (e) => {
    speedupChart.options.scales.x.type = e.target.checked ? "logarithmic" : "linear";
    speedupChart.update();
  });

  new Chart(document.getElementById("chart-stmts"), {
    type: "bar",
    data: {
      labels: charts.stmtCounts.labels,
      datasets: [
        { label: "Old", data: charts.stmtCounts.old, backgroundColor: "#8b949e" },
        { label: "New", data: charts.stmtCounts.new, backgroundColor: "#1a7f37" },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      onClick: makeChartClickHandler(charts.stmtCounts.labels),
      plugins: { legend: { position: "bottom" } },
      scales: { x: { beginAtZero: true } },
    },
  });

  new Chart(document.getElementById("chart-buckets"), {
    type: "doughnut",
    data: {
      labels: charts.applyBuckets.map(b => b.bucket),
      datasets: [{
        data: charts.applyBuckets.map(b => b.count),
        backgroundColor: charts.applyBuckets.map(b => BUCKET_COLORS[b.bucket] || "#656d76"),
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderFilters() {
  const filters = [
    { id: "filter-mismatch", label: "Stmt count differs", test: s => s.stmtCountMismatch },
    { id: "filter-diff", label: "Non-empty diff", test: s => s.hasDiff },
    { id: "filter-not-converge", label: "Not both-converge", test: s => (s.applyCheck?.bucket ?? "not-checked") !== "both-converge" },
    { id: "filter-prove-fail", label: "Prove failed", test: s => s.prove !== undefined && !s.prove.ok },
  ];
  document.getElementById("filters").innerHTML = filters.map(f =>
    '<label><input type="checkbox" id="' + f.id + '" data-filter="' + f.id + '" /> ' + esc(f.label) + '</label>'
  ).join("");
  document.querySelectorAll("#filters input").forEach(cb => {
    cb.addEventListener("change", applyFilters);
  });
}

function applyFilters() {
  const active = [...document.querySelectorAll("#filters input:checked")].map(cb => cb.id);
  const filterFns = {
    "filter-mismatch": s => s.stmtCountMismatch,
    "filter-diff": s => s.hasDiff,
    "filter-not-converge": s => (s.applyCheck?.bucket ?? "not-checked") !== "both-converge",
    "filter-prove-fail": s => s.prove !== undefined && !s.prove.ok,
  };
  payload.scenarios.forEach(s => {
    const show = active.length === 0 || active.every(id => filterFns[id](s));
    const row = document.querySelector('#summary-body tr[data-id="' + s.dirName + '"]');
    const panel = document.getElementById("scenario-" + s.dirName);
    if (row) row.classList.toggle("hidden", !show);
    if (panel) panel.style.display = show ? "" : "none";
  });
}

function renderSummaryTable() {
  const tbody = document.getElementById("summary-body");
  tbody.innerHTML = payload.scenarios.map(s => {
    const bucket = s.applyCheck?.bucket ?? "not-checked";
    const prove = s.prove === undefined ? "n/a" : (s.prove.ok ? "ok" : "FAIL");
    const classes = [s.stmtCountMismatch ? "mismatch" : ""].filter(Boolean).join(" ");
    return '<tr data-id="' + esc(s.dirName) + '" class="' + classes + '">' +
      '<td><a href="#scenario-' + esc(s.dirName) + '">' + esc(s.dirName) + '</a></td>' +
      '<td>' + esc(s.kind) + '</td>' +
      '<td>' + s.metrics.old.statementCount + '</td>' +
      '<td>' + s.metrics.new.statementCount + '</td>' +
      '<td>' + formatMs(s.metrics.timing.oldPlanMs) + ' → ' + formatMs(s.metrics.timing.newPlanMs) + '</td>' +
      '<td>' + (s.speedupRatio > 0 ? s.speedupRatio.toFixed(1) + '×' : '—') + '</td>' +
      '<td>' + bucketBadge(bucket) + '</td>' +
      '<td>' + esc(prove) + '</td>' +
      '<td>' + (s.hasDiff ? "yes" : "no") + '</td></tr>';
  }).join("");
  tbody.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToScenario(a.getAttribute("href").replace("#scenario-", ""));
    });
  });
}

function renderNav() {
  document.getElementById("nav").innerHTML =
    '<h2>Scenarios</h2>' +
    payload.scenarios.map(s => {
      const bucket = s.applyCheck?.bucket ?? "not-checked";
      const color = BUCKET_COLORS[bucket] || "#656d76";
      const short = s.dirName.replace(/^corpus-/, "").replace(/^dbdev-fixture-/, "dbdev-");
      return '<a href="#scenario-' + esc(s.dirName) + '" data-id="' + esc(s.dirName) + '">' +
        '<span class="dot" style="background:' + color + '"></span>' +
        esc(short) + '</a>';
    }).join("");
  document.querySelectorAll("nav a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToScenario(a.dataset.id);
    });
  });
}

function lockClassBar(safety) {
  if (!safety?.lockClasses) return "";
  const lc = safety.lockClasses;
  const total = Object.values(lc).reduce((a, b) => a + b, 0);
  if (total === 0) return "";
  const colors = { accessExclusive: "#cf222e", shareRowExclusive: "#bf8700", share: "#0969da", none: "#656d76" };
  let html = '<div class="mini-chart" title="Lock classes">';
  for (const [k, v] of Object.entries(lc)) {
    if (!v) continue;
    const pct = (100 * v / total).toFixed(1);
    html += '<span style="display:inline-block;height:100%;width:' + pct + '%;background:' + (colors[k]||"#ccc") + '" title="' + k + ': ' + v + '"></span>';
  }
  return html + '</div>';
}

function safetyChips(safety) {
  if (!safety) return "";
  const chips = [];
  if (safety.destructiveActions) chips.push('<span class="chip error">destructive: ' + safety.destructiveActions + '</span>');
  if (safety.rewriteRiskActions) chips.push('<span class="chip warn">rewrite-risk: ' + safety.rewriteRiskActions + '</span>');
  if (safety.nonTransactionalActions) chips.push('<span class="chip warn">non-txn: ' + safety.nonTransactionalActions + '</span>');
  return chips.join("");
}

function renderScenario(s, idx) {
  const bucket = s.applyCheck?.bucket ?? "not-checked";
  const id = s.dirName;
  const maxRows = Math.max(s.metrics.old.statements.length, s.newStatements.length);
  let stmtRows = "";
  for (let i = 0; i < maxRows; i++) {
    stmtRows += '<tr><th>' + (i + 1) + '</th>' +
      '<td><code>' + esc(s.metrics.old.statements[i] ?? "—") + '</code></td>' +
      '<td><code>' + esc(s.newStatements[i] ?? "—") + '</code></td></tr>';
  }
  return '<article class="scenario" id="scenario-' + esc(id) + '" data-idx="' + idx + '">' +
    '<div class="scenario-header">' +
    '<span class="chevron">▶</span>' +
    '<h2>' + esc(id) + '</h2>' +
    bucketBadge(bucket) +
    '<span class="chip">' + s.metrics.old.statementCount + ' → ' + s.metrics.new.statementCount + ' stmts</span>' +
    '<span class="chip">' + formatMs(s.metrics.timing.oldPlanMs) + 'ms → ' + formatMs(s.metrics.timing.newPlanMs) + 'ms</span>' +
    '</div>' +
    '<div class="scenario-body">' +
    (s.planError ? '<div class="error-box">Plan error: ' + esc(s.planError) + '</div>' : '') +
    '<div class="metrics-strip">' +
    '<span class="chip">profile: ' + esc(s.metrics.profile) + '</span>' +
    safetyChips(s.metrics.new.safetyReport) +
    (s.applyCheck?.note ? '<span class="chip warn">' + esc(s.applyCheck.note) + '</span>' : '') +
    '</div>' +
    lockClassBar(s.metrics.new.safetyReport) +
    '<div class="tabs" data-scenario="' + esc(id) + '">' +
    '<button class="tab active" data-tab="side">Side by side</button>' +
    '<button class="tab" data-tab="diff">Unified diff</button>' +
    '<button class="tab" data-tab="stmts">Statements</button>' +
    '</div>' +
    '<div class="tab-panel active" data-panel="side">' +
    '<div class="sql-panes">' +
    '<div class="sql-pane"><div class="pane-label old">old.sql (pg-delta)</div>' +
    '<div class="sql-scroll"><pre class="hljs-sql"><code>' + esc(s.oldSql) + '</code></pre></div></div>' +
    '<div class="sql-pane"><div class="pane-label new">new.sql (pg-delta-next)</div>' +
    '<div class="sql-scroll"><pre class="hljs-sql"><code>' + esc(s.newSql) + '</code></pre></div></div>' +
    '</div></div>' +
    '<div class="tab-panel" data-panel="diff"><div class="diff-container" data-diff="' + idx + '"></div></div>' +
    '<div class="tab-panel" data-panel="stmts"><table class="stmt-table"><thead><tr><th>#</th><th>Old</th><th>New</th></tr></thead><tbody>' +
    stmtRows + '</tbody></table></div>' +
    (s.applyCheck ? '<details class="collapsible"><summary>apply-check.json</summary><pre>' + esc(JSON.stringify(s.applyCheck, null, 2)) + '</pre></details>' : '') +
    (s.prove ? '<details class="collapsible"><summary>prove.json (ok=' + s.prove.ok + ')</summary><pre>' + esc(JSON.stringify(s.prove, null, 2)) + '</pre></details>' : '') +
    '</div></article>';
}

const renderedDiffs = new Set();

function initScenarioPanel(el) {
  const idx = el.dataset.idx;
  el.querySelector(".scenario-header").addEventListener("click", () => {
    el.classList.toggle("open");
    if (el.classList.contains("open")) {
      el.querySelectorAll("pre code").forEach(block => {
        if (typeof hljs !== "undefined") hljs.highlightElement(block);
      });
      const diffEl = el.querySelector('[data-diff="' + idx + '"]');
      if (diffEl && !renderedDiffs.has(idx) && typeof Diff2Html !== "undefined") {
        const s = payload.scenarios[Number(idx)];
        const html = Diff2Html.html(s.sqlDiff, {
          drawFileList: false,
          matching: "lines",
          outputFormat: "side-by-side",
        });
        diffEl.innerHTML = html;
        renderedDiffs.add(idx);
      }
      syncScroll(el);
    }
  });

  el.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = tab.dataset.tab;
      el.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
      el.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
      if (name === "diff" && el.classList.contains("open")) {
        const diffEl = el.querySelector('[data-diff="' + idx + '"]');
        if (diffEl && !renderedDiffs.has(idx) && typeof Diff2Html !== "undefined") {
          const s = payload.scenarios[Number(idx)];
          diffEl.innerHTML = Diff2Html.html(s.sqlDiff, {
            drawFileList: false,
            matching: "lines",
            outputFormat: "side-by-side",
          });
          renderedDiffs.add(idx);
        }
      }
    });
  });
}

function syncScroll(el) {
  const panes = el.querySelectorAll(".sql-scroll");
  if (panes.length !== 2) return;
  let syncing = false;
  panes[0].addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    panes[1].scrollTop = panes[0].scrollTop;
    panes[1].scrollLeft = panes[0].scrollLeft;
    syncing = false;
  });
  panes[1].addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    panes[0].scrollTop = panes[1].scrollTop;
    panes[0].scrollLeft = panes[1].scrollLeft;
    syncing = false;
  });
}

function renderScenarios() {
  const container = document.getElementById("scenarios");
  container.innerHTML = payload.scenarios.map(renderScenario).join("");
  container.querySelectorAll(".scenario").forEach(initScenarioPanel);
}

renderMeta();
renderCards();
renderCharts();
renderFilters();
renderSummaryTable();
renderNav();
renderScenarios();

if (location.hash.startsWith("#scenario-")) {
  scrollToScenario(location.hash.replace("#scenario-", ""));
}
`;
