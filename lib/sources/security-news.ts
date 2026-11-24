import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import { fetchWithRetry } from "../retry";
import { getReportTz, yesterdayKey } from "../utils";
import type { RawArticle } from "./types";

export interface NewsSourceDef {
  id: string;
  name: string;
  type: "rss" | "defillama-hacks";
  url: string;
  group: string;
  enabled?: boolean;
  maxItems?: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWS_CONFIG_PATH = path.resolve(
  __dirname,
  "../..",
  "news-sources.config.json",
);

const parser = new Parser({ timeout: 20_000 });

export function loadNewsSourcesConfig(): NewsSourceDef[] {
  if (!fs.existsSync(NEWS_CONFIG_PATH)) {
    throw new Error(`News sources config missing: ${NEWS_CONFIG_PATH}`);
  }
  return JSON.parse(
    fs.readFileSync(NEWS_CONFIG_PATH, "utf8"),
  ) as NewsSourceDef[];
}

export function resolveNewsTargetDate(): string {
  const override = process.env.NEWS_TARGET_DATE?.trim();
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }
  return yesterdayKey();
}

function dateKeyInTz(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getReportTz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatUsd(amount: number | undefined): string {
  if (!amount || !Number.isFinite(amount)) return "未知金额";
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

interface DefiLlamaHack {
  date?: number; // unix seconds
  name?: string;
  amount?: number;
  chain?: string[];
  classification?: string;
  technique?: string;
  source?: string;
  bridgeHack?: boolean;
  targetType?: string;
}

async function fetchDefiLlamaHacks(
  parentSourceId: string,
  src: NewsSourceDef,
  targetDate: string,
): Promise<RawArticle[]> {
  const resp = await fetchWithRetry(
    src.url,
    {
      headers: {
        "User-Agent": "DailyBrief-News/1.0 (+https://github.com/Autosaida/DailyBrief)",
        Accept: "application/json",
      },
    },
    { maxAttempts: 3, baseDelayMs: 2000, timeoutMs: 25_000, label: src.id },
  );
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  const list = (await resp.json()) as DefiLlamaHack[];
  const out: RawArticle[] = [];

  for (const h of list) {
    if (!h.date || !h.name) continue;
    const dt = new Date(h.date * 1000);
    if (Number.isNaN(dt.getTime())) continue;
    const day = dateKeyInTz(dt);
    const utcDay = dt.toISOString().slice(0, 10);
    if (day !== targetDate && utcDay !== targetDate) continue;

    const chains = Array.isArray(h.chain) ? h.chain.join(", ") : "";
    const loss = formatUsd(h.amount);
    const detail = [
      `受影响项目：${h.name}`,
      `损失金额：${loss}`,
      chains ? `涉及链：${chains}` : "",
      h.classification ? `攻击分类：${h.classification}` : "",
      h.technique ? `攻击手法：${h.technique}` : "",
      h.targetType ? `目标类型：${h.targetType}` : "",
    ]
      .filter(Boolean)
      .join("；");

    out.push({
      sourceId: parentSourceId,
      title: `[Hack] ${h.name} (${loss}${chains ? ` · ${chains}` : ""})`,
      url: h.source?.trim() || "https://defillama.com/hacks",
      excerpt: detail,
      publishedAt: dt,
      category: "tech",
      newsSourceName: src.name,
      newsSourceGroup: src.group,
      queryDate: targetDate,
      matchedDate: targetDate,
      meta: `${src.name} · ${src.group}`,
    });
  }

  return out;
}

const PRICE_NOISE_RE =
  /\b(price\s+(?:analysis|prediction|forecast|outlook|update|rally|drop|surge|plunge)|market\s+wrap|top\s+gainers?|memecoin|meme\s+coin|technical\s+analysis|bull\s+run|bear\s+market\s+signal|daily\s+markets?)\b/i;

async function fetchNewsRss(
  parentSourceId: string,
  src: NewsSourceDef,
  targetDate: string,
): Promise<RawArticle[]> {
  const resp = await fetchWithRetry(
    src.url,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DailyBrief-News/1.0)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    },
    { maxAttempts: 3, baseDelayMs: 2000, timeoutMs: 20_000, label: src.id },
  );
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  const xml = await resp.text();
  const feed = await parser.parseString(xml);

  const out: RawArticle[] = [];
  for (const item of feed.items ?? []) {
    const title = (item.title ?? "").replace(/\s+/g, " ").trim();
    const url = (item.link ?? item.guid ?? "").trim();
    if (!title || !url) continue;
    if (src.group === "行业快讯" && PRICE_NOISE_RE.test(title)) continue;

    const rawDate = item.isoDate || item.pubDate;
    if (!rawDate) continue;
    const dt = new Date(rawDate);
    if (Number.isNaN(dt.getTime())) continue;

    const day = dateKeyInTz(dt);
    if (day !== targetDate) continue;

    const rawBody =
      item.contentSnippet ||
      (item as { summary?: string }).summary ||
      item.content ||
      "";
    const excerpt = stripHtml(rawBody).slice(0, 800);

    out.push({
      sourceId: parentSourceId,
      title,
      url,
      excerpt,
      publishedAt: dt,
      category: "tech",
      newsSourceName: src.name,
      newsSourceGroup: src.group,
      queryDate: targetDate,
      matchedDate: targetDate,
      meta: `${src.name} · ${src.group}`,
    });

    if (src.maxItems && out.length >= src.maxItems) break;
  }

  return out;
}

/**
 * Concurrently fetch previous-day blockchain security & industry news across
 * all enabled sources in `news-sources.config.json`. Per-source errors are
 * non-fatal and logged cleanly.
 */
export async function fetchSecurityIndustryNews(
  parentSourceId: string,
): Promise<RawArticle[]> {
  const allSources = loadNewsSourcesConfig().filter((s) => s.enabled !== false);
  const targetDate = resolveNewsTargetDate();

  const settled = await Promise.all(
    allSources.map(async (src) => {
      try {
        const items =
          src.type === "defillama-hacks"
            ? await fetchDefiLlamaHacks(parentSourceId, src, targetDate)
            : await fetchNewsRss(parentSourceId, src, targetDate);
        return items;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[security-news] ${src.id} failed (non-fatal): ${msg}`);
        return [] as RawArticle[];
      }
    }),
  );

  const seenUrls = new Set<string>();
  const combined: RawArticle[] = [];
  for (const list of settled) {
    for (const item of list) {
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      combined.push(item);
    }
  }

  // Sort newest first before handing to LLM
  combined.sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );

  return combined;
}
