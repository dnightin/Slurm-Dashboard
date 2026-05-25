const state = {
  data: null,
  timer: null,
  query: ""
};

const IDLE_REFRESH_MS = 60 * 60 * 1000;

const els = {
  clusterHost: document.querySelector("#clusterHost"),
  runningJobs: document.querySelector("#runningJobs"),
  pendingJobs: document.querySelector("#pendingJobs"),
  totalNodes: document.querySelector("#totalNodes"),
  cpuAllocation: document.querySelector("#cpuAllocation"),
  cpuAllocationBar: document.querySelector("#cpuAllocationBar"),
  memoryAllocation: document.querySelector("#memoryAllocation"),
  memoryAllocationBar: document.querySelector("#memoryAllocationBar"),
  lastUpdated: document.querySelector("#lastUpdated"),
  queueBody: document.querySelector("#queueBody"),
  historyBody: document.querySelector("#historyBody"),
  nodeResourceBody: document.querySelector("#nodeResourceBody"),
  nodeResourceCaption: document.querySelector("#nodeResourceCaption"),
  refreshButton: document.querySelector("#refreshButton"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  searchInput: document.querySelector("#searchInput"),
  queueCaption: document.querySelector("#queueCaption"),
  historyCaption: document.querySelector("#historyCaption")
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

function matchesQuery(row) {
  if (!state.query) return true;
  return Object.values(row).join(" ").toLowerCase().includes(state.query);
}

function setSummary(summary) {
  els.runningJobs.textContent = number(summary.runningJobs);
  els.pendingJobs.textContent = number(summary.pendingJobs);
  els.totalNodes.textContent = number(summary.totalNodes);
  const cpuPct = percent(summary.allocatedCpus, summary.totalCpus);
  const memoryPct = percent(summary.allocatedMemoryMb, summary.totalMemoryMb);
  els.cpuAllocation.textContent = `${number(summary.allocatedCpus)} / ${number(summary.totalCpus)} cores (${cpuPct}%)`;
  els.cpuAllocationBar.style.width = `${cpuPct}%`;
  els.memoryAllocation.textContent = `${memory(summary.allocatedMemoryMb)} / ${memory(summary.totalMemoryMb)} (${memoryPct}%)`;
  els.memoryAllocationBar.style.width = `${memoryPct}%`;
}

function renderQueue(jobs) {
  const rows = jobs.filter(matchesQuery);
  els.queueCaption.textContent = state.query
    ? `${number(rows.length)} of ${number(jobs.length)} active jobs match the current search`
    : `${number(jobs.length)} active jobs from squeue`;

  if (!rows.length) {
    els.queueBody.innerHTML = `<tr><td colspan="8" class="empty">${state.query ? "No active jobs match the current search." : "No active jobs are currently queued."}</td></tr>`;
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

function renderHistory(jobs) {
  const rows = jobs.filter(matchesQuery).slice(0, 250);
  els.historyCaption.textContent = state.query
    ? `${number(rows.length)} of ${number(jobs.length)} recent jobs match the current search`
    : `${number(jobs.length)} recent jobs from sacct`;

  if (!rows.length) {
    els.historyBody.innerHTML = `<tr><td colspan="8" class="empty">${state.query ? "No recent accounting rows match the current search." : "No recent accounting rows are available."}</td></tr>`;
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

function renderNodeResources(nodes) {
  const rows = nodes.filter(matchesQuery);
  els.nodeResourceCaption.textContent = state.query
    ? `${number(rows.length)} of ${number(nodes.length)} nodes match the current search`
    : `${number(nodes.length)} nodes from scontrol`;

  if (!rows.length) {
    els.nodeResourceBody.innerHTML = `<tr><td colspan="4" class="empty">${state.query ? "No node allocation rows match the current search." : "No node allocation rows are available from scontrol."}</td></tr>`;
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

function render(data) {
  state.data = data;
  els.clusterHost.textContent = data.host || "Cluster";
  els.lastUpdated.textContent = new Date(data.generatedAt).toLocaleTimeString();
  setSummary(data.summary);
  renderQueue(data.activeJobs || []);
  renderNodeResources(data.nodeResources || []);
  renderHistory(data.recentJobs || []);
}

async function loadCluster() {
  els.lastUpdated.textContent = "Refreshing";

  try {
    const response = await fetch("/api/cluster", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    els.lastUpdated.textContent = "Error";
    els.queueBody.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

function resetTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(loadCluster, IDLE_REFRESH_MS);
}

els.refreshButton.addEventListener("click", loadCluster);
els.clearSearchButton.addEventListener("click", () => {
  els.searchInput.value = "";
  state.query = "";
  if (state.data) render(state.data);
});
els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  if (state.data) render(state.data);
});

resetTimer();
loadCluster();
