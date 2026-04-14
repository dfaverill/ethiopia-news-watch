import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

const HOST = process.env.AUTOMATION_WORKER_HOST || "0.0.0.0";
const PORT = Number(
  process.env.PORT || process.env.AUTOMATION_WORKER_PORT || "8787",
);
const AUTH_TOKEN = String(process.env.AUTOMATION_WORKER_TOKEN || "").trim();
const ALLOW_NO_TOKEN = /^(1|true|yes|on)$/i.test(
  String(process.env.AUTOMATION_WORKER_ALLOW_NO_TOKEN || "").trim(),
);
const REQUIRE_TOKEN = !ALLOW_NO_TOKEN;
const BROWSERBASE_API_KEY = String(process.env.BROWSERBASE_API_KEY || "").trim();
const BROWSERBASE_PROJECT_ID = String(process.env.BROWSERBASE_PROJECT_ID || "").trim();

class WorkerError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "WorkerError";
    this.status = status;
  }
}

const TASK_HANDLERS = {
  "collect-facebook-posts": {
    scriptPath: path.join(process.cwd(), "scripts", "collect-facebook-posts.mjs"),
    buildArgs: () => [],
    stdinPayload: (payload) => payload ?? {},
  },
  "extract-facebook-post": {
    scriptPath: path.join(process.cwd(), "scripts", "extract-facebook-post.mjs"),
    buildArgs: (payload) => [String(payload?.url || "")],
    stdinPayload: () => null,
    validate: (payload) => {
      if (!String(payload?.url || "").trim()) {
        throw new WorkerError("Field `url` is required.", 400);
      }
    },
  },
  "collect-x-posts": {
    scriptPath: path.join(process.cwd(), "scripts", "collect-x-posts.mjs"),
    buildArgs: () => [],
    stdinPayload: (payload) => payload ?? {},
  },
  "extract-addis-standard-article": {
    scriptPath: path.join(process.cwd(), "scripts", "extract-addis-standard-article.mjs"),
    buildArgs: (payload) => [String(payload?.url || "")],
    stdinPayload: () => null,
    validate: (payload) => {
      if (!String(payload?.url || "").trim()) {
        throw new WorkerError("Field `url` is required.", 400);
      }
    },
  },
};

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 3_000_000) {
        reject(new WorkerError("Request body too large.", 413));
      }
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(
          error instanceof Error
            ? new WorkerError(error.message, 400)
            : new WorkerError("Invalid JSON body.", 400),
        );
      }
    });
    request.on("error", reject);
  });
}

function listReadinessIssues() {
  const issues = [];

  if (!BROWSERBASE_API_KEY) {
    issues.push("Missing BROWSERBASE_API_KEY.");
  }

  if (!BROWSERBASE_PROJECT_ID) {
    issues.push("Missing BROWSERBASE_PROJECT_ID.");
  }

  if (REQUIRE_TOKEN && !AUTH_TOKEN) {
    issues.push("Missing AUTOMATION_WORKER_TOKEN while token auth is required.");
  }

  return issues;
}

function hasValidToken(request) {
  if (!REQUIRE_TOKEN) {
    return true;
  }

  if (!AUTH_TOKEN) {
    return false;
  }

  const authorization = String(request.headers.authorization || "").trim();
  const bearerPrefix = "Bearer ";

  if (!authorization.startsWith(bearerPrefix)) {
    return false;
  }

  return authorization.slice(bearerPrefix.length).trim() === AUTH_TOKEN;
}

async function runTask(taskName, payload) {
  const task = TASK_HANDLERS[taskName];

  if (!task) {
    throw new WorkerError(`Unknown task: ${taskName}`, 404);
  }

  if (task.validate) {
    task.validate(payload);
  }

  const args = [task.scriptPath, ...task.buildArgs(payload)];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTOMATION_WORKER_URL: "",
      AUTOMATION_WORKER_BASE_URL: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdinPayload = task.stdinPayload(payload);
  if (stdinPayload !== null) {
    child.stdin.write(JSON.stringify(stdinPayload));
  }
  child.stdin.end();

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new WorkerError(
      `Task ${taskName} failed with exit code ${exitCode}. ${stderr.trim().slice(0, 2000)}`,
      502,
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/ready") {
    const issues = listReadinessIssues();
    sendJson(response, issues.length === 0 ? 200 : 503, {
      ok: issues.length === 0,
      service: "automation-worker",
      issues,
    });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "automation-worker",
      taskCount: Object.keys(TASK_HANDLERS).length,
      tokenRequired: REQUIRE_TOKEN,
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!hasValidToken(request)) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }

  const taskMatch = String(request.url || "").match(/^\/tasks\/([^/?#]+)/);
  const taskName = taskMatch?.[1];

  if (!taskName) {
    sendJson(response, 404, { error: "Task route not found." });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const result = await runTask(taskName, payload);
    sendJson(response, 200, { ok: true, result });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status) || 502
        : 502;
    sendJson(response, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      event: "automation_worker_started",
      host: HOST,
      port: PORT,
      taskCount: Object.keys(TASK_HANDLERS).length,
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
