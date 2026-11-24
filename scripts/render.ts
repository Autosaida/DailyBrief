import "./_env";

import fs from "node:fs";
import path from "node:path";

import {
  renderHtml,
  renderMarkdown,
  type CombinedDailyReport,
} from "../lib/output/render";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

/**
 * Re-render HTML (+ optional Markdown) from a previously saved `<date>.json`
 * without re-fetching APIs or re-calling the LLM.
 *
 * Usage:
 *   npm run render              # today
 *   npm run render -- 2026-11-24
 */
function loadReport(date: string): CombinedDailyReport {
  const file = path.join(OUTPUT_DIR, date, `${date}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Report JSON not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as CombinedDailyReport;
}

async function main() {
  const date = process.argv[2] || todayKey();
  console.log(`[render] re-rendering ${date} from cached data…`);

  const report = loadReport(date);
  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);

  fs.writeFileSync(`${base}.html`, renderHtml(report, date), "utf8");
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date), "utf8");
    console.log(`[render] wrote ${base}.{html,md}`);
  } else {
    console.log(`[render] wrote ${base}.html`);
  }
}

main().catch((e) => {
  console.error("[render] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
