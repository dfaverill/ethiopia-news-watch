import {
  REQUEST_RETRY_COUNT,
  REQUEST_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
} from "@/lib/news/constants";

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class FetchTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly attempts: number,
  ) {
    super(`Timed out while fetching ${url} after ${attempts} attempt(s).`);
    this.name = "FetchTimeoutError";
  }
}

export class FetchHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly attempts: number,
  ) {
    super(`HTTP ${status} for ${url} after ${attempts} attempt(s).`);
    this.name = "FetchHttpError";
  }
}

export class FetchNetworkError extends Error {
  constructor(
    public readonly url: string,
    public readonly attempts: number,
    message: string,
  ) {
    super(`Network error for ${url} after ${attempts} attempt(s): ${message}`);
    this.name = "FetchNetworkError";
  }
}

interface FetchTextOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function fetchText(
  url: string,
  init: FetchTextOptions = {},
): Promise<string> {
  const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retries = init.retries ?? REQUEST_RETRY_COUNT;
  const attempts = retries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...DEFAULT_HEADERS,
          ...(init.headers ?? {}),
        },
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const error = new FetchHttpError(url, response.status, attempt);
        if (attempt < attempts && RETRYABLE_HTTP_STATUSES.has(response.status)) {
          lastError = error;
          await sleep(REQUEST_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw error;
      }

      return await response.text();
    } catch (error) {
      if (isAbortError(error)) {
        lastError = new FetchTimeoutError(url, attempt);
      } else if (error instanceof FetchHttpError) {
        lastError = error;
      } else if (error instanceof Error) {
        lastError = new FetchNetworkError(url, attempt, error.message);
      } else {
        lastError = new FetchNetworkError(url, attempt, "Unknown network error.");
      }

      if (
        attempt >= attempts ||
        lastError instanceof FetchHttpError
      ) {
        throw lastError;
      }

      await sleep(REQUEST_RETRY_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new FetchNetworkError(url, attempts, "Unknown network error.");
}
