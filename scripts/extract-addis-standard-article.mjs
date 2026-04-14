import path from "node:path";

import { launchAutomationBrowser } from "./lib/automation-browser.mjs";

const url = process.argv[2];

if (!url) {
  console.error("Missing Addis Standard article URL.");
  process.exit(1);
}

const profileDir =
  process.env.ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY ||
  path.join(process.cwd(), ".cache", "addis-standard-profile");
const browserChannel = process.env.ADDIS_STANDARD_BROWSER_CHANNEL || "chromium";
const waitMs = Number(process.env.ADDIS_STANDARD_BROWSER_WAIT_MS || "30000");
const navigationTimeoutMs = Number(
  process.env.ADDIS_STANDARD_BROWSER_TIMEOUT_MS || "60000",
);
const headless =
  !process.env.ADDIS_STANDARD_BROWSER_HEADLESS ||
  !/^(0|false|no)$/i.test(process.env.ADDIS_STANDARD_BROWSER_HEADLESS.trim());

function normalizeParagraphs(values) {
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function extractArticle(page) {
  return page.evaluate(() => {
    const selectorGroups = [
      "article .entry-content p",
      "article p",
      ".entry-content p",
    ];
    let paragraphs = [];

    for (const selector of selectorGroups) {
      const matched = Array.from(document.querySelectorAll(selector))
        .map((node) => node.textContent ?? "")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (matched.length > 0) {
        paragraphs = matched;
        break;
      }
    }

    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.trim() ||
      document.title.trim();
    const imageUrl =
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content")
        ?.trim() ||
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute("content")
        ?.trim() ||
      document.querySelector("article img, .entry-content img")?.src ||
      null;
    const description =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content")
        ?.trim() ||
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
        ?.trim() ||
      null;

    const publishedAt = (() => {
      const candidates = [
        document
          .querySelector('meta[property="article:published_time"]')
          ?.getAttribute("content"),
        document
          .querySelector('meta[name="article:published_time"]')
          ?.getAttribute("content"),
        document
          .querySelector('meta[property="og:updated_time"]')
          ?.getAttribute("content"),
        document.querySelector("time")?.getAttribute("datetime"),
      ].filter(Boolean);

      for (const candidate of candidates) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }

      return null;
    })();

    return {
      body: paragraphs.join("\n\n"),
      description,
      finalUrl: window.location.href,
      imageUrl,
      publishedAt,
      title,
    };
  });
}

function stillNeedsVerification(result) {
  const combined = [result.title, result.description, result.body]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    result.body.trim().length < 180 ||
    /just a moment/i.test(result.title) ||
    /security verification/i.test(combined) ||
    /this website uses a security service/i.test(combined) ||
    /^addisstandard\.com$/i.test(result.title.trim())
  );
}

function buildWarmupUrls(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const urls = new Set([`${parsed.origin}/`]);

    if (parsed.pathname.toLowerCase().startsWith("/afaanoromoo")) {
      urls.add(`${parsed.origin}/Afaanoromoo/`);
    }

    return [...urls];
  } catch {
    return ["https://addisstandard.com/"];
  }
}

async function warmAddisSession(page, targetUrl) {
  for (const warmupUrl of buildWarmupUrls(targetUrl)) {
    try {
      await page.goto(warmupUrl, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      await page.waitForTimeout(3500);
    } catch {}
  }

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
}

let browserSession;

try {
  browserSession = await launchAutomationBrowser({
    browserChannel,
    contextKey: "addis-standard",
    headless,
    launchArgs: ["--disable-blink-features=AutomationControlled"],
    persistentProfileDir: profileDir,
    viewport: { width: 1280, height: 900 },
  });
  const page = browserSession.page;
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  const deadline = Date.now() + waitMs;
  const startedAt = Date.now();
  let result = await extractArticle(page);
  let warmedSession = false;

  while (Date.now() < deadline && stillNeedsVerification(result)) {
    if (!warmedSession && Date.now() - startedAt >= 6000) {
      await warmAddisSession(page, url);
      warmedSession = true;
      result = await extractArticle(page);
      continue;
    }

    await page.waitForTimeout(1500);
    result = await extractArticle(page);
  }

  const normalized = {
    body: normalizeParagraphs(result.body.split(/\n{2,}/)).join("\n\n"),
    description: result.description?.trim() || null,
    finalUrl: result.finalUrl || page.url(),
    imageUrl: result.imageUrl || null,
    publishedAt: result.publishedAt,
    title: result.title?.trim() || page.url(),
  };

  if (stillNeedsVerification(normalized)) {
    throw new Error("Addis Standard article body did not load in the browser session.");
  }

  process.stdout.write(JSON.stringify(normalized));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (browserSession) {
    await browserSession.close();
  }
}
