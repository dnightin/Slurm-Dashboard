const state = {
  data: null,
  timer: null,
  view: "queue",
  filters: {
    queue: "all",
    nodes: "all",
    accounting: "all"
  },
  queries: {
    queue: "",
    nodes: "",
    accounting: ""
  },
  sorts: {
    queue: { key: "state", direction: "asc" },
    nodes: { key: "name", direction: "asc" },
    accounting: { key: "submit", direction: "desc" }
  }
};

const IDLE_REFRESH_MS = 60 * 60 * 1000;

const els = {
  clusterHost: document.querySelector("#clusterHost"),
  lastUpdated: document.querySelector("#lastUpdated"),
  freshnessLabels: Array.from(document.querySelectorAll("[data-freshness]")),
  refreshButtons: Array.from(document.querySelectorAll("[data-refresh]")),
  navButtons: Array.from(document.querySelectorAll("[data-view-target]")),
  views: Array.from(document.querySelectorAll("[data-view]")),
  filterButtons: Array.from(document.querySelectorAll("[data-filter-group]")),
  sortButtons: Array.from(document.querySelectorAll("[data-sort-table]")),

  queueSearchInput: document.querySelector("#queueSearchInput"),
  nodeSearchInput: document.querySelector("#nodeSearchInput"),
  accountingSearchInput: document.querySelector("#accountingSearchInput"),

  queueCaption: document.querySelector("#queueCaption"),
  queueBody: document.querySelector("#queueBody"),
  queueRunning: document.querySelector("#queueRunning"),
  queuePending: document.querySelector("#queuePending"),
  queueBlocked: document.querySelector("#queueBlocked"),
  queueTotal: document.querySelector("#queueTotal"),
  queueCommandAlert: document.querySelector("#queueCommandAlert"),

  nodeResourceCaption: document.querySelector("#nodeResourceCaption"),
  nodeResourceBody: document.querySelector("#nodeResourceBody"),
  nodeGrid: document.querySelector("#nodeGrid"),
  cpuAllocation: document.querySelector("#cpuAllocation"),
  cpuAllocationBar: document.querySelector("#cpuAllocationBar"),
  memoryAllocation: document.querySelector("#memoryAllocation"),
  memoryAllocationBar: document.querySelector("#memoryAllocationBar"),
  nodeTotal: document.querySelector("#nodeTotal"),
  nodeUnavailable: document.querySelector("#nodeUnavailable"),
  nodeCommandAlert: document.querySelector("#nodeCommandAlert"),

  historyCaption: document.querySelector("#historyCaption"),
  historyBody: document.querySelector("#historyBody"),
  accountingCompleted: document.querySelector("#accountingCompleted"),
  accountingFailed: document.querySelector("#accountingFailed"),
  accountingCancelled: document.querySelector("#accountingCancelled"),
  accountingTotal: document.querySelector("#accountingTotal"),
  accountingCommandAlert: document.querySelector("#accountingCommandAlert")
};

