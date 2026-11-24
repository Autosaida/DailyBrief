import { jsonrepair } from "jsonrepair";
import { isTransientLlmError, sleep } from "../retry";
import { extractJson } from "./json-util";
import { runLlm } from "./llm";
import type { RawArticle } from "../sources/types";

export interface NewsItemInput extends RawArticle {
  source: string;
}

export interface AnalyzedNewsItem {
  url: string;
  source_name: string;
  source_group: string;
  published_at: string;
  title_en: string;
  title_zh: string;
  keep: boolean;
  section: "安全事件与情报" | "安全与协议研究" | "行业与监管动态";
  topic: string;
  summary: string;
  highlights: string[];
  discard_reason?: string;
}

export interface SecurityNewsReport {
  date: string;
  query_date: string;
  source_count: number;
  total_fetched: number;
  kept_count: number;
  filtered_count: number;
  items: AnalyzedNewsItem[];
  filtered_items: AnalyzedNewsItem[];
  model: string;
  generated_at: string;
}

const SYSTEM_PROMPT_SECURITY_NEWS = `你是一名资深的区块链安全研究员与 Web3 行业情报编辑。

你的任务是审阅从 DeFiLlama Hacks、Chainalysis、TRM Labs、SlowMist、BlockSec、PeckShield、Trail of Bits、Zellic、Immunefi、Rekt News、ethresear.ch、Flashbots、Vitalik、a16z Crypto 以及主流加密媒体抓取的前一天候选快讯，完成三项工作：**① 严格去噪**、**② 优先级排序与归类**、**③ 高密度中文提炼**。

### 一、去噪标准（keep: true / false）

以下内容应标记为 \`keep: false\`：
- 纯币价涨跌播报、K 线行情分析、价格预测、Meme 币炒作（如「BTC 今日涨 3%」「某币有望翻倍」）
- 交易所常规上币/下币/促销活动公告、公司营销公关软文、招聘或会议宣传帖
- 无实质技术或安全信息量的水帖/日常闲聊

以下内容应标记为 \`keep: true\`：
- 链上黑客攻击、资金被盗、漏洞披露、漏洞复盘、安全审计发现、钓鱼/供应链攻击、链上追踪与反洗钱/执法调查（如 Chainalysis / TRM / SlowMist / BlockSec / PeckShield / DeFiLlama Hacks / Rekt）
- 智能合约安全研究、协议架构设计、以太坊 EIP / 扩容 / Rollup / MEV / 密码学工程讨论（如 ethresear.ch / Ethereum Magicians / Flashbots / Trail of Bits / Zellic / Vitalik / a16z）
- 对区块链生态有实质影响的重大监管政策、稳定币/基础设施/协议重大升级或事件

对 \`keep: false\` 的条目填写 15-35 字中文 \`discard_reason\`；\`keep: true\` 留空字符串。

### 二、分类与排序规则

每条保留的快讯归入以下 3 个 \`section\` 之一，并按 \`priority\`（1→2→3）从高到低排好 \`items\` 顺序：
1. \`priority: 1\` · \`section: "安全事件与情报"\` — 链上攻击/漏洞事件、黑客复盘、链上犯罪追踪与安全威胁情报（最高优先级）
2. \`priority: 2\` · \`section: "安全与协议研究"\` — 安全研究文章、审计技术、EIP、MEV、扩容与底层协议讨论（次高优先级）
3. \`priority: 3\` · \`section: "行业与监管动态"\` — 重大监管、稳定币、基础设施与生态重要新闻

### 三、中文提炼标准（针对 keep: true）

1. **title_zh**：中性、高信息密度中文标题（≤35 字，去标题党，专有名词与项目名保留英文）。
2. **topic**：自由拟定 1 个贴切的中文短标签（3-8 字，如「链上攻击」「漏洞复盘」「链上追踪」「MEV 研究」「EIP 提案」「监管动态」）。
3. **summary**：60-120 字高密度中文摘要，必须保留关键数字（损失金额、涉案规模、性能数据）、项目名、链名、攻击手法或核心技术观点；禁止编造原文未提及的内容。
4. **highlights**：1-2 条简短关键点（每条 ≤28 字，可选）。

### 输出格式（严格 JSON，不要 markdown 代码块，不要任何前后缀）

{
  "items": [
    {
      "url": "<必须原样复制输入中的 url>",
      "keep": true,
      "priority": 1,
      "section": "安全事件与情报",
      "topic": "<自由拟定的中文短标签>",
      "title_zh": "<中文标题>",
      "summary": "<60-120 字中文摘要>",
      "highlights": ["<关键点1>"],
      "discard_reason": ""
    }
  ]
}

**重要规则**：
- 输入中的每一条快讯都必须在 \`items\` 中出现一次，且 \`url\` 精确回填。
- JSON 字符串内引用一律用中文全角引号「」或 “”，绝对不要使用英文双引号 "。`;

