#!/usr/bin/env node
/**
 * Build the static site that gets published to GitHub Pages (or any static
 * host). Run AFTER `npm run daily` has produced today's report.
 *
 * Writes into daily_reports/ (already the publish dir):
 *   - index.html      copy of the latest <date>/<date>.html
 *   - archive.html    table of every <date>/<date>.html, newest first
 *
 * Existing per-date subdirs are left untouched. Idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/build-site.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = "daily_reports";

if (!fs.existsSync(ROOT)) {
  console.error(`[build-site] ${ROOT}/ doesn't exist — run \`npm run daily\` first.`);
  process.exit(1);
}

// Pick up every <YYYY-MM-DD>/<YYYY-MM-DD>.html, newest first.
const dates = fs
  .readdirSync(ROOT)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .filter((d) => fs.existsSync(path.join(ROOT, d, `${d}.html`)))
  .sort((a, b) => b.localeCompare(a));

if (dates.length === 0) {
  console.error(`[build-site] no <YYYY-MM-DD>/<YYYY-MM-DD>.html found in ${ROOT}/`);
  process.exit(1);
}

// --- index.html = latest report ---
const latest = dates[0];
const latestPath = path.join(ROOT, latest, `${latest}.html`);
const latestHtml = fs
  .readFileSync(latestPath, "utf8")
  .replace(/href="\.\.\/archive\.html"/g, 'href="./archive.html"');
fs.writeFileSync(path.join(ROOT, "index.html"), latestHtml, "utf8");
console.log(`[build-site] index.html  ← ${latest}/${latest}.html`);

// --- archive.html = list of all reports ---
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readReportMeta(d) {
  const jsonPath = path.join(ROOT, d, `${d}.json`);
  if (!fs.existsSync(jsonPath)) return { model: "" };
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    return {
      model: typeof data.model === "string" ? data.model.trim() : "",
    };
  } catch {
    return { model: "" };
  }
}

const rows = dates
  .map((d) => {
    const size = (fs.statSync(path.join(ROOT, d, `${d}.html`)).size / 1024).toFixed(0);
    const { model } = readReportMeta(d);
    const modelTag = model
      ? `<span class="model">${escHtml(model)}</span>`
      : "";
    return `      <li><a href="./${d}/${d}.html">${d}</a><span class="right">${modelTag}<span class="size">${size} KB</span></span></li>`;
  })
  .join("\n");

const archiveHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>区块链每日论文追踪 — 历史归档</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", Roboto, Helvetica, Arial, sans-serif;
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.5rem;
    line-height: 1.5;
  }
  h1 { margin-bottom: 0.2rem; font-size: 1.5rem; }
  .meta { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
  ul { list-style: none; padding: 0; }
  li {
    padding: 0.55rem 0;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  @media (prefers-color-scheme: dark) {
    li { border-bottom-color: #2a2a2a; }
  }
  li a { text-decoration: none; font-weight: 500; }
  li a:hover { text-decoration: underline; }
  .right { display: inline-flex; align-items: center; gap: 0.75rem; }
  .model {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.76rem;
    color: #888;
    background: rgba(128, 128, 128, 0.12);
    padding: 0.1rem 0.45rem;
    border-radius: 5px;
  }
  .size { color: #999; font-size: 0.84rem; min-width: 3.4rem; text-align: right; }
  .top {
    margin-bottom: 2rem;
    padding: 0.75rem 1rem;
    background: #f6f6f6;
    border-radius: 6px;
  }
  @media (prefers-color-scheme: dark) {
    .top { background: #1e1e1e; }
  }
</style>
</head>
<body>
  <h1>区块链每日论文追踪 — 历史归档</h1>
  <p class="meta">共 ${dates.length} 期 · 按日期倒序 · 生成于 ${new Date().toISOString().slice(0, 10)}</p>
  <div class="top">
    <a href="./index.html">→ 查看最新一期 (${latest})</a>
  </div>
  <ul>
${rows}
  </ul>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "archive.html"), archiveHtml, "utf8");
console.log(`[build-site] archive.html (${dates.length} dates)`);

// .nojekyll prevents GitHub Pages from running Jekyll, which would otherwise
// strip directories whose names start with "_". We don't have any today but
// it's cheap insurance and standard practice for static-site GH Pages.
fs.writeFileSync(path.join(ROOT, ".nojekyll"), "", "utf8");
console.log(`[build-site] .nojekyll`);
