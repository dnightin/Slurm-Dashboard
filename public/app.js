const state = {
  data: null,
  timer: null,
  query: ""
};

const els = {
  clusterHost: document.querySelector("#clusterHost"),
  runningJobs: document.querySelector("#runningJobs"),
  pendingJobs: document.querySelector("#pendingJobs"),
  activeJobs: document.querySelector("#activeJobs"),
  recentJobs: document.querySelector("#recentJobs"),
  activeUsers: document.querySelector("#activeUsers"),
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
  partitionList: document.querySelector("#partitionList"),
  nodeStates: document.querySelector("#nodeStates"),
  commandHealth: document.querySelector("#commandHealth"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshSelect: document.querySelector("#refreshSelect"),
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
  els.activeJobs.textContent = number(summary.activeJobs);
  els.recentJobs.textContent = number(summary.recentJobs);
  els.activeUsers.textContent = number(summary.activeUsers);
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
  els.queueCaption.textContent = `${number(rows.length)} active jobs from squeue`;

  if (!rows.length) {
    els.queueBody.innerHTML = `<tr><td colspan="8" class="empty">No active jobs match the current view.</td></tr>`;
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
  els.historyCaption.textContent = `${number(rows.length)} recent jobs from sacct`;

  if (!rows.length) {
    els.historyBody.innerHTML = `<tr><td colspan="8" class="empty">No recent accounting rows match the current view.</td></tr>`;
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
  els.nodeResourceCaption.textContent = `${number(rows.length)} nodes from scontrol`;

  if (!rows.length) {
    els.nodeResourceBody.innerHTML = `<tr><td colspan="7" class="empty">No node allocation rows match the current view.</td></tr>`;
    return;
  }

  els.nodeResourceBody.innerHTML = rows.map((node) => {
    const cpuPct = percent(node.cpuAllocated, node.cpuTotal);
    const memoryPct = percent(node.memoryAllocated, node.memoryTotal);

    return `
      <tr>
        <td><strong>${escapeHtml(node.name)}</strong><br><small>${escapeHtml(node.hostname || node.address)}</small></td>
        <td><span class="state ${stateClass(node.state)}">${escapeHtml(node.state)}</span></td>
        <td>${escapeHtml(node.partition)}</td>
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
        <td>${escapeHtml(node.gresUsed || node.gres)}</td>
        <td>${escapeHtml(node.reason)}</td>
      </tr>
    `;
  }).join("");
}

function renderPartitions(partitions) {
  if (!partitions.length) {
    els.partitionList.innerHTML = `<div class="empty">No partition data available.</div>`;
    return;
  }

  els.partitionList.innerHTML = partitions.map((partition) => `
    <article class="list-item">
      <header>
        <span>${escapeHtml(text(partition.partition).replace("*", ""))}</span>
        <span class="pill">${escapeHtml(text(partition.nodes, "0"))} nodes</span>
      </header>
      <small>${escapeHtml(partition.state)} · ${escapeHtml(partition.availability)} · limit ${escapeHtml(partition.timeLimit)}</small>
      <small>${escapeHtml(partition.nodeList)}</small>
    </article>
  `).join("");
}

function renderNodeStates(nodes) {
  const entries = Object.entries(nodes.byState || {}).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    els.nodeStates.innerHTML = `<div class="empty">No node state data available.</div>`;
    return;
  }

  els.nodeStates.innerHTML = entries.map(([name, count]) => {
    const percent = nodes.total ? Math.round((count / nodes.total) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${escapeHtml(name)}</span><span>${number(count)} (${percent}%)</span></div>
        <div class="bar-track"><div class="bar-fill" style="width: ${percent}%"></div></div>
      </div>
    `;
  }).join("");
}

function renderCommands(commands) {
  els.commandHealth.innerHTML = Object.entries(commands).map(([name, command]) => `
    <article class="list-item">
      <header>
        <span class="status"><span class="dot ${command.ok ? "good" : "bad"}"></span>${escapeHtml(name)}</span>
        <span class="pill">${number(command.durationMs)}ms</span>
      </header>
      <small>${escapeHtml(command.command)}</small>
      ${command.error ? `<small>${escapeHtml(command.error)}</small>` : ""}
    </article>
  `).join("");
}

function render(data) {
  state.data = data;
  els.clusterHost.textContent = data.host || "Cluster";
  els.lastUpdated.textContent = new Date(data.generatedAt).toLocaleTimeString();
  setSummary(data.summary);
  renderQueue(data.activeJobs || []);
  renderNodeResources(data.nodeResources || []);
  renderHistory(data.recentJobs || []);
  renderPartitions(data.partitions || []);
  renderNodeStates(data.nodes || { total: 0, byState: {} });
  renderCommands(data.commands || {});
}

async function loadCluster() {
  els.lastUpdated.textContent = "Refreshing";

  try {
    const response = await fetch("/api/cluster", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    els.lastUpdated.textContent = "Error";
    els.commandHealth.innerHTML = `
      <article class="list-item">
        <header><span class="status"><span class="dot bad"></span>dashboard</span></header>
        <small>${escapeHtml(error.message)}</small>
      </article>
    `;
  }
}

function resetTimer() {
  if (state.timer) clearInterval(state.timer);
  const interval = Number(els.refreshSelect.value);
  if (interval > 0) {
    state.timer = setInterval(loadCluster, interval);
  }
}

els.refreshButton.addEventListener("click", loadCluster);
els.refreshSelect.addEventListener("change", resetTimer);
els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  if (state.data) render(state.data);
});

resetTimer();
loadCluster();