function text(value, fallback = "n/a") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function escapeHtml(value) {
  return text(value, "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function percent(allocated, total) {
  return total > 0 ? Math.min(Math.round((allocated / total) * 100), 100) : 0;
}

function memory(value) {
  const mb = Number(value || 0);
  if (mb >= 1024 * 1024) return `${number((mb / 1024 / 1024).toFixed(1))} TB`;
  if (mb >= 1024) return `${number((mb / 1024).toFixed(1))} GB`;
  return `${number(mb)} MB`;
}

function stateClass(value) {
  return text(value, "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizedState(value) {
  return stateClass(value);
}

function rowMatchesQuery(row, query) {
  if (!query) return true;
  return Object.values(row).join(" ").toLowerCase().includes(query);
}

function queueGroup(job) {
  const normalized = normalizedState(job.state);
  if (normalized.includes("run")) return "running";
  if (normalized.includes("pend")) return "pending";
  if (["held", "hold", "suspended", "stopped", "blocked"].some((part) => normalized.includes(part))) return "blocked";
  if (text(job.reason, "").match(/dependency|priority|resources|assoc|qos|license|partition/i)) return "blocked";
  return normalized || "unknown";
}

function nodeGroup(node) {
  const normalized = normalizedState(node.state);
  if (normalized.includes("idle")) return "idle";
  if (normalized.includes("mix")) return "mixed";
  if (normalized.includes("alloc")) return "allocated";
  if (["down", "drain", "fail", "maint", "unknown"].some((part) => normalized.includes(part))) return "down";
  return normalized || "unknown";
}

function accountingGroup(job) {
  const normalized = normalizedState(job.state);
  if (normalized.includes("complete")) return "completed";
  if (normalized.includes("cancel")) return "cancelled";
  if (["fail", "timeout", "nodefail", "oom", "deadline"].some((part) => normalized.includes(part))) return "failed";
  return normalized || "unknown";
}

function compareValues(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

function sortedRows(rows, table) {
  const { key, direction } = state.sorts[table];
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(a[key], b[key]) * multiplier);
}

function getInitialView() {
  const view = window.location.hash.replace(/^#/, "");
  return els.views.some((item) => item.dataset.view === view) ? view : "queue";
}

function setView(view, options = {}) {
  state.view = els.views.some((item) => item.dataset.view === view) ? view : "queue";

  for (const item of els.views) {
    const isActive = item.dataset.view === state.view;
    item.hidden = !isActive;
    item.classList.toggle("view-active", isActive);
  }

  for (const button of els.navButtons) {
    const isActive = button.dataset.viewTarget === state.view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  }

  if (!options.skipHistory) {
    window.history.replaceState(null, "", `#${state.view}`);
  }
}

function setFreshness(generatedAt) {
  const label = generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString()}` : "Waiting";
  els.lastUpdated.textContent = label;
  for (const item of els.freshnessLabels) item.textContent = label;
}

function renderCommandAlert(element, command, label) {
  if (!command || command.ok) {
    element.hidden = true;
    element.textContent = "";
    return;
  }

  element.hidden = false;
  element.textContent = `${label} is unavailable: ${command.error || "command failed"}`;
}

function renderQueueSummary(jobs) {
  els.queueRunning.textContent = number(jobs.filter((job) => queueGroup(job) === "running").length);
  els.queuePending.textContent = number(jobs.filter((job) => queueGroup(job) === "pending").length);
  els.queueBlocked.textContent = number(jobs.filter((job) => queueGroup(job) === "blocked").length);
  els.queueTotal.textContent = number(jobs.length);
}

function renderResourceSummary(summary, nodes) {
  const cpuPct = percent(summary.allocatedCpus, summary.totalCpus);
  const memoryPct = percent(summary.allocatedMemoryMb, summary.totalMemoryMb);
  els.cpuAllocation.textContent = `${number(summary.allocatedCpus)} / ${number(summary.totalCpus)} cores (${cpuPct}%)`;
  els.cpuAllocationBar.style.width = `${cpuPct}%`;
  els.memoryAllocation.textContent = `${memory(summary.allocatedMemoryMb)} / ${memory(summary.totalMemoryMb)} (${memoryPct}%)`;
  els.memoryAllocationBar.style.width = `${memoryPct}%`;
  els.nodeTotal.textContent = number(nodes.length);
  els.nodeUnavailable.textContent = number(nodes.filter((node) => nodeGroup(node) === "down").length);
}

function renderAccountingSummary(jobs) {
  els.accountingCompleted.textContent = number(jobs.filter((job) => accountingGroup(job) === "completed").length);
  els.accountingFailed.textContent = number(jobs.filter((job) => accountingGroup(job) === "failed").length);
  els.accountingCancelled.textContent = number(jobs.filter((job) => accountingGroup(job) === "cancelled").length);
  els.accountingTotal.textContent = number(jobs.length);
}

function renderQueue(jobs) {
  const query = state.queries.queue;
  const filter = state.filters.queue;
  const filtered = jobs
    .filter((job) => filter === "all" || queueGroup(job) === filter)
    .filter((job) => rowMatchesQuery(job, query));
  const rows = sortedRows(filtered, "queue");

  els.queueCaption.textContent = query || filter !== "all"
    ? `${number(rows.length)} of ${number(jobs.length)} active jobs match this view`
    : `${number(jobs.length)} active jobs from squeue`;

  if (!rows.length) {
    els.queueBody.innerHTML = `<tr><td colspan="8" class="empty">${jobs.length ? "No active jobs match this view." : "No active jobs are currently queued."}</td></tr>`;
    return;
  }

  els.queueBody.innerHTML = rows.map((job) => `
    <tr>
      <td><strong>${escapeHtml(job.jobId)}</strong><br><small>${escapeHtml(job.name)}</small></td>
      <td>${escapeHtml(job.user)}</td>
      <td><span class="state ${stateClass(job.state)}">${escapeHtml(job.state)}</span></td>
      <td>${escapeHtml(job.partition)}</td>
      <td>${escapeHtml(job.time)} / ${escapeHtml(job.timeLimit)}</td>
      <td>${escapeHtml(job.cpus)}</td>
      <td>${escapeHtml(job.nodes)}</td>
      <td>${escapeHtml(text(job.reason, "") || text(job.nodeList))}</td>
    </tr>
  `).join("");
}

function renderNodeGrid(rows) {
  if (!rows.length) {
    els.nodeGrid.innerHTML = `<div class="empty">No nodes match this view.</div>`;
    return;
  }

  els.nodeGrid.innerHTML = rows.map((node) => {
    const cpuPct = percent(node.cpuAllocated, node.cpuTotal);
    const memoryPct = percent(node.memoryAllocated, node.memoryTotal);
    return `
      <article class="node-card node-${nodeGroup(node)}">
        <header>
          <strong>${escapeHtml(node.name)}</strong>
          <span class="state ${stateClass(node.state)}">${escapeHtml(node.state)}</span>
        </header>
        <div class="node-metrics">
          <span>CPU ${number(node.cpuAllocated)} / ${number(node.cpuTotal)}</span>
          <div class="bar-track"><div class="bar-fill" style="width: ${cpuPct}%"></div></div>
          <span>Mem ${memory(node.memoryAllocated)} / ${memory(node.memoryTotal)}</span>
          <div class="bar-track"><div class="bar-fill" style="width: ${memoryPct}%"></div></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderNodeResources(nodes) {
  const query = state.queries.nodes;
  const filter = state.filters.nodes;
  const filtered = nodes
    .filter((node) => filter === "all" || nodeGroup(node) === filter)
    .filter((node) => rowMatchesQuery(node, query));
  const rows = sortedRows(filtered, "nodes");

  els.nodeResourceCaption.textContent = query || filter !== "all"
    ? `${number(rows.length)} of ${number(nodes.length)} nodes match this view`
    : `${number(nodes.length)} nodes from scontrol`;

  renderNodeGrid(rows);

  if (!rows.length) {
    els.nodeResourceBody.innerHTML = `<tr><td colspan="4" class="empty">${nodes.length ? "No node allocation rows match this view." : "No node allocation rows are available from scontrol."}</td></tr>`;
    return;
  }

  els.nodeResourceBody.innerHTML = rows.map((node) => {
    const cpuPct = percent(node.cpuAllocated, node.cpuTotal);
    const memoryPct = percent(node.memoryAllocated, node.memoryTotal);

    return `
      <tr>
        <td><strong>${escapeHtml(node.name)}</strong><br><small>${escapeHtml(node.hostname || node.address)}</small></td>
        <td><span class="state ${stateClass(node.state)}">${escapeHtml(node.state)}</span></td>
        <td>
          <div class="metric-cell">
            <span>${number(node.cpuAllocated)} / ${number(node.cpuTotal)} cores</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${cpuPct}%"></div></div>
          </div>
        </td>
        <td>
          <div class="metric-cell">
            <span>${memory(node.memoryAllocated)} / ${memory(node.memoryTotal)}</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${memoryPct}%"></div></div>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderHistory(jobs) {
  const query = state.queries.accounting;
  const filter = state.filters.accounting;
  const filtered = jobs
    .filter((job) => filter === "all" || accountingGroup(job) === filter)
    .filter((job) => rowMatchesQuery(job, query));
  const rows = sortedRows(filtered, "accounting").slice(0, 250);

  els.historyCaption.textContent = query || filter !== "all"
    ? `${number(rows.length)} of ${number(jobs.length)} recent jobs match this view`
    : `${number(jobs.length)} recent jobs from sacct`;

  if (!rows.length) {
    els.historyBody.innerHTML = `<tr><td colspan="8" class="empty">${jobs.length ? "No recent accounting rows match this view." : "No recent accounting rows are available."}</td></tr>`;
    return;
  }

  els.historyBody.innerHTML = rows.map((job) => `
    <tr>
      <td><strong>${escapeHtml(job.jobId)}</strong><br><small>${escapeHtml(job.name)}</small></td>
      <td>${escapeHtml(job.user)}</td>
      <td><span class="state ${stateClass(job.state)}">${escapeHtml(job.state)}</span></td>
      <td>${escapeHtml(job.partition)}</td>
      <td>${escapeHtml(job.elapsed)}</td>
      <td>${escapeHtml(job.totalCpu)}</td>
      <td>${escapeHtml(job.submit)}</td>
      <td>${escapeHtml(job.exitCode)}</td>
    </tr>
  `).join("");
}

function render(data) {
  const activeJobs = data.activeJobs || [];
  const nodes = data.nodeResources || [];
  const recentJobs = data.recentJobs || [];

  state.data = data;
  els.clusterHost.textContent = data.host || "Cluster";
  setFreshness(data.generatedAt);
  renderCommandAlert(els.queueCommandAlert, data.commands && data.commands.squeue, "squeue");
  renderCommandAlert(els.nodeCommandAlert, data.commands && data.commands.scontrol, "scontrol");
  renderCommandAlert(els.accountingCommandAlert, data.commands && data.commands.sacct, "sacct");
  renderQueueSummary(activeJobs);
  renderResourceSummary(data.summary || {}, nodes);
  renderAccountingSummary(recentJobs);
  renderQueue(activeJobs);
  renderNodeResources(nodes);
  renderHistory(recentJobs);
}

async function loadCluster() {
  setFreshness(null);
  els.lastUpdated.textContent = "Refreshing";
  for (const item of els.freshnessLabels) item.textContent = "Refreshing";

  try {
    const response = await fetch("/api/cluster", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    els.lastUpdated.textContent = "Error";
    for (const item of els.freshnessLabels) item.textContent = "Error";
    els.queueCommandAlert.hidden = false;
    els.queueCommandAlert.textContent = error.message;
  }
}

function resetTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(loadCluster, IDLE_REFRESH_MS);
}

function refreshCurrentData() {
  if (state.data) render(state.data);
}

function updateFilterButtons(group) {
  for (const button of els.filterButtons.filter((item) => item.dataset.filterGroup === group)) {
    button.classList.toggle("is-active", button.dataset.filterValue === state.filters[group]);
  }
}

els.refreshButtons.forEach((button) => button.addEventListener("click", loadCluster));
els.queueSearchInput.addEventListener("input", (event) => {
  state.queries.queue = event.target.value.trim().toLowerCase();
  refreshCurrentData();
});
els.nodeSearchInput.addEventListener("input", (event) => {
  state.queries.nodes = event.target.value.trim().toLowerCase();
  refreshCurrentData();
});
els.accountingSearchInput.addEventListener("input", (event) => {
  state.queries.accounting = event.target.value.trim().toLowerCase();
  refreshCurrentData();
});
els.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.dataset.filterGroup;
    state.filters[group] = button.dataset.filterValue;
    updateFilterButtons(group);
    refreshCurrentData();
  });
});
els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const table = button.dataset.sortTable;
    const key = button.dataset.sortKey;
    const current = state.sorts[table];
    state.sorts[table] = {
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    };
    refreshCurrentData();
  });
});
els.navButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});
window.addEventListener("hashchange", () => setView(getInitialView(), { skipHistory: true }));

setView(getInitialView());
resetTimer();
loadCluster();
