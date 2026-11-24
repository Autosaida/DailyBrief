export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number.parseInt(header.trim(), 10);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

export interface FetchRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  label?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Fetch with bounded retries and exponential backoff for rate limits (429),
 * temporary server errors (500/502/503/504), Retry-After headers, and
 * transient network failures. Non-retryable 4xx (e.g. 400/401/403/404) are
 * returned immediately so the caller can surface clear diagnostics.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const label = opts.label ?? "fetch";

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!RETRYABLE_STATUSES.has(resp.status) || attempt === maxAttempts) {
        return resp;
      }

      const retryAfterMs = parseRetryAfterMs(resp.headers.get("retry-after"));
      const expDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const waitMs = Math.min(
        Math.max(retryAfterMs ?? expDelay, 1000),
        maxDelayMs,
      );
      console.warn(
        `[${label}] HTTP ${resp.status} (attempt ${attempt}/${maxAttempts}), retrying in ${(waitMs / 1000).toFixed(1)}s…`,
      );
      await sleep(waitMs);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const waitMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${label}] network error (${msg}) (attempt ${attempt}/${maxAttempts}), retrying in ${(waitMs / 1000).toFixed(1)}s…`,
      );
      await sleep(waitMs);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`[${label}] failed after ${maxAttempts} attempts`);
}

export function isTransientLlmError(msg: string): boolean {
  return /429|500|502|503|504|rate.?limit|quota|overloaded|high demand|timeout|timed out|connection error|econnreset|etimedout|fetch failed/i.test(
    msg,
  );
}
