import { launchAutomationBrowser } from "./lib/automation-browser.mjs";
import {
  isAutomationWorkerEnabled,
  runAutomationWorkerTask,
} from "./lib/automation-worker-client.mjs";

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

function unwrapFacebookRedirect(url) {
  try {
    const parsed = new URL(url);
    if (/^l\.facebook\.com$/i.test(parsed.hostname)) {
      const redirect = parsed.searchParams.get("u");
      return redirect ? decodeURIComponent(redirect) : url;
    }

    return url;
  } catch {
    return url;
  }
}

function parseFacebookPublishedAt(value, now) {
  const label = String(value || "").trim().toLowerCase();
  if (!label) {
    return null;
  }

  const direct = Date.parse(label);
  if (Number.isFinite(direct)) {
    return new Date(direct).toISOString();
  }

  const relativeMatch = label.match(
    /^(\d+)\s*(min|mins|minute|minutes|m|hr|hrs|hour|hours|h|day|days|d|week|weeks|wk|wks|w)$/i,
  );
  if (!relativeMatch) {
    return null;
  }

  const amount = Number(relativeMatch[1]);
  const unit = relativeMatch[2];
  const multiplier =
    /^(min|mins|minute|minutes|m)$/i.test(unit)
      ? 60_000
      : /^(hr|hrs|hour|hours|h)$/i.test(unit)
        ? 60 * 60_000
        : /^(day|days|d)$/i.test(unit)
          ? 24 * 60 * 60_000
          : 7 * 24 * 60 * 60_000;

  return new Date(now.getTime() - amount * multiplier).toISOString();
}

const input = await readStdin();
const parsed = input ? JSON.parse(input) : {};
const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
const windowStart = new Date(parsed.windowStart || "").getTime();
const windowEnd = new Date(parsed.windowEnd || "").getTime();

if (isAutomationWorkerEnabled()) {
  const remoteResult = await runAutomationWorkerTask(
    "collect-facebook-posts",
    parsed,
  );
  process.stdout.write(JSON.stringify(Array.isArray(remoteResult) ? remoteResult : []));
  process.exit(0);
}

if (accounts.length === 0 || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
  process.stdout.write("[]");
  process.exit(0);
}

const browserSession = await launchAutomationBrowser({
  browserChannel: process.env.NOTEBOOKLM_BROWSER_CHANNEL || "chromium",
  contextKey: "facebook-public",
  headless: true,
  viewport: { width: 1440, height: 2200 },
});

try {
  const results = [];

  for (const account of accounts) {
    const page = await browserSession.context.newPage();
    await page.setViewportSize({ width: 1440, height: 2200 }).catch(() => undefined);

    try {
      await page.goto(`${account.profileUrl}?sk=posts`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(4_500);

      for (let index = 0; index < 4; index += 1) {
        await page.mouse.wheel(0, 3_200);
        await page.waitForTimeout(1_500);
      }

      const posts = await page.locator('div[role="article"]').evaluateAll((articles) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const dedupeStrings = (values) => [...new Set(values.filter(Boolean))];
        const extracted = [];
        const seen = new Set();

        for (const article of articles) {
          const timeLink =
            article.querySelector('a[href*="/posts/"][aria-label]') ||
            article.querySelector('a[href*="/posts/"] time')?.parentElement ||
            article.querySelector('a[href*="story_fbid"]');
          const href = timeLink?.href || null;
          const time =
            article.querySelector("time")?.getAttribute("datetime") ||
            timeLink?.getAttribute("aria-label") ||
            null;

          if (!href || !time || seen.has(href)) {
            continue;
          }

          seen.add(href);

          const message = dedupeStrings(
            [
              ...article.querySelectorAll('[data-ad-rendering-role="story_message"]'),
              ...article.querySelectorAll('[data-ad-preview="message"]'),
            ].map((node) => normalize(node.textContent)),
          ).join("\n\n");

          const linkBlocks = [...article.querySelectorAll('a[href]')]
            .map((anchor) => ({
              href: anchor.href || "",
              text: normalize(anchor.textContent),
            }))
            .filter((entry) => Boolean(entry.href));

          const externalUrls = dedupeStrings(
            linkBlocks
              .map((entry) => entry.href)
              .filter(
                (candidate) =>
                  /^https?:\/\//i.test(candidate) &&
                  (!/facebook\.com|fb\.watch/i.test(candidate) ||
                    /^https?:\/\/l\.facebook\.com\//i.test(candidate)),
              ),
          );

          const previewText = dedupeStrings(
            linkBlocks
              .map((entry) => entry.text)
              .filter((text) => text.length >= 12 && !/^Like|Comment|Share$/i.test(text)),
          )
            .filter((text) => !message.includes(text))
            .join("\n\n");

          const body =
            normalize([message, previewText].filter(Boolean).join("\n\n")) ||
            normalize(article.textContent);

          extracted.push({
            publishedAt: time,
            url: href,
            body,
            externalUrls,
          });
        }

        return extracted;
      });

      const filtered = posts
        .map((post) => ({
          ...post,
          publishedAt: parseFacebookPublishedAt(post.publishedAt, new Date()),
          externalUrls: post.externalUrls.map((url) => url),
        }))
        .filter((post) => {
          const publishedAt = new Date(post.publishedAt).getTime();
          return Number.isFinite(publishedAt) && publishedAt >= windowStart && publishedAt <= windowEnd;
        })
        .slice(0, 12);

      results.push({
        source: account.source,
        posts: filtered.map((post) => ({
          ...post,
          externalUrls: [...new Set(post.externalUrls.map((url) => unwrapFacebookRedirect(url)))],
        })),
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
  await browserSession.close();
}