interface RawLlmNewsItem {
  url?: string;
  keep?: boolean;
  priority?: number;
  section?: string;
  topic?: string;
  title_zh?: string;
  summary?: string;
  highlights?: string[];
  discard_reason?: string;
}

interface RawLlmNewsResponse {
  items?: RawLlmNewsItem[];
}

function parseLlmResponse(text: string): RawLlmNewsResponse {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as RawLlmNewsResponse;
  } catch {
    return JSON.parse(jsonrepair(cleaned)) as RawLlmNewsResponse;
  }
}

function normalizeSection(
  raw: string | undefined,
  sourceGroup: string,
): AnalyzedNewsItem["section"] {
  if (
    raw === "安全事件与情报" ||
    raw === "安全与协议研究" ||
    raw === "行业与监管动态"
  ) {
    return raw;
  }
  if (sourceGroup === "安全事件" || sourceGroup === "安全机构") {
    return "安全事件与情报";
  }
  if (sourceGroup === "协议研究") return "安全与协议研究";
  return "行业与监管动态";
}

const BATCH_SIZE = 6;

async function analyzeBatch(
  batch: NewsItemInput[],
): Promise<RawLlmNewsItem[] | null> {
  const payload = batch.map((it, idx) => ({
    n: idx + 1,
    url: it.url,
    source: it.newsSourceName ?? it.source,
    source_group: it.newsSourceGroup ?? "",
    title: it.title,
    excerpt: (it.excerpt ?? "").slice(0, 700),
  }));

  const userPrompt = [
    "**输出语言：仅中文**（项目名、协议名、链名保留英文）。",
    "**响应必须是单一合法 JSON 对象**，以 `{` 开头、以 `}` 结尾，不要 markdown 代码块，不要任何前后解释。",
    `候选快讯共 ${payload.length} 条，请全部在 items 中给出审核结果并按优先级排好顺序，精确回填输入 url：`,
    "",
    JSON.stringify(payload),
  ].join("\n");

  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { text } = await runLlm({
        systemPrompt: SYSTEM_PROMPT_SECURITY_NEWS,
        userPrompt,
        timeoutMs: 240_000,
      });
      const parsed = parseLlmResponse(text);
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new Error("LLM returned empty items array");
      }
      return parsed.items;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[security-news] LLM attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = isTransientLlmError(msg)
          ? Math.min(15_000 * attempt, 45_000)
          : 3_000;
        console.warn(
          `[security-news] backing off ${(waitMs / 1000).toFixed(0)}s before retry…`,
        );
        await sleep(waitMs);
      }
    }
  }
  return null;
}

