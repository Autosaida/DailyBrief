import "./_env";

import fs from "node:fs";
import path from "node:path";

import type { AnalyzedArxivPaper } from "../lib/ai/arxiv-blockchain";
import type { AnalyzedNewsItem } from "../lib/ai/security-news";
import type { AnalyzedVenuePaper } from "../lib/ai/venue-papers";
import type { CombinedDailyReport } from "../lib/output/render";
import { fetchWithRetry } from "../lib/retry";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isWeekendDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function renderArxivEmailItem(p: AnalyzedArxivPaper): string {
  const ver = p.version || (p.is_update ? "v2+" : "v1");
  const verLabel = p.is_update ? `${ver} 更新` : `${ver} 新投稿`;
  const verBg = p.is_update ? "#fef3c7" : "#dcfce7";
  const verColor = p.is_update ? "#92400e" : "#166534";
  const authors = p.authors.join(", ");
  const extra = [p.journal_ref, p.comment].filter(Boolean).join(" · ");

  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#ffffff;">
  <div style="margin-bottom:6px;font-size:12px;">
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:${verBg};color:${verColor};font-weight:600;margin-right:6px;">${esc(verLabel)}</span>
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#eff6ff;color:#2563eb;font-weight:500;margin-right:6px;">${esc(p.topic)}</span>
    <span style="color:#6b7280;font-family:monospace;">arXiv:${esc(p.arxiv_id)}</span>
  </div>
  <div style="font-size:15px;font-weight:700;line-height:1.45;margin-bottom:4px;">
    <a href="${esc(p.url)}" style="color:#111827;text-decoration:none;">${esc(p.title_zh)}</a>
  </div>
  <div style="font-size:13px;color:#374151;font-weight:500;margin-bottom:4px;">${esc(p.title_en)}</div>
  ${authors ? `<div style="font-size:12px;color:#0f766e;margin-bottom:6px;"><strong>作者：</strong>${esc(authors)}</div>` : ""}
  ${extra ? `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;"><strong>备注：</strong>${esc(extra)}</div>` : ""}
  <div style="font-size:13.5px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${esc(p.summary)}</div>
  <div style="font-size:12.5px;">
    <a href="${esc(p.url)}" style="color:#2563eb;text-decoration:none;margin-right:12px;">arXiv 摘要页 ↗</a>
    <a href="${esc(p.pdf_url)}" style="color:#2563eb;text-decoration:none;">PDF 原文 ↗</a>
  </div>
</div>`;
}

function renderVenueEmailItem(p: AnalyzedVenuePaper): string {
  const badgeBg = p.venue_tier === "CCF-A" ? "#ede9fe" : "#fce7f3";
  const badgeColor = p.venue_tier === "CCF-A" ? "#5b21b6" : "#9d174d";
  const badgeText =
    p.venue_tier === "CCF-A" ? `${p.venue_abbr} · CCF-A` : p.venue_abbr;
  const authors = p.authors.join(", ");
  const pubMeta = [
    p.pub_date ? `发表 ${p.pub_date}` : "",
    p.created_date ? `入库 ${p.created_date}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#ffffff;">
  <div style="margin-bottom:6px;font-size:12px;">
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:${badgeBg};color:${badgeColor};font-weight:600;margin-right:6px;">${esc(badgeText)}</span>
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#eff6ff;color:#2563eb;font-weight:500;margin-right:6px;">${esc(p.topic)}</span>
    ${pubMeta ? `<span style="color:#6b7280;">${esc(pubMeta)}</span>` : ""}
  </div>
  <div style="font-size:15px;font-weight:700;line-height:1.45;margin-bottom:4px;">
    <a href="${esc(p.url)}" style="color:#111827;text-decoration:none;">${esc(p.title_zh)}</a>
  </div>
  <div style="font-size:13px;color:#374151;font-weight:500;margin-bottom:4px;">${esc(p.title_en)}</div>
  ${authors ? `<div style="font-size:12px;color:#0f766e;margin-bottom:6px;"><strong>作者：</strong>${esc(authors)}</div>` : ""}
  <div style="font-size:13.5px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${esc(p.summary)}</div>
  <div style="font-size:12.5px;">
    <a href="${esc(p.url)}" style="color:#2563eb;text-decoration:none;margin-right:12px;">${p.doi ? "DOI 论文页 ↗" : "论文主页 ↗"}</a>
    ${p.pdf_url ? `<a href="${esc(p.pdf_url)}" style="color:#2563eb;text-decoration:none;">开放获取 PDF ↗</a>` : ""}
  </div>
</div>`;
}

function renderNewsEmailItem(it: AnalyzedNewsItem): string {
  const secBg =
    it.section === "安全事件与情报"
      ? "#fee2e2"
      : it.section === "安全与协议研究"
        ? "#e0f2fe"
        : "#f3f4f6";
  const secColor =
    it.section === "安全事件与情报"
      ? "#991b1b"
      : it.section === "安全与协议研究"
        ? "#075985"
        : "#374151";

  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#ffffff;">
  <div style="margin-bottom:6px;font-size:12px;">
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:${secBg};color:${secColor};font-weight:600;margin-right:6px;">${esc(it.section)}</span>
    <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#eff6ff;color:#2563eb;font-weight:500;margin-right:6px;">${esc(it.topic)}</span>
    <span style="color:#6b7280;">${esc(it.source_name)}</span>
  </div>
  <div style="font-size:15px;font-weight:700;line-height:1.45;margin-bottom:4px;">
    <a href="${esc(it.url)}" style="color:#111827;text-decoration:none;">${esc(it.title_zh)}</a>
  </div>
  ${it.title_en && it.title_en !== it.title_zh ? `<div style="font-size:13px;color:#374151;font-weight:500;margin-bottom:6px;">${esc(it.title_en)}</div>` : ""}
  <div style="font-size:13.5px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${esc(it.summary)}</div>
  <div style="font-size:12.5px;">
    <a href="${esc(it.url)}" style="color:#2563eb;text-decoration:none;">阅读原文 ↗</a>
  </div>
</div>`;
}

