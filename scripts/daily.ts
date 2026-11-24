import "./_env";

import fs from "node:fs";
import path from "node:path";

import {
  analyzeArxivBlockchainPapers,
  type ArxivPaperInput,
} from "../lib/ai/arxiv-blockchain";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import {
  analyzeSecurityNews,
  type NewsItemInput,
} from "../lib/ai/security-news";
import {
  analyzeVenuePapers,
  type VenuePaperInput,
} from "../lib/ai/venue-papers";
import {
  renderHtml,
  renderMarkdown,
  type CombinedDailyReport,
} from "../lib/output/render";
import { resolveArxivTargetDate } from "../lib/sources/arxiv-blockchain";
import { fetchSource } from "../lib/sources/dispatch";
import {
  loadVenuesConfig,
  resolveOpenAlexTargetDate,
} from "../lib/sources/openalex-venues";
import { sources } from "../lib/sources/registry";
import {
  loadNewsSourcesConfig,
  resolveNewsTargetDate,
} from "../lib/sources/security-news";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

async function fetchAll(): Promise<
  Array<ArxivPaperInput | VenuePaperInput | NewsItemInput>
> {
  const articles: Array<ArxivPaperInput | VenuePaperInput | NewsItemInput> = [];
  const enabled = sources.filter((s) => s.enabled !== false);
  for (const source of enabled) {
    try {
      const items = await fetchSource(source);
      console.log(`  ${source.id.padEnd(24)} ${items.length}`);
      articles.push(...items.map((it) => ({ ...it, source: source.name })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${source.id.padEnd(24)} FAILED — ${msg}`);
    }
  }
  return articles;
}

async function main() {
  validateBackendCredentials();

  const date = todayKey();
  const arxivQueryDate = resolveArxivTargetDate();
  const venueQueryDate = resolveOpenAlexTargetDate();
  const newsQueryDate = resolveNewsTargetDate();
  console.log(
    `[daily] ${date} — fetching sources (arXiv: ${arxivQueryDate}, OpenAlex: ${venueQueryDate}, News: ${newsQueryDate})…\n`,
  );

  const articles = await fetchAll();
  console.log(`\n[daily] total fetched items: ${articles.length}`);

  const modelTag = getModelTag();

  // 1. arXiv CS blockchain/smart-contract/defi
  const arxivSource = sources.find((s) => s.id === "arxiv-blockchain");
  const arxivPapers = articles.filter(
    (a) => a.sourceId === "arxiv-blockchain",
  ) as ArxivPaperInput[];
  const arxivKeywords = arxivSource?.keywords ?? [
    "blockchain",
    "smart contract",
    "defi",
  ];

  if (arxivPapers.length > 0) {
    console.log(
      `[daily] analyzing ${arxivPapers.length} arXiv CS papers with ${modelTag}…`,
    );
  } else {
    console.log(
      `[daily] 0 arXiv papers for ${arxivQueryDate} — skipping arXiv LLM call`,
    );
  }
  const t0 = Date.now();
  const arxivReport = await analyzeArxivBlockchainPapers(arxivPapers, {
    date,
    queryDate: arxivQueryDate,
    keywords: arxivKeywords,
    model: modelTag,
  });
  if (arxivPapers.length > 0) {
    console.log(
      `[daily] arXiv analysis done in ${((Date.now() - t0) / 1000).toFixed(1)}s — kept ${arxivReport.kept_count}/${arxivReport.total_fetched}, filtered ${arxivReport.filtered_count}`,
    );
  }

  // 2. OpenAlex CCF-A + FC / SIGMETRICS / IMC venues
  const venueSource = sources.find((s) => s.id === "openalex-venues");
  const venuePapers = articles.filter(
    (a) => a.sourceId === "openalex-venues",
  ) as VenuePaperInput[];
  const venueKeywords = venueSource?.keywords ?? [
    "blockchain",
    "smart contract",
    "defi",
  ];
  const venueCount = loadVenuesConfig().length;

  if (venuePapers.length > 0) {
    console.log(
      `[daily] analyzing ${venuePapers.length} venue papers with ${modelTag}…`,
    );
  } else {
    console.log(
      `[daily] 0 venue papers for ${venueQueryDate} — skipping venue LLM call`,
    );
  }
  const t1 = Date.now();
  const venueReport = await analyzeVenuePapers(venuePapers, {
    date,
    queryDate: venueQueryDate,
    keywords: venueKeywords,
    venueCount,
    model: modelTag,
  });
  if (venuePapers.length > 0) {
    console.log(
      `[daily] venue analysis done in ${((Date.now() - t1) / 1000).toFixed(1)}s — kept ${venueReport.kept_count}/${venueReport.total_fetched}, filtered ${venueReport.filtered_count}`,
    );
  }

  // 3. Blockchain security & industry news
  const newsItems = articles.filter(
    (a) => a.sourceId === "security-industry-news",
  ) as NewsItemInput[];
  const newsSourceCount = loadNewsSourcesConfig().filter(
    (s) => s.enabled !== false,
  ).length;

  if (newsItems.length > 0) {
    console.log(
      `[daily] analyzing ${newsItems.length} security/industry news items with ${modelTag}…`,
    );
  } else {
    console.log(
      `[daily] 0 news items for ${newsQueryDate} — skipping news LLM call`,
    );
  }
  const t2 = Date.now();
  const newsReport = await analyzeSecurityNews(newsItems, {
    date,
    queryDate: newsQueryDate,
    sourceCount: newsSourceCount,
    model: modelTag,
  });
  if (newsItems.length > 0) {
    console.log(
      `[daily] news analysis done in ${((Date.now() - t2) / 1000).toFixed(1)}s — kept ${newsReport.kept_count}/${newsReport.total_fetched}, filtered ${newsReport.filtered_count}`,
    );
  }

  const combined: CombinedDailyReport = {
    date,
    model: modelTag,
    generated_at: new Date().toISOString(),
    arxiv: arxivReport,
    venues: venueReport,
    news: newsReport,
  };

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);

  fs.writeFileSync(`${base}.json`, JSON.stringify(combined, null, 2), "utf8");
  fs.writeFileSync(
    `${base}-articles.json`,
    JSON.stringify({ date, articles }, null, 2),
    "utf8",
  );
  fs.writeFileSync(`${base}.html`, renderHtml(combined, date), "utf8");

  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(combined, date), "utf8");
    console.log(`[daily] wrote ${base}.{json,html,md,articles.json}`);
  } else {
    console.log(`[daily] wrote ${base}.{json,html,articles.json}`);
  }

  console.log(`[daily] done.`);
}

main().catch((e) => {
  console.error(`[daily] FAILED:`, e);
  process.exit(1);
});
