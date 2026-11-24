import { jsonrepair } from "jsonrepair";
import { isTransientLlmError, sleep } from "../retry";
import { extractJson } from "./json-util";
import { runLlm } from "./llm";
import type { RawArticle } from "../sources/types";

export interface VenuePaperInput extends RawArticle {
  source: string;
}

export interface AnalyzedVenuePaper {
  url: string;
  doi?: string;
  pdf_url?: string;
  title_en: string;
  title_zh: string;
  authors: string[];
  venue_abbr: string;
  venue_name: string;
  venue_tier: string;
  pub_date?: string;
  created_date?: string;
  keep: boolean;
  topic: string;
  summary: string;
  highlights: string[];
  discard_reason?: string;
}

export interface VenuePapersReport {
  date: string;
  query_date: string;
  keywords: string[];
  venue_count: number;
  total_fetched: number;
  kept_count: number;
  filtered_count: number;
  papers: AnalyzedVenuePaper[];
  filtered_papers: AnalyzedVenuePaper[];
  model: string;
  generated_at: string;
}

const SYSTEM_PROMPT_VENUE_PAPERS = `你是一名资深的区块链与智能合约计算机科学研究员兼专业中文学术编辑。

你的任务是审阅从 CCF-A 顶级会议以及 FC、SIGMETRICS、IMC 新入库的候选论文，完成三项工作：**① 专业去噪**、**② 优先级排序**、**③ 专业中文学术解读**。

### 一、去噪标准（keep: true / false）

以下类型的论文应标记为 \`keep: false\`：
- 仅把「区块链」当作背景词、信任锚点或轻量存储挂名的跨界应用水文（如智慧农业/医疗病历/6G 车联网/普通物联网/普通联邦学习激励/电力或能源业务流程拼接等，对区块链协议、智能合约、DeFi 或 Web3 核心系统本身缺乏实质技术贡献）
- 泛泛而谈的概念综述

其余与区块链、智能合约、DeFi、Web3 核心技术或实证研究有实质关联的论文一律标记为 \`keep: true\`；
对 \`keep: false\` 的论文填写 15-35 字中文 \`discard_reason\`；\`keep: true\` 留空字符串。

### 二、排序规则（决定 items 数组的输出顺序）

请直接按以下优先级从高到低排列 \`items\`（高优先级排在前面，低优先级排在后面）：
1. **高优先级（排在前面）**：与**区块链应用层、安全、软件工程、实证度量（measurement）**等方向相关的论文；
2. **低优先级（排在后面）**：偏向 **infra（底层基础设施）、共识协议、密码学原语**方向的论文。

### 三、中文学术解读标准（针对 keep: true 的论文）

1. **title_zh**：精准、专业的中文标题（≤35 字，专有名词与协议名保留英文）。
2. **topic**：根据论文实际内容自由拟定 1 个最贴切的中文短标签（4-10 字，不受固定列表限制）。
3. **summary**：100-160 字高密度中文学术解读，涵盖：
   - 解决什么核心问题或痛点
   - 提出什么方法、架构或技术手段
   - 关键实验结果、性能指标或核心发现（摘要里有量化数据请保留；若摘要缺失则仅基于标题客观概括，严禁编造）
   - 禁止用「本文研究了…」「这篇文章提出…」等废话开头。
4. **highlights**：2-3 条简短核心亮点（每条 ≤28 字，直击创新点或量化指标）。

### 输出格式（严格 JSON，不要 markdown 代码块，不要任何前后缀）

{
  "items": [
    {
      "url": "<必须原样复制输入中的 url>",
      "keep": true,
      "priority": 1,
      "topic": "<自由拟定的贴切中文短标签>",
      "title_zh": "<专业中文标题>",
      "summary": "<100-160 字中文学术解读>",
      "highlights": ["<亮点1>", "<亮点2>"],
      "discard_reason": ""
    }
  ]
}

（注：\`priority\` 为 \`1\` 表示高优先级：应用层/安全/软件工程/实证度量；\`2\` 表示低优先级：infra/共识/密码学，仅用于内部排序。）

**重要规则**：
- 输入中的每一篇候选论文都必须在 \`items\` 数组中出现一次（不要遗漏），且 \`url\` 必须原样精确回填。
- 请直接按「排序规则」排好 \`items\` 的先后顺序。
- JSON 字符串内的引用一律使用中文全角引号「」或 “”，绝对不要使用英文双引号 "，避免 JSON 解析失败。`;

interface RawLlmItem {
  url?: string;
  keep?: boolean;
  priority?: number; // 1 = high (app/security/SE/measurement), 2 = low (infra/consensus/crypto); internal sort only
  topic?: string;
  title_zh?: string;
  summary?: string;
  highlights?: string[];
  discard_reason?: string;
}

interface RawLlmResponse {
  items?: RawLlmItem[];
}

function parseLlmResponse(text: string): RawLlmResponse {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as RawLlmResponse;
  } catch {
    return JSON.parse(jsonrepair(cleaned)) as RawLlmResponse;
  }
}

const BATCH_SIZE = 8;