export async function analyzeSecurityNews(
  items: NewsItemInput[],
  meta: {
    date: string;
    queryDate: string;
    sourceCount: number;
    model: string;
  },
): Promise<SecurityNewsReport> {
  if (items.length === 0) {
    return {
      date: meta.date,
      query_date: meta.queryDate,
      source_count: meta.sourceCount,
      total_fetched: 0,
      kept_count: 0,
      filtered_count: 0,
      items: [],
      filtered_items: [],
      model: meta.model,
      generated_at: new Date().toISOString(),
    };
  }

  const allAiItems: RawLlmNewsItem[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(4_000);
    const slice = items.slice(i, i + BATCH_SIZE);
    const res = await analyzeBatch(slice);
    if (res) allAiItems.push(...res);
  }

  const toBase = (it: NewsItemInput) => ({
    url: it.url,
    source_name: it.newsSourceName ?? it.source,
    source_group: it.newsSourceGroup ?? "行业快讯",
    published_at: it.publishedAt?.toISOString() ?? "",
    title_en: it.title,
  });

  if (allAiItems.length === 0) {
    console.warn(
      "[security-news] all LLM attempts failed, falling back to raw items",
    );
    const fallbackItems: AnalyzedNewsItem[] = items.map((it) => ({
      ...toBase(it),
      title_zh: it.title,
      keep: true,
      section: normalizeSection(undefined, it.newsSourceGroup ?? ""),
      topic: it.newsSourceGroup ?? "快讯",
      summary: (it.excerpt ?? "").slice(0, 260),
      highlights: [],
    }));
    return {
      date: meta.date,
      query_date: meta.queryDate,
      source_count: meta.sourceCount,
      total_fetched: items.length,
      kept_count: fallbackItems.length,
      filtered_count: 0,
      items: fallbackItems,
      filtered_items: [],
      model: meta.model,
      generated_at: new Date().toISOString(),
    };
  }

  const itemByUrl = new Map<string, NewsItemInput>();
  for (const it of items) itemByUrl.set(it.url, it);

  const keptWithPrio: Array<{ entry: AnalyzedNewsItem; prio: number }> = [];
  const filtered: AnalyzedNewsItem[] = [];
  const seenUrls = new Set<string>();

  for (const ai of allAiItems) {
    const url = ai.url?.trim();
    if (!url || seenUrls.has(url)) continue;
    const it = itemByUrl.get(url);
    if (!it) continue;
    seenUrls.add(url);

    const keep = ai.keep !== false;
    const section = normalizeSection(ai.section, it.newsSourceGroup ?? "");
    const defaultPrio =
      section === "安全事件与情报" ? 1 : section === "安全与协议研究" ? 2 : 3;
    const prio =
      ai.priority === 1 || ai.priority === 2 || ai.priority === 3
        ? ai.priority
        : defaultPrio;

    const entry: AnalyzedNewsItem = {
      ...toBase(it),
      title_zh: ai.title_zh?.trim() || it.title,
      keep,
      section,
      topic: ai.topic?.trim() || "快讯",
      summary: ai.summary?.trim() || (it.excerpt ?? "").slice(0, 240),
      highlights: Array.isArray(ai.highlights)
        ? ai.highlights
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .slice(0, 3)
        : [],
      discard_reason: keep
        ? undefined
        : ai.discard_reason?.trim() || "属于常规行情或低技术密度快讯",
    };

    if (keep) keptWithPrio.push({ entry, prio });
    else filtered.push(entry);
  }

  for (const it of items) {
    if (seenUrls.has(it.url)) continue;
    keptWithPrio.push({
      prio: 3,
      entry: {
        ...toBase(it),
        title_zh: it.title,
        keep: true,
        section: normalizeSection(undefined, it.newsSourceGroup ?? ""),
        topic: it.newsSourceGroup ?? "快讯",
        summary: (it.excerpt ?? "").slice(0, 240),
        highlights: [],
      },
    });
  }

  keptWithPrio.sort((a, b) => a.prio - b.prio);
  const kept = keptWithPrio.map((x) => x.entry);

  return {
    date: meta.date,
    query_date: meta.queryDate,
    source_count: meta.sourceCount,
    total_fetched: items.length,
    kept_count: kept.length,
    filtered_count: filtered.length,
    items: kept,
    filtered_items: filtered,
    model: meta.model,
    generated_at: new Date().toISOString(),
  };
}
