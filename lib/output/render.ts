import type {
  AnalyzedArxivPaper,
  ArxivBlockchainReport,
} from "../ai/arxiv-blockchain";
import type {
  AnalyzedNewsItem,
  SecurityNewsReport,
} from "../ai/security-news";
import type {
  AnalyzedVenuePaper,
  VenuePapersReport,
} from "../ai/venue-papers";
import { getReportTz } from "../utils";

export interface CombinedDailyReport {
  date: string;
  model: string;
  generated_at: string;
  arxiv: ArxivBlockchainReport;
  venues: VenuePapersReport;
  news?: SecurityNewsReport;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: getReportTz() || "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(dt);
}

function isWeekendDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function renderArxivCard(p: AnalyzedArxivPaper): string {
  const cats = p.categories
    .map((c) => `<span class="tag tag-cat">${esc(c)}</span>`)
    .join("");
  const ver = p.version || (p.is_update ? "v2+" : "v1");
  const versionBadge = p.is_update
    ? `<span class="tag tag-update" title="初版日期：${esc(p.created_date || "")}">${esc(ver)} 更新</span>`
    : `<span class="tag tag-new">${esc(ver)} 新投稿</span>`;
  const highlights =
    p.highlights.length > 0
      ? `<ul class="highlights">${p.highlights
          .map((h) => `<li>${esc(h)}</li>`)
          .join("")}</ul>`
      : "";
  const authors = p.authors.join(", ");
  const extraNotes = [p.journal_ref, p.comment].filter(Boolean).join(" · ");

  return `<article class="paper-card">
  <div class="paper-meta-row">
    ${versionBadge}
    <span class="tag tag-topic">${esc(p.topic)}</span>
    ${cats}
    ${p.arxiv_id ? `<span class="paper-id">arXiv:${esc(p.arxiv_id)}</span>` : ""}
  </div>
  <h3 class="paper-title-zh">
    <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title_zh)}</a>
  </h3>
  <div class="paper-title-en">${esc(p.title_en)}</div>
  ${authors ? `<div class="paper-authors"><span class="authors-label">作者：</span>${esc(authors)}</div>` : ""}
  ${extraNotes ? `<div class="paper-comment"><span class="comment-label">备注：</span>${esc(extraNotes)}</div>` : ""}
  <p class="paper-summary">${esc(p.summary)}</p>
  ${highlights}
  <div class="paper-actions">
    <a class="btn-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">arXiv 摘要页 ↗</a>
    <a class="btn-link btn-pdf" href="${esc(p.pdf_url)}" target="_blank" rel="noopener noreferrer">PDF 原文 ↗</a>
  </div>
</article>`;
}