function buildEmailHtml(report: CombinedDailyReport, siteUrl: string): string {
  const arxiv = report.arxiv;
  const venues = report.venues;
  const news = report.news;

  const arxivEmptyMsg =
    arxiv.total_fetched === 0
      ? isWeekendDate(arxiv.query_date)
        ? `前一天（${arxiv.query_date}）无新投稿：由于周末 arXiv 通常休刊不发布新公告（数量：0）。`
        : `前一天（${arxiv.query_date}）无新投稿：可能由于当日无匹配投稿、节假日休刊或索引延迟（数量：0）。`
      : `前一天（${arxiv.query_date}）检索到的 ${arxiv.total_fetched} 篇候选论文均已被去噪过滤（保留数量：0）。`;

  const venuesEmptyMsg =
    venues.total_fetched === 0
      ? `前一天（${venues.query_date}）在追踪的 ${venues.venue_count} 个会议与期刊中无新入库论文（数量：0）。`
      : `前一天（${venues.query_date}）新入库的 ${venues.total_fetched} 篇候选论文均已被去噪过滤（保留数量：0）。`;

  const arxivBlock =
    arxiv.papers.length > 0
      ? arxiv.papers.map(renderArxivEmailItem).join("\n")
      : `<div style="padding:14px 16px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280;font-size:13.5px;background:#ffffff;">${esc(arxivEmptyMsg)}</div>`;

  const venuesBlock =
    venues.papers.length > 0
      ? venues.papers.map(renderVenueEmailItem).join("\n")
      : `<div style="padding:14px 16px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280;font-size:13.5px;background:#ffffff;">${esc(venuesEmptyMsg)}</div>`;

  const newsEmptyMsg = !news
    ? "当日未采集安全与行业快讯（数量：0）。"
    : news.total_fetched === 0
      ? `前一天（${news.query_date}）在监控的 ${news.source_count} 个安全机构、研究论坛与行业媒体中无新增快讯（数量：0）。`
      : `前一天（${news.query_date}）抓取的 ${news.total_fetched} 条候选快讯均已被去噪过滤（保留数量：0）。`;

  const newsBlock =
    news && news.items.length > 0
      ? news.items.map(renderNewsEmailItem).join("\n")
      : `<div style="padding:14px 16px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280;font-size:13.5px;background:#ffffff;">${esc(newsEmptyMsg)}</div>`;

  const reportUrl = siteUrl
    ? `${siteUrl.replace(/\/$/, "")}/${report.date}/${report.date}.html`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#111827;">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
    <div style="padding-bottom:14px;border-bottom:1px solid #e5e7eb;margin-bottom:18px;">
      <div style="font-size:20px;font-weight:700;color:#111827;">区块链每日论文追踪 · ${esc(report.date)}</div>
      <div style="font-size:12.5px;color:#6b7280;margin-top:4px;">
        arXiv ${arxiv.kept_count} 篇 · 会议/期刊 ${venues.kept_count} 篇 · 安全与行业快讯 ${news?.kept_count ?? 0} 条
        <span style="font-family:monospace;opacity:0.8;"> · ${esc(report.model)}</span>
      </div>
      ${
        reportUrl
          ? `<div style="margin-top:10px;">
        <a href="${esc(reportUrl)}" style="display:inline-block;padding:6px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">打开完整网页版（含会议筛选与去噪复查）↗</a>
      </div>`
          : ""
      }
    </div>

    <h2 style="font-size:16px;margin:0 0 10px;color:#111827;">1. arXiv 今日论文（区块链）(${arxiv.kept_count})</h2>
    <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">查询日期：${esc(arxiv.query_date)} · 关键词：${esc(arxiv.keywords.join(" / "))}</div>
    ${arxivBlock}

    <h2 style="font-size:16px;margin:24px 0 10px;color:#111827;">2. 会议 / 期刊正式发表论文 (${venues.kept_count})</h2>
    <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">查询 OpenAlex 入库日期：${esc(venues.query_date)} · 追踪 ${venues.venue_count} 个会议与期刊</div>
    ${venuesBlock}

    <h2 style="font-size:16px;margin:24px 0 10px;color:#111827;">3. 安全与行业快讯 (${news?.kept_count ?? 0})</h2>
    <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">查询发布日期：${esc(news?.query_date ?? report.date)} · 监控 ${news?.source_count ?? 0} 个安全机构、研究论坛与行业媒体</div>
    ${newsBlock}

    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      由 DailyBrief 自动生成并推送 · 模型：${esc(report.model)}${
        siteUrl ? ` · <a href="${esc(siteUrl)}" style="color:#6b7280;">访问在线归档</a>` : ""
      }
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const mailToRaw = process.env.MAIL_TO?.trim();
  if (!apiKey || !mailToRaw) {
    console.log(
      "[email] RESEND_API_KEY or MAIL_TO not set — skipping email notification",
    );
    return;
  }

  const date = process.argv[2] || todayKey();
  const reportFile = path.join(OUTPUT_DIR, date, `${date}.json`);
  if (!fs.existsSync(reportFile)) {
    throw new Error(`Report JSON not found: ${reportFile}`);
  }

  const report = JSON.parse(
    fs.readFileSync(reportFile, "utf8"),
  ) as CombinedDailyReport;

  const recipients = mailToRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from =
    process.env.MAIL_FROM?.trim() ||
    "Blockchain Daily Brief <onboarding@resend.dev>";
  const siteUrl =
    process.env.SITE_URL?.trim() ||
    "https://autosaida.github.io/DailyBrief/";

  const newsCount = report.news?.kept_count ?? 0;
  const totalKept =
    report.arxiv.kept_count + report.venues.kept_count + newsCount;
  const subject =
    totalKept === 0
      ? `[区块链每日追踪] ${date} — 今日无新增论文与快讯`
      : `[区块链每日追踪] ${date} — arXiv ${report.arxiv.kept_count} 篇 · 会议/期刊 ${report.venues.kept_count} 篇 · 快讯 ${newsCount} 条`;

  const html = buildEmailHtml(report, siteUrl);

  const resp = await fetchWithRetry(
    RESEND_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
      }),
    },
    {
      maxAttempts: 3,
      baseDelayMs: 3000,
      maxDelayMs: 15_000,
      timeoutMs: 20_000,
      label: "resend",
    },
  );

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`Resend API HTTP ${resp.status}: ${bodyText}`);
  }

  let emailId = "";
  try {
    emailId = (JSON.parse(bodyText) as { id?: string }).id ?? "";
  } catch {
    // ignore
  }
  console.log(
    `[email] sent to ${recipients.join(", ")} — subject="${subject}"${emailId ? ` (id=${emailId})` : ""}`,
  );
}

main().catch((e) => {
  console.error("[email] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
