import { chromium } from "playwright";

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
const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
const windowStart = new Date(parsed.windowStart || "").getTime();
const windowEnd = new Date(parsed.windowEnd || "").getTime();

if (accounts.length === 0 || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
  process.stdout.write("[]");
  process.exit(0);
}

const browser = await chromium.launch({
  channel: process.env.NOTEBOOKLM_BROWSER_CHANNEL || "msedge",
  headless: true,
});

try {
  const results = [];

  for (const account of accounts) {
    const page = await browser.newPage();

    try {
      await page.goto(account.profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(4_000);

      for (let index = 0; index < 3; index += 1) {
        await page.mouse.wheel(0, 3_000);
        await page.waitForTimeout(1_500);
      }

      const posts = await page.locator("article").evaluateAll((articles) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const extracted = [];
        const seen = new Set();

        for (const article of articles) {
          const time = article.querySelector("time")?.getAttribute("datetime");
          const links = [...article.querySelectorAll('a[href*="/status/"]')];
          const href =
            links.find((link) => !link.href.endsWith("/analytics"))?.href ?? null;

          if (!time || !href || seen.has(href)) {
            continue;
          }

          seen.add(href);

          const textNode = article.querySelector('[data-testid="tweetText"]');
          const fullText = normalize(textNode?.textContent || article.innerText || "");
          const compactText = fullText
            .split("·")
            .slice(1)
            .join("·")
            .trim();

          extracted.push({
            publishedAt: time,
            url: href,
            body: compactText || fullText,
          });
        }

        return extracted;
      });

      const filtered = posts
        .filter((post) => {
          const publishedAt = new Date(post.publishedAt).getTime();
          return Number.isFinite(publishedAt) && publishedAt >= windowStart && publishedAt <= windowEnd;
        })
        .slice(0, 10);

      results.push({
        source: account.source,
        posts: filtered,
      });
    } catch {
      results.push({
        source: account.source,
        posts: [],
      });
    } finally {
      await page.close();
    }
  }

  process.stdout.write(JSON.stringify(results));
} finally {
  await browser.close();
}
