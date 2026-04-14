import { launchAutomationBrowser } from "./lib/automation-browser.mjs";

function normalize(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

const targetUrl = process.argv[2];

if (!targetUrl) {
  process.stdout.write("");
  process.exit(0);
}

const browserSession = await launchAutomationBrowser({
  browserChannel: process.env.NOTEBOOKLM_BROWSER_CHANNEL || "chromium",
  contextKey: "facebook-public",
  headless: true,
  viewport: { width: 1440, height: 2200 },
});

try {
  const page = await browserSession.context.newPage();
  await page.setViewportSize({ width: 1440, height: 2200 }).catch(() => undefined);

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(4_500);

  const extracted = await page.evaluate(() => {
    const normalizeLocal = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const dedupeStrings = (values) => [
      ...new Set(values.map((value) => normalizeLocal(value)).filter(Boolean)),
    ];

    const article = document.querySelector('div[role="article"]') || document.body;
    const timeLink =
      article.querySelector('a[href*="/posts/"][aria-label]') ||
      article.querySelector('a[href*="/posts/"] time')?.parentElement ||
      article.querySelector('a[href*="story_fbid"]') ||
      article.querySelector('a[aria-label][href*="facebook.com"]');
    const time =
      article.querySelector("time")?.getAttribute("datetime") ||
      timeLink?.getAttribute("aria-label") ||
      null;

    const message = dedupeStrings(
      [
        ...article.querySelectorAll('[data-ad-rendering-role="story_message"]'),
        ...article.querySelectorAll('[data-ad-preview="message"]'),
      ].map((node) => node.textContent),
    ).join("\n\n");

    const linkBlocks = [...article.querySelectorAll('a[href]')]
      .map((anchor) => ({
        href: anchor.href || "",
        text: normalizeLocal(anchor.textContent),
      }))
      .filter((entry) => Boolean(entry.href));

    const externalUrls = [
      ...new Set(
        linkBlocks
          .map((entry) => entry.href)
          .filter(
            (candidate) =>
              /^https?:\/\//i.test(candidate) &&
              (!/facebook\.com|fb\.watch/i.test(candidate) ||
                /^https?:\/\/l\.facebook\.com\//i.test(candidate)),
          ),
      ),
    ];

    const previewText = dedupeStrings(
      linkBlocks
        .map((entry) => entry.text)
        .filter((text) => text.length >= 12 && !/^Like|Comment|Share$/i.test(text)),
    )
      .filter((text) => !message.includes(text))
      .join("\n\n");

    const body =
      normalizeLocal([message, previewText].filter(Boolean).join("\n\n")) ||
      normalizeLocal(article.textContent);

    return {
      body,
      externalUrls,
      publishedAt: time,
      title:
        normalizeLocal(document.querySelector("meta[property='og:title']")?.content) ||
        normalizeLocal(document.title) ||
        normalizeLocal(message.split("\n")[0]),
    };
  });

  const result = {
    body: extracted.body,
    externalUrls: [...new Set(extracted.externalUrls.map((url) => unwrapFacebookRedirect(url)))],
    finalUrl: page.url(),
    publishedAt: parseFacebookPublishedAt(extracted.publishedAt, new Date()),
    title: normalize(extracted.title),
  };

  process.stdout.write(JSON.stringify(result));
  await page.close();
} finally {
  await browserSession.close();
}
