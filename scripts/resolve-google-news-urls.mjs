import { launchAutomationBrowser } from "./lib/automation-browser.mjs";

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      resolve(raw);
    });
  });
}

const input = await readStdin();
const parsed = input ? JSON.parse(input) : {};
const urls = Array.isArray(parsed.urls) ? parsed.urls : [];

if (urls.length === 0) {
  process.stdout.write("[]");
  process.exit(0);
}

const browserSession = await launchAutomationBrowser({
  browserChannel: process.env.NOTEBOOKLM_BROWSER_CHANNEL || "chromium",
  contextKey: "google-news",
  headless: true,
});

try {
  const page = await browserSession.context.newPage();
  const resolved = [];

  for (const sourceUrl of urls) {
    try {
      const targetUrl = String(sourceUrl).replace("/rss/articles/", "/articles/");
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForTimeout(1_200);
      resolved.push({
        sourceUrl,
        resolvedUrl: page.url(),
      });
    } catch {
      resolved.push({
        sourceUrl,
        resolvedUrl: sourceUrl,
      });
    }
  }

  process.stdout.write(JSON.stringify(resolved));
} finally {
  await browserSession.close();
}
