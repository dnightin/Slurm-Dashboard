const http = require("http");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 3018);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const COMMAND_TIMEOUT_MS = Number(process.env.SLURM_COMMAND_TIMEOUT_MS || 12000);
const HISTORY_START = process.env.SLURM_HISTORY_START || "now-24hours";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function runCommand(command, args) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    }, (error, stdout, stderr) => {
      resolve({
        command,
        args,
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        error: error ? error.message : "",
        code: error && typeof error.code !== "undefined" ? error.code : 0,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function parsePipeRows(output, columns) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      return columns.reduce((row, column, index) => {
        row[column] = parts[index] || "";
        return row;
      }, {});
    });
}

function parseSqueue(output) {
  return parsePipeRows(output, [
    "jobId",
    "partition",
    "name",
    "user",
    "state",
    "time",
    "timeLimit",
    "nodes",
    "cpus",
    "memory",
    "reason",
    "nodeList"
  ]);
}

function parseSacct(output) {
  return parsePipeRows(output, [
    "jobId",
    "name",
    "user",
    "account",
    "partition",
    "state",
    "elapsed",
    "totalCpu",
    "allocatedCpus",
    "requestedMemory",
    "submit",
    "start",
    "end",
    "nodeList",
    "exitCode"
  ]);
}

function parseSinfo(output) {
  return parsePipeRows(output, [
    "partition",
    "availability",
    "timeLimit",
    "nodes",
    "state",
    "nodeList"
  ]);
}

function parseNodeSummaries(partitions) {
  return partitions.reduce((acc, partition) => {
    const state = normalizeState(partition.state);
    const count = Number.parseInt(partition.nodes, 10) || 0;
    acc.total += count;
    acc.byState[state] = (acc.byState[state] || 0) + count;
    return acc;
  }, { total: 0, byState: {} });
}

function normalizeState(state) {
  return String(state || "unknown")
    .toLowerCase()
    .replace(/[~*+#$@!%^-]+/g, "")
    .trim() || "unknown";
}

function summarizeJobs(activeJobs, recentJobs) {
  const byState = {};
  const users = new Set();
  let running = 0;
  let pending = 0;

  for (const job of activeJobs) {
    const state = normalizeState(job.state);
    byState[state] = (byState[state] || 0) + 1;
    if (job.user) users.add(job.user);
    if (state === "running") running += 1;
    if (state === "pending") pending += 1;
  }

  return {
    active: activeJobs.length,
    recent: recentJobs.length,
    running,
    pending,
    users: users.size,
    byState
  };
}

function commandStatus(results) {
  return Object.fromEntries(Object.entries(results).map(([key, result]) => [key, {
    ok: result.ok,
    command: [result.command, ...result.args].join(" "),
    durationMs: result.durationMs,
    error: result.ok ? "" : (result.stderr || result.error)
  }]));
}

async function collectClusterData() {
  const [squeue, sacct, sinfo] = await Promise.all([
    runCommand("squeue", [
      "-h",
      "-o",
      "%i|%P|%j|%u|%T|%M|%l|%D|%C|%m|%R|%N"
    ]),
    runCommand("sacct", [
      "-n",
      "-P",
      "-S",
      HISTORY_START,
      "-o",
      "JobID,JobName,User,Account,Partition,State,Elapsed,TotalCPU,AllocCPUS,ReqMem,Submit,Start,End,NodeList,ExitCode"
    ]),
    runCommand("sinfo", [
      "-h",
      "-o",
      "%P|%a|%l|%D|%t|%N"
    ])
  ]);

  const activeJobs = squeue.ok ? parseSqueue(squeue.stdout) : [];
  const recentJobs = sacct.ok ? parseSacct(sacct.stdout) : [];
  const partitions = sinfo.ok ? parseSinfo(sinfo.stdout) : [];
  const nodes = parseNodeSummaries(partitions);
  const jobs = summarizeJobs(activeJobs, recentJobs);

  return {
    generatedAt: new Date().toISOString(),
    host: os.hostname(),
    historyStart: HISTORY_START,
    summary: {
      activeJobs: jobs.active,
      recentJobs: jobs.recent,
      runningJobs: jobs.running,
      pendingJobs: jobs.pending,
      activeUsers: jobs.users,
      totalNodes: nodes.total
    },
    jobs,
    nodes,
    activeJobs,
    recentJobs,
    partitions,
    commands: commandStatus({ squeue, sacct, sinfo })
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, error.code === "ENOENT" ? 404 : 500, {
        error: error.code === "ENOENT" ? "Not found" : "Unable to read file"
      });
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(content);
  });
}

function resolvePublicPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decodedPath === "/" ? "/index.html" : decodedPath);
  const requested = path.join(PUBLIC_DIR, normalized);
  const relative = path.relative(PUBLIC_DIR, requested);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return requested;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/api/cluster") {
      sendJson(response, 200, await collectClusterData());
      return;
    }

    if (request.url === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        host: os.hostname()
      });
      return;
    }

    const filePath = resolvePublicPath(request.url || "/");
    if (!filePath) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    sendFile(response, filePath);
  } catch (error) {
    sendJson(response, 500, {
      error: "Unable to collect cluster data",
      detail: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Slurm dashboard listening on http://${HOST}:${PORT}`);
});
