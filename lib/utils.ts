/**
 * Resolve the timezone used for date-keyed filenames AND for date strings
 * rendered in HTML. Defaults to the system local timezone — set
 * `REPORT_TZ` (any IANA name, e.g. "America/Los_Angeles", "Europe/Berlin",
 * "Asia/Shanghai", or "UTC") to override.
 *
 * Lazy on purpose: `scripts/daily.ts` loads `.env.local` AFTER its
 * imports execute, so capturing the value at module init would freeze it
 * before dotenv has run. Each call site reads `process.env` fresh.
 */
export function getReportTz(): string | undefined {
  return process.env.REPORT_TZ?.trim() || undefined;
}

export function todayKey(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: getReportTz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * Return the calendar date (YYYY-MM-DD) immediately preceding `todayKey(d)`
 * in the active REPORT_TZ.
 */
export function yesterdayKey(d: Date = new Date()): string {
  const today = todayKey(d);
  const [y, m, day] = today.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day - 1));
  return utc.toISOString().slice(0, 10);
}