async function analyzeBatch(
  batch: VenuePaperInput[],
): Promise<RawLlmItem[] | null> {
  const payload = batch.map((p, idx) => ({
    n: idx + 1,
    url: p.url,
    venue: p.venueAbbr ?? "",
    title: p.title,
    authors: p.authors ?? [],
    abstract: (p.excerpt ?? "").slice(0, 1800),
  }));

  const userPrompt = [
    "**输出语言：仅中文**（专有名词、协议名、指标缩写保留英文）。",
    "**响应必须是单一合法 JSON 对象**，以 `{` 开头、以 `}` 结尾，不要 markdown 代码块，不要任何前后解释。",
    `候选顶会论文共 ${payload.length} 篇，请全部在 items 中给出结果，并按优先级从高到低排好顺序，精确回填输入 url：`,
    "",
    JSON.stringify(payload),
  ].join("\n");

  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { text } = await runLlm({
        systemPrompt: SYSTEM_PROMPT_VENUE_PAPERS,
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
        `[openalex-venues] LLM attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = isTransientLlmError(msg)
          ? Math.min(15_000 * attempt, 45_000)
          : 3_000;
        console.warn(
          `[openalex-venues] backing off ${(waitMs / 1000).toFixed(0)}s before retry…`,
        );
        await sleep(waitMs);
      }
    }
  }
  return null;
}

export async function analyzeVenuePapers(
  papers: VenuePaperInput[],
  meta: {
    date: string;
    queryDate: string;
    keywords: string[];
    venueCount: number;
    model: string;
  },
): Promise<VenuePapersReport> {
  if (papers.length === 0) {
    return {
      date: meta.date,
      query_date: meta.queryDate,
      keywords: meta.keywords,
      venue_count: meta.venueCount,
      total_fetched: 0,
      kept_count: 0,
      filtered_count: 0,
      papers: [],
      filtered_papers: [],
      model: meta.model,
      generated_at: new Date().toISOString(),
    };
  }

  const allAiItems: RawLlmItem[] = [];
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(4_000);
    const slice = papers.slice(i, i + BATCH_SIZE);
    const res = await analyzeBatch(slice);
    if (res) allAiItems.push(...res);
  }

  const toBase = (p: VenuePaperInput) => ({
    url: p.url,
    doi: p.doi,
    pdf_url: p.pdfUrl,
    title_en: p.title,
    authors: p.authors ?? [],
    venue_abbr: p.venueAbbr || "Other",
    venue_name: p.venueName || p.venueAbbr || "",
    venue_tier: p.venueTier || "CCF-A",
    pub_date: p.publishedAt?.toISOString().slice(0, 10),
    created_date: p.createdDate,
  });

  if (allAiItems.length === 0) {
    console.warn(
      "[openalex-venues] all LLM attempts failed, falling back to raw papers",
    );
    const fallbackItems: AnalyzedVenuePaper[] = papers.map((p) => ({
      ...toBase(p),
      title_zh: p.title,
      keep: true,
      topic: "待分类",
      summary: (p.excerpt ?? "").slice(0, 300),
      highlights: [],
    }));
    return {
      date: meta.date,
      query_date: meta.queryDate,
      keywords: meta.keywords,
      venue_count: meta.venueCount,
      total_fetched: papers.length,
      kept_count: fallbackItems.length,
      filtered_count: 0,
      papers: fallbackItems,
      filtered_papers: [],
      model: meta.model,
      generated_at: new Date().toISOString(),
    };
  }

  const paperByUrl = new Map<string, VenuePaperInput>();
  for (const p of papers) paperByUrl.set(p.url, p);

  const keptWithPrio: Array<{ entry: AnalyzedVenuePaper; prio: number }> = [];
  const filtered: AnalyzedVenuePaper[] = [];
  const seenUrls = new Set<string>();

  for (const ai of allAiItems) {
    const url = ai.url?.trim();
    if (!url || seenUrls.has(url)) continue;
    const p = paperByUrl.get(url);
    if (!p) continue;
    seenUrls.add(url);

    const keep = ai.keep !== false;
    const prio = ai.priority === 2 ? 2 : 1;
    const entry: AnalyzedVenuePaper = {
      ...toBase(p),
      title_zh: ai.title_zh?.trim() || p.title,
      keep,
      topic: ai.topic?.trim() || "其他",
      summary: ai.summary?.trim() || (p.excerpt ?? "").slice(0, 260),
      highlights: Array.isArray(ai.highlights)
        ? ai.highlights
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .slice(0, 4)
        : [],
      discard_reason: keep
        ? undefined
        : ai.discard_reason?.trim() || "与区块链/智能合约/DeFi 无实质关联",
    };

    if (keep) keptWithPrio.push({ entry, prio });
    else filtered.push(entry);
  }

  for (const p of papers) {
    if (seenUrls.has(p.url)) continue;
    keptWithPrio.push({
      prio: 2,
      entry: {
        ...toBase(p),
        title_zh: p.title,
        keep: true,
        topic: "待分类",
        summary: (p.excerpt ?? "").slice(0, 260),
        highlights: [],
      },
    });
  }

  // Stable cross-batch sort: priority 1 (app/security/SE/measurement) before priority 2 (infra/consensus/crypto)
  keptWithPrio.sort((a, b) => a.prio - b.prio);
  const kept = keptWithPrio.map((x) => x.entry);

  return {
    date: meta.date,
    query_date: meta.queryDate,
    keywords: meta.keywords,
    venue_count: meta.venueCount,
    total_fetched: papers.length,
    kept_count: kept.length,
    filtered_count: filtered.length,
    papers: kept,
    filtered_papers: filtered,
    model: meta.model,
    generated_at: new Date().toISOString(),
  };
}
