const DEFAULT_REQUEST_TIMEOUT_MS = Number(
  process.env.AUTOMATION_WORKER_TIMEOUT_MS || "120000",
);

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveWorkerBaseUrl() {
  const configured =
    normalizeText(process.env.AUTOMATION_WORKER_URL) ||
    normalizeText(process.env.AUTOMATION_WORKER_BASE_URL);
  return configured.replace(/\/+$/, "");
}

export function isAutomationWorkerEnabled() {
  return Boolean(resolveWorkerBaseUrl());
}

export async function runAutomationWorkerTask(task, payload) {
  const baseUrl = resolveWorkerBaseUrl();

  if (!baseUrl) {
    throw new Error("AUTOMATION_WORKER_URL is not configured.");
  }

  const endpoint = `${baseUrl}/tasks/${encodeURIComponent(task)}`;
  const token = normalizeText(process.env.AUTOMATION_WORKER_TOKEN);
  const headers = {
    "content-type": "application/json",
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(
        `Automation worker request failed (${response.status} ${response.statusText}): ${raw.slice(0, 500)}`,
      );
    }

    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "result" in parsed
    ) {
      return parsed.result ?? null;
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}
