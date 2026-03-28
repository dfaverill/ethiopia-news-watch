type LogLevel = "info" | "warn" | "error" | "debug";

function isDebugEnabled() {
  return process.env.NEWS_WATCH_DEBUG === "1";
}

export function logNewsEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
) {
  if (level === "debug" && !isDebugEnabled()) {
    return;
  }

  const payload = JSON.stringify({
    scope: "ethiopia-news-watch",
    event,
    level,
    timestamp: new Date().toISOString(),
    ...details,
  });

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}
