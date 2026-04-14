import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import StreamZip from "node-stream-zip";
import { chromium } from "playwright";

const BROWSERBASE_API_BASE_URL =
  process.env.BROWSERBASE_API_BASE_URL || "https://api.browserbase.com/v1";
const DEFAULT_CONTEXT_CACHE_PATH = path.join(
  process.cwd(),
  ".cache",
  "browserbase-contexts.json",
);

function normalizeText(value) {
  return String(value || "").trim();
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(normalizeText(value));
}

function normalizeBrowserChannel(value) {
  const channel = normalizeText(value);
  return !channel || /^chromium$/i.test(channel) ? undefined : channel;
}

function resolveContextCachePath() {
  const configured = normalizeText(process.env.BROWSERBASE_CONTEXT_CACHE_PATH);
  return configured ? path.resolve(configured) : DEFAULT_CONTEXT_CACHE_PATH;
}

function resolveProjectId() {
  return normalizeText(process.env.BROWSERBASE_PROJECT_ID);
}

function resolveApiKey() {
  return normalizeText(process.env.BROWSERBASE_API_KEY);
}

async function readJsonIfExists(filePath, fallbackValue) {
  if (!existsSync(filePath)) {
    return fallbackValue;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonAtomically(filePath, value) {
  const payload = JSON.stringify(value, null, 2);
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, payload, "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code !== "EPERM" && code !== "EBUSY") {
      throw error;
    }

    await writeFile(filePath, payload, "utf8");
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function browserbaseRequest(pathname, init = {}) {
  const apiKey = resolveApiKey();

  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for managed browser sessions.");
  }

  const response = await fetch(`${BROWSERBASE_API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": apiKey,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Browserbase request failed (${response.status} ${response.statusText}): ${body || pathname}`,
    );
  }

  return response;
}

async function getOrCreateBrowserbaseContextId(contextKey) {
  const explicitContextId = normalizeText(process.env.BROWSERBASE_CONTEXT_ID);
  if (explicitContextId) {
    return explicitContextId;
  }

  const cachePath = resolveContextCachePath();
  const cache = await readJsonIfExists(cachePath, {});
  const projectId = resolveProjectId();
  const cacheKey = `${projectId}:${contextKey}`;
  const cachedContextId = normalizeText(cache?.[cacheKey]?.contextId);

  if (cachedContextId) {
    return cachedContextId;
  }

  const response = await browserbaseRequest("/contexts", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const created = await response.json();
  const contextId = normalizeText(created?.id);

  if (!contextId) {
    throw new Error("Browserbase returned an empty context id.");
  }

  cache[cacheKey] = {
    contextId,
    createdAt: new Date().toISOString(),
  };
  await writeJsonAtomically(cachePath, cache);

  return contextId;
}

async function createBrowserbaseSession({
  contextKey,
  headless,
  viewport,
  proxyCountryCode,
  userMetadata,
}) {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("BROWSERBASE_PROJECT_ID is required for managed browser sessions.");
  }

  const persistContext = !isTruthy(process.env.BROWSERBASE_DISABLE_CONTEXT_PERSIST);
  const contextId = persistContext
    ? await getOrCreateBrowserbaseContextId(contextKey)
    : null;
  const region = normalizeText(process.env.BROWSERBASE_REGION);
  const sessionPayload = {
    projectId,
    keepAlive: isTruthy(process.env.BROWSERBASE_KEEP_ALIVE),
    region: region || undefined,
    userMetadata: userMetadata || undefined,
    browserSettings: {
      viewport: viewport || undefined,
      headless,
      context: contextId
        ? {
            id: contextId,
            persist: true,
          }
        : undefined,
      proxies: proxyCountryCode
        ? [
            {
              type: "browserbase",
              geolocation: { country: proxyCountryCode },
            },
          ]
        : undefined,
    },
  };

  const response = await browserbaseRequest("/sessions", {
    method: "POST",
    body: JSON.stringify(sessionPayload),
  });
  const session = await response.json();

  if (!session?.id || !session?.connectUrl) {
    throw new Error("Browserbase session response did not include id/connectUrl.");
  }

  return {
    contextId,
    id: session.id,
    inspectorUrl: `https://browserbase.com/sessions/${session.id}`,
    connectUrl: session.connectUrl,
  };
}

export function isManagedBrowserEnabled() {
  return Boolean(resolveApiKey() && resolveProjectId());
}

export async function launchAutomationBrowser({
  acceptDownloads = false,
  browserChannel,
  contextKey = "default",
  headless = true,
  launchArgs = [],
  persistentProfileDir = null,
  proxyCountryCode = null,
  userMetadata = null,
  viewport = null,
} = {}) {
  if (isManagedBrowserEnabled()) {
    const session = await createBrowserbaseSession({
      contextKey,
      headless,
      proxyCountryCode,
      userMetadata,
      viewport,
    });
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    if (viewport) {
      await page.setViewportSize(viewport).catch(() => undefined);
    }

    if (acceptDownloads) {
      const client = await context.newCDPSession(page);
      await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: "downloads",
        eventsEnabled: true,
      });
    }

    return {
      browser,
      context,
      page,
      session,
      usingManagedBrowser: true,
      async close() {
        await browser.close();
      },
    };
  }

  if (persistentProfileDir) {
    const context = await chromium.launchPersistentContext(persistentProfileDir, {
      channel: normalizeBrowserChannel(browserChannel),
      headless,
      acceptDownloads,
      args: launchArgs,
      viewport: viewport || undefined,
    });
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      browser: null,
      context,
      page,
      session: null,
      usingManagedBrowser: false,
      async close() {
        await context.close();
      },
    };
  }

  const browser = await chromium.launch({
    channel: normalizeBrowserChannel(browserChannel),
    args: launchArgs,
    headless,
  });
  const context = await browser.newContext({
    acceptDownloads,
    viewport: viewport || undefined,
  });
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    session: null,
    usingManagedBrowser: false,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export async function downloadBrowserbaseSessionArchive(
  sessionId,
  retryForMs = 20_000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < retryForMs) {
    const response = await browserbaseRequest(`/sessions/${sessionId}/downloads`, {
      method: "GET",
      headers: {
        "content-type": "application/octet-stream",
      },
    });
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > 22) {
      return buffer;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Browserbase downloads were not available before the retry window expired.");
}

export async function extractBrowserbaseDownloads(sessionId, outputDirectory) {
  const archive = await downloadBrowserbaseSessionArchive(sessionId);
  const archivePath = path.join(outputDirectory, `${sessionId}-downloads.zip`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(archivePath, archive);

  const zip = new StreamZip.async({ file: archivePath });

  try {
    const entries = await zip.entries();
    const extracted = [];

    for (const [entryName, entry] of Object.entries(entries)) {
      if (entry.isDirectory) {
        continue;
      }

      await zip.extract(entryName, outputDirectory);
      extracted.push(path.join(outputDirectory, entryName));
    }

    return extracted;
  } finally {
    await zip.close();
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}