function renderVenueCard(p: AnalyzedVenuePaper): string {
  const tierBadge =
    p.venue_tier === "CCF-A"
      ? `<span class="tag tag-venue-ccfa">${esc(p.venue_abbr)} · CCF-A</span>`
      : `<span class="tag tag-venue-custom">${esc(p.venue_abbr)}</span>`;
  const highlights =
    p.highlights.length > 0
      ? `<ul class="highlights">${p.highlights
          .map((h) => `<li>${esc(h)}</li>`)
          .join("")}</ul>`
      : "";
  const authors = p.authors.join(", ");
  const pubMeta = [
    p.venue_name && p.venue_name !== p.venue_abbr ? p.venue_name : "",
    p.pub_date ? `发表 ${p.pub_date}` : "",
    p.created_date ? `入库 ${p.created_date}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<article class="paper-card venue-card" data-venue="${esc(p.venue_abbr)}">
  <div class="paper-meta-row">
    ${tierBadge}
    <span class="tag tag-topic">${esc(p.topic)}</span>
    ${p.pub_date ? `<span class="paper-id">${esc(p.pub_date)}</span>` : ""}
  </div>
  <h3 class="paper-title-zh">
    <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title_zh)}</a>
  </h3>
  <div class="paper-title-en">${esc(p.title_en)}</div>
  ${authors ? `<div class="paper-authors"><span class="authors-label">作者：</span>${esc(authors)}</div>` : ""}
  ${pubMeta ? `<div class="paper-comment"><span class="comment-label">出处：</span>${esc(pubMeta)}</div>` : ""}
  <p class="paper-summary">${esc(p.summary)}</p>
  ${highlights}
  <div class="paper-actions">
    <a class="btn-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${p.doi ? "DOI 论文页 ↗" : "论文主页 ↗"}</a>
    ${p.pdf_url ? `<a class="btn-link btn-pdf" href="${esc(p.pdf_url)}" target="_blank" rel="noopener noreferrer">开放获取 PDF ↗</a>` : ""}
  </div>
</article>`;
}

function renderFilteredList(
  filtered: Array<{
    url: string;
    title_zh: string;
    title_en: string;
    authors: string[];
    discard_reason?: string;
    badge?: string;
  }>,
): string {
  if (filtered.length === 0) return "";
  const rows = filtered
    .map(
      (p) => `<li class="filtered-item">
  <div class="filtered-head">
    ${p.badge ? `<span class="tag tag-cat" style="margin-right:0.4rem">${esc(p.badge)}</span>` : ""}
    <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title_zh)}</a>
  </div>
  <div class="filtered-en">${esc(p.title_en)}</div>
  ${p.authors.length > 0 ? `<div class="filtered-authors">${esc(p.authors.join(", "))}</div>` : ""}
  <div class="filtered-reason">去噪原因：${esc(p.discard_reason || "相关度较低")}</div>
</li>`,
    )
    .join("\n");

  return `<details class="filtered-box">
  <summary>已去噪过滤论文（${filtered.length} 篇）— 点击展开复查</summary>
  <ul class="filtered-list">
${rows}
  </ul>
</details>`;
}

function renderArxivPanel(arxiv: ArxivBlockchainReport): string {
  let emptyReason = "";
  if (arxiv.total_fetched === 0) {
    emptyReason = isWeekendDate(arxiv.query_date)
      ? `前一天（${arxiv.query_date}）无新投稿：由于周末 arXiv 通常休刊不发布新公告（数量：0）。`
      : `前一天（${arxiv.query_date}）无新投稿：可能由于 arXiv 当日无匹配投稿、节假日休刊或索引延迟（数量：0）。`;
  } else if (arxiv.papers.length === 0) {
    emptyReason = `前一天（${arxiv.query_date}）检索到的 ${arxiv.total_fetched} 篇候选论文均已被去噪过滤，可在下方折叠区展开查看。`;
  }

  const papersHtml =
    arxiv.papers.length > 0
      ? arxiv.papers.map(renderArxivCard).join("\n")
      : `<div class="empty-state">${esc(emptyReason)}</div>`;

  return `<div class="stats-row">
    <span class="stat-pill">检索候选 <strong>${arxiv.total_fetched}</strong> 篇</span>
    <span class="stat-pill">保留 <strong>${arxiv.kept_count}</strong> 篇</span>
    <span class="stat-pill">去噪过滤 <strong>${arxiv.filtered_count}</strong> 篇</span>
    <span class="stat-pill">关键词 <strong>${esc(arxiv.keywords.join(" / "))}</strong></span>
  </div>
  <div class="date-notice">查询日期：<code>${esc(arxiv.query_date)}</code>（arXiv OAI-PMH <code>set=cs</code> 全量增量检索，含新投稿与版本更新）</div>
  <div class="paper-list">
    ${papersHtml}
  </div>
  ${renderFilteredList(arxiv.filtered_papers)}`;
}

function renderVenuesPanel(venues: VenuePapersReport): string {
  const venueOrder: string[] = [];
  const venueCounts = new Map<string, number>();
  for (const p of venues.papers) {
    if (!venueCounts.has(p.venue_abbr)) venueOrder.push(p.venue_abbr);
    venueCounts.set(p.venue_abbr, (venueCounts.get(p.venue_abbr) ?? 0) + 1);
  }

  const subTabsHtml =
    venueOrder.length > 0
      ? `<div class="subtab-bar" id="venueSubtabBar">
  <button class="subtab-btn active" data-venue-filter="ALL">全部 (${venues.papers.length})</button>
  ${venueOrder
    .map(
      (abbr) =>
        `<button class="subtab-btn" data-venue-filter="${esc(abbr)}">${esc(abbr)} (${venueCounts.get(abbr) ?? 0})</button>`,
    )
    .join("\n  ")}
</div>`
      : "";

  let emptyReason = "";
  if (venues.total_fetched === 0) {
    emptyReason = `前一天（${venues.query_date}）在追踪的 ${venues.venue_count} 个会议与期刊中无新入库论文（数量：0）。`;
  } else if (venues.papers.length === 0) {
    emptyReason = `前一天（${venues.query_date}）新入库的 ${venues.total_fetched} 篇候选论文均已被去噪过滤（保留数量：0），可在下方折叠区展开查看。`;
  }

  const papersHtml =
    venues.papers.length > 0
      ? venues.papers.map(renderVenueCard).join("\n")
      : `<div class="empty-state">${esc(emptyReason)}</div>`;

  return `<div class="stats-row">
    <span class="stat-pill">追踪会议 / 期刊 <strong>${venues.venue_count}</strong> 个</span>
    <span class="stat-pill">新入库候选 <strong>${venues.total_fetched}</strong> 篇</span>
    <span class="stat-pill">保留 <strong>${venues.kept_count}</strong> 篇</span>
    <span class="stat-pill">去噪过滤 <strong>${venues.filtered_count}</strong> 篇</span>
  </div>
  <div class="date-notice">查询 OpenAlex 入库日期：<code>${esc(venues.query_date)}</code></div>
  ${subTabsHtml}
  <div class="paper-list" id="venuePaperList">
    ${papersHtml}
  </div>
  ${renderFilteredList(
    venues.filtered_papers.map((p) => ({
      ...p,
      badge: p.venue_abbr,
    })),
  )}`;
}

function renderNewsCard(it: AnalyzedNewsItem): string {
  const secClass =
    it.section === "安全事件与情报"
      ? "tag-sec-alert"
      : it.section === "安全与协议研究"
        ? "tag-sec-research"
        : "tag-sec-industry";
  const highlights =
    it.highlights.length > 0
      ? `<ul class="highlights">${it.highlights
          .map((h) => `<li>${esc(h)}</li>`)
          .join("")}</ul>`
      : "";
  const timeStr = it.published_at ? it.published_at.slice(0, 10) : "";

  return `<article class="paper-card news-card" data-news-section="${esc(it.section)}">
  <div class="paper-meta-row">
    <span class="tag ${secClass}">${esc(it.section)}</span>
    <span class="tag tag-topic">${esc(it.topic)}</span>
    <span class="tag tag-cat">${esc(it.source_name)}</span>
    ${timeStr ? `<span class="paper-id">${esc(timeStr)}</span>` : ""}
  </div>
  <h3 class="paper-title-zh">
    <a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.title_zh)}</a>
  </h3>
  ${it.title_en && it.title_en !== it.title_zh ? `<div class="paper-title-en">${esc(it.title_en)}</div>` : ""}
  <p class="paper-summary">${esc(it.summary)}</p>
  ${highlights}
  <div class="paper-actions">
    <a class="btn-link" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
  </div>
</article>`;
}

function renderNewsPanel(news: SecurityNewsReport | undefined, fallbackDate: string): string {
  if (!news) {
    return `<div class="empty-state">当日未采集安全与行业快讯（数量：0）。</div>`;
  }

  const sectionOrder: AnalyzedNewsItem["section"][] = [
    "安全事件与情报",
    "安全与协议研究",
    "行业与监管动态",
  ];
  const counts = new Map<string, number>();
  for (const it of news.items) {
    counts.set(it.section, (counts.get(it.section) ?? 0) + 1);
  }
  const activeSections = sectionOrder.filter((s) => (counts.get(s) ?? 0) > 0);

  const subTabsHtml =
    activeSections.length > 0
      ? `<div class="subtab-bar" id="newsSubtabBar">
  <button class="subtab-btn active" data-news-filter="ALL">全部 (${news.items.length})</button>
  ${activeSections
    .map(
      (sec) =>
        `<button class="subtab-btn" data-news-filter="${esc(sec)}">${esc(sec)} (${counts.get(sec) ?? 0})</button>`,
    )
    .join("\n  ")}
</div>`
      : "";

  let emptyReason = "";
  if (news.total_fetched === 0) {
    emptyReason = `前一天（${news.query_date || fallbackDate}）在监控的 ${news.source_count} 个安全机构、研究论坛与行业媒体中无新增快讯（数量：0）。`;
  } else if (news.items.length === 0) {
    emptyReason = `前一天（${news.query_date || fallbackDate}）抓取的 ${news.total_fetched} 条候选快讯均已被去噪过滤（保留数量：0），可在下方折叠区展开复查。`;
  }

  const cardsHtml =
    news.items.length > 0
      ? news.items.map(renderNewsCard).join("\n")
      : `<div class="empty-state">${esc(emptyReason)}</div>`;

  return `<div class="stats-row">
    <span class="stat-pill">监控信源 <strong>${news.source_count}</strong> 个</span>
    <span class="stat-pill">前日候选 <strong>${news.total_fetched}</strong> 条</span>
    <span class="stat-pill">保留 <strong>${news.kept_count}</strong> 条</span>
    <span class="stat-pill">去噪过滤 <strong>${news.filtered_count}</strong> 条</span>
  </div>
  <div class="date-notice">查询发布日期：<code>${esc(news.query_date || fallbackDate)}</code>（覆盖链上攻击事件、安全情报机构、核心协议研究论坛与主流行业媒体）</div>
  ${subTabsHtml}
  <div class="paper-list" id="newsItemList">
    ${cardsHtml}
  </div>
  ${renderFilteredList(
    news.filtered_items.map((it) => ({
      url: it.url,
      title_zh: it.title_zh,
      title_en: it.title_en,
      authors: [],
      discard_reason: it.discard_reason,
      badge: it.source_name,
    })),
  )}`;
}

export function renderHtml(report: CombinedDailyReport, date: string): string {
  const dateLabel = formatDateLabel(date);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>区块链每日论文追踪 · ${esc(date)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa;
    --card: #ffffff;
    --border: #e5e7eb;
    --text: #111827;
    --title-en: #374151;
    --authors: #0f766e;
    --muted: #6b7280;
    --accent: #2563eb;
    --accent-soft: #eff6ff;
    --tag-bg: #f3f4f6;
    --notice-bg: #f0f9ff;
    --notice-border: #bae6fd;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1117;
      --card: #171b24;
      --border: #262c3a;
      --text: #f3f4f6;
      --title-en: #d1d5db;
      --authors: #5eead4;
      --muted: #9ca3af;
      --accent: #60a5fa;
      --accent-soft: #1e293b;
      --tag-bg: #232938;
      --notice-bg: #112236;
      --notice-border: #1e3a5f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.65;
  }
  .wrap {
    max-width: 920px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1rem;
    padding-bottom: 1.15rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 1.25rem;
  }
  h1 {
    margin: 0;
    font-size: 1.65rem;
    letter-spacing: -0.02em;
  }
  .subtitle {
    margin: 0.25rem 0 0;
    color: var(--muted);
    font-size: 0.92rem;
  }
  .model-subtle {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    color: var(--muted);
    opacity: 0.78;
    margin-left: 0.45rem;
  }
  .archive-link {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .archive-link:hover { text-decoration: underline; }

  /* Primary Tabs */
  .primary-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-bottom: 1.4rem;
  }
  .primary-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    border-radius: 10px;
    padding: 0.6rem 1.1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .primary-tab:hover { border-color: var(--accent); color: var(--accent); }
  .primary-tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #ffffff;
  }
  .tab-badge {
    display: inline-block;
    min-width: 1.4rem;
    text-align: center;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    background: var(--tag-bg);
    color: var(--text);
  }
  .primary-tab.active .tab-badge {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
  }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* Secondary Venue Sub-tabs */
  .subtab-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .subtab-btn {
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.84rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .subtab-btn:hover { border-color: var(--accent); color: var(--accent); }
  .subtab-btn.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-bottom: 1rem;
  }
  .stat-pill {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
    font-size: 0.84rem;
    color: var(--muted);
  }
  .stat-pill strong { color: var(--text); }
  .date-notice {
    background: var(--notice-bg);
    border: 1px solid var(--notice-border);
    border-radius: 10px;
    padding: 0.65rem 1rem;
    font-size: 0.88rem;
    margin-bottom: 1.35rem;
  }
  .date-notice code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
  .paper-list {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }
  .paper-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem 1.35rem;
  }
  .paper-meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
  }
  .tag {
    display: inline-block;
    font-size: 0.78rem;
    padding: 0.15rem 0.55rem;
    border-radius: 6px;
    font-weight: 500;
  }
  .tag-topic {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .tag-new {
    background: #dcfce7;
    color: #166534;
  }
  .tag-update {
    background: #fef3c7;
    color: #92400e;
  }
  .tag-venue-ccfa {
    background: #ede9fe;
    color: #5b21b6;
    font-weight: 600;
  }
  .tag-venue-custom {
    background: #fce7f3;
    color: #9d174d;
    font-weight: 600;
  }
  .tag-sec-alert {
    background: #fee2e2;
    color: #991b1b;
    font-weight: 600;
  }
  .tag-sec-research {
    background: #e0f2fe;
    color: #075985;
    font-weight: 600;
  }
  .tag-sec-industry {
    background: #f3f4f6;
    color: #374151;
    font-weight: 600;
  }
  @media (prefers-color-scheme: dark) {
    .tag-new { background: #14532d; color: #86efac; }
    .tag-update { background: #451a03; color: #fcd34d; }
    .tag-venue-ccfa { background: #3b0764; color: #ddd6fe; }
    .tag-venue-custom { background: #500724; color: #fbcfe8; }
    .tag-sec-alert { background: #7f1d1d; color: #fecaca; }
    .tag-sec-research { background: #0c4a6e; color: #bae6fd; }
    .tag-sec-industry { background: #374151; color: #e5e7eb; }
  }
  .tag-cat {
    background: var(--tag-bg);
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .paper-id {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .paper-title-zh {
    margin: 0 0 0.3rem;
    font-size: 1.12rem;
    line-height: 1.45;
  }
  .paper-title-zh a {
    color: var(--text);
    text-decoration: none;
  }
  .paper-title-zh a:hover { color: var(--accent); text-decoration: underline; }
  .paper-title-en {
    font-size: 0.9rem;
    color: var(--title-en);
    font-weight: 500;
    margin-bottom: 0.4rem;
    line-height: 1.5;
  }
  .paper-authors {
    font-size: 0.84rem;
    color: var(--authors);
    margin-bottom: 0.5rem;
    line-height: 1.55;
  }
  .authors-label, .comment-label { font-weight: 600; }
  .paper-comment {
    font-size: 0.82rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
    line-height: 1.5;
  }
  .paper-summary {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
  }
  .highlights {
    margin: 0 0 0.85rem;
    padding-left: 1.2rem;
    font-size: 0.88rem;
    color: var(--muted);
  }
  .highlights li { margin-bottom: 0.25rem; }
  .paper-actions {
    display: flex;
    gap: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px dashed var(--border);
  }
  .btn-link {
    font-size: 0.84rem;
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  .btn-link:hover { text-decoration: underline; }
  .empty-state {
    background: var(--card);
    border: 1px dashed var(--border);
    border-radius: 12px;
    padding: 2rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .filtered-box {
    margin-top: 2rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.9rem 1.2rem;
  }
  .filtered-box summary {
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--muted);
    font-weight: 500;
  }
  .filtered-list {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .filtered-item {
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .filtered-head {
    font-size: 0.92rem;
    font-weight: 500;
  }
  .filtered-head a { color: var(--text); text-decoration: none; }
  .filtered-head a:hover { color: var(--accent); text-decoration: underline; }
  .filtered-en { font-size: 0.84rem; color: var(--title-en); margin-top: 0.15rem; }
  .filtered-authors { font-size: 0.8rem; color: var(--authors); margin-top: 0.15rem; }
  .filtered-reason { font-size: 0.84rem; color: var(--muted); margin-top: 0.3rem; }
  footer {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.82rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>区块链每日论文追踪</h1>
      <p class="subtitle">${esc(dateLabel)} <span class="model-subtle" title="当日生成所用大模型">· ${esc(report.model)}</span></p>
    </div>
    <a class="archive-link" href="../archive.html">← 历史归档</a>
  </header>

  <nav class="primary-tabs" id="primaryTabs" role="tablist">
    <button class="primary-tab active" data-tab="arxiv" role="tab" aria-selected="true">
      arXiv 今日论文（区块链）
      <span class="tab-badge">${report.arxiv.kept_count}</span>
    </button>
    <button class="primary-tab" data-tab="venues" role="tab" aria-selected="false">
      会议 / 期刊正式发表论文
      <span class="tab-badge">${report.venues.kept_count}</span>
    </button>
    <button class="primary-tab" data-tab="news" role="tab" aria-selected="false">
      安全与行业快讯
      <span class="tab-badge">${report.news?.kept_count ?? 0}</span>
    </button>
  </nav>

  <section class="tab-panel active" id="panel-arxiv" role="tabpanel">
    ${renderArxivPanel(report.arxiv)}
  </section>

  <section class="tab-panel" id="panel-venues" role="tabpanel">
    ${renderVenuesPanel(report.venues)}
  </section>

  <section class="tab-panel" id="panel-news" role="tabpanel">
    ${renderNewsPanel(report.news, date)}
  </section>

  <footer>
    <span>数据来源：arXiv OAI-PMH · OpenAlex · 安全机构与行业 RSS · 仅作研究摘要与去噪参考</span>
    <span>模型：${esc(report.model)}</span>
  </footer>
</div>

<script>
(function() {
  const primaryBar = document.getElementById("primaryTabs");
  if (primaryBar) {
    const tabs = primaryBar.querySelectorAll(".primary-tab");
    const panels = document.querySelectorAll(".tab-panel");
    primaryBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".primary-tab");
      if (!btn) return;
      const target = btn.getAttribute("data-tab");
      tabs.forEach((t) => {
        const active = t === btn;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", String(active));
      });
      panels.forEach((p) => {
        p.classList.toggle("active", p.id === "panel-" + target);
      });
    });
  }

  const subBar = document.getElementById("venueSubtabBar");
  if (subBar) {
    const btns = subBar.querySelectorAll(".subtab-btn");
    const cards = document.querySelectorAll(".venue-card");
    subBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".subtab-btn");
      if (!btn) return;
      const filter = btn.getAttribute("data-venue-filter");
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      cards.forEach((c) => {
        const show = filter === "ALL" || c.getAttribute("data-venue") === filter;
        c.style.display = show ? "" : "none";
      });
    });
  }
  const newsSubBar = document.getElementById("newsSubtabBar");
  if (newsSubBar) {
    const btns = newsSubBar.querySelectorAll(".subtab-btn");
    const cards = document.querySelectorAll(".news-card");
    newsSubBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".subtab-btn");
      if (!btn) return;
      const filter = btn.getAttribute("data-news-filter");
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      cards.forEach((c) => {
        const show = filter === "ALL" || c.getAttribute("data-news-section") === filter;
        c.style.display = show ? "" : "none";
      });
    });
  }
})();
</script>
</body>
</html>`;
}

export function renderMarkdown(
  report: CombinedDailyReport,
  date: string,
): string {
  const lines: string[] = [
    `# 区块链每日论文追踪 (${date})`,
    "",
    `## arXiv 今日论文（区块链）(${report.arxiv.kept_count})`,
    "",
    `- 查询日期：${report.arxiv.query_date} · 候选 ${report.arxiv.total_fetched} 篇 · 保留 ${report.arxiv.kept_count} 篇 · 过滤 ${report.arxiv.filtered_count} 篇`,
    "",
  ];

  if (report.arxiv.papers.length === 0) {
    lines.push(`前一天（${report.arxiv.query_date}）无新投稿（数量：0）。`, "");
  } else {
    for (const p of report.arxiv.papers) {
      lines.push(`### [${p.is_update ? `${p.version} 更新` : `${p.version} 新投稿`}] [${p.topic}] ${p.title_zh}`);
      lines.push(`- 英文原标题：${p.title_en}`);
      if (p.authors.length > 0) lines.push(`- 作者：${p.authors.join(", ")}`);
      if (p.comment) lines.push(`- 备注：${p.comment}`);
      lines.push(`- 链接：${p.url} | [PDF](${p.pdf_url})`);
      lines.push(`- 解读：${p.summary}`);
      for (const h of p.highlights) lines.push(`  - ${h}`);
      lines.push("");
    }
  }

  lines.push(
    `## 会议 / 期刊正式发表论文 (${report.venues.kept_count})`,
    "",
    `- 查询入库日期：${report.venues.query_date} · 追踪 ${report.venues.venue_count} 个会议与期刊 · 候选 ${report.venues.total_fetched} 篇 · 保留 ${report.venues.kept_count} 篇`,
    "",
  );

  if (report.venues.papers.length === 0) {
    lines.push(`前一天（${report.venues.query_date}）在追踪的顶会中无新入库论文（数量：0）。`, "");
  } else {
    for (const p of report.venues.papers) {
      lines.push(`### [${p.venue_abbr}] [${p.topic}] ${p.title_zh}`);
      lines.push(`- 英文原标题：${p.title_en}`);
      if (p.authors.length > 0) lines.push(`- 作者：${p.authors.join(", ")}`);
      lines.push(`- 链接：${p.url}${p.pdf_url ? ` | [PDF](${p.pdf_url})` : ""}`);
      lines.push(`- 解读：${p.summary}`);
      for (const h of p.highlights) lines.push(`  - ${h}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
