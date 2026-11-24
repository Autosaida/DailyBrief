import * as cheerio from "cheerio";
import { fetchWithRetry, sleep } from "../retry";
import { yesterdayKey } from "../utils";
import type { RawArticle } from "./types";

const ARXIV_OAI_ENDPOINT = "https://oaipmh.arxiv.org/oai";
const DEFAULT_KEYWORDS = ["blockchain", "smart contract", "defi"];

interface ParsedOaiRecord {
  arxivId: string;
  title: string;
  url: string;
  pdfUrl: string;
  abstract: string;
  version: string;
  createdDate: string;
  updatedDate: string;
  datestamp: string;
  isUpdate: boolean;
  authors: string[];
  categories: string[];
  comment?: string;
  journalRef?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a word-boundary case-insensitive regex from configured keywords so
 * "defi" matches "DeFi" without falsely matching "define" or "definition",
 * and "smart contract" matches both singular and plural ("smart contracts").
 */
function buildKeywordRegex(keywords: string[]): RegExp {
  const parts = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const escaped = escapeRegex(k).replace(/\s+/g, "\\s+");
      const pluralizable =
        /[a-z]$/i.test(k) && !/s$/i.test(k) && k.toLowerCase() !== "defi";
      return pluralizable ? `${escaped}s?` : escaped;
    });
  return new RegExp(`\\b(?:${parts.join("|")})\\b`, "i");
}

/**
 * Split arXivRaw's flat `<authors>` string (e.g. "A (MIT), B, and C (ETH)")
 * while preserving commas inside parentheses (affiliations).
 */
function parseAuthorsString(raw: string): string[] {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;

    if (ch === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());

  const out: string[] = [];
  for (const part of parts) {
    // Handle trailing "and Author" or "Author1 and Author2" outside parens.
    const trimmed = part.replace(/^and\s+/i, "").trim();
    if (!trimmed) continue;
    if (!trimmed.includes("(") && /\s+and\s+/i.test(trimmed)) {
      for (const sub of trimmed.split(/\s+and\s+/i)) {
        if (sub.trim()) out.push(sub.trim());
      }
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

function toIsoDate(raw: string): string {
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function parseOaiRawPage(xml: string): {
  records: ParsedOaiRecord[];
  resumptionToken: string | null;
  noRecords: boolean;
} {
  const $ = cheerio.load(xml, { xmlMode: true });

  const errorCode = $("error").first().attr("code")?.trim();
  if (errorCode === "noRecordsMatch") {
    return { records: [], resumptionToken: null, noRecords: true };
  }
  if (errorCode) {
    const errText = $("error").first().text().trim();
    throw new Error(`arXiv OAI-PMH error (${errorCode}): ${errText}`);
  }

  const records: ParsedOaiRecord[] = [];

  $("record").each((_, el) => {
    const rec = $(el);
    if (rec.find("header").attr("status") === "deleted") return;

    const datestamp = rec.find("header > datestamp").first().text().trim();
    const meta = rec.find("metadata > arXivRaw");
    if (meta.length === 0) return;

    const arxivId = meta.find("id").first().text().trim();
    const title = meta.find("title").first().text().replace(/\s+/g, " ").trim();
    const abstract = meta
      .find("abstract")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!arxivId || !title) return;

    const versions: Array<{ version: string; date: string }> = [];
    meta.find("version").each((__, vEl) => {
      const vNode = $(vEl);
      const ver = vNode.attr("version")?.trim() || "";
      const dateStr = toIsoDate(vNode.find("date").first().text().trim());
      if (ver) versions.push({ version: ver, date: dateStr });
    });

    const firstVersion = versions[0];
    const latestVersion = versions[versions.length - 1];
    const version = latestVersion?.version || "v1";
    const isUpdate = version !== "v1" && versions.length > 1;
    const createdDate = firstVersion?.date || datestamp;
    const updatedDate = latestVersion?.date || datestamp;

    const categoriesRaw = meta.find("categories").first().text().trim();
    const categories = categoriesRaw
      ? categoriesRaw.split(/\s+/).filter(Boolean)
      : [];

    const authorsRaw = meta.find("authors").first().text();
    const authors = parseAuthorsString(authorsRaw);

    const comment =
      meta.find("comments").first().text().replace(/\s+/g, " ").trim() ||
      undefined;
    const journalRef =
      meta.find("journal-ref").first().text().replace(/\s+/g, " ").trim() ||
      undefined;

    records.push({
      arxivId,
      title,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      abstract,
      version,
      createdDate,
      updatedDate,
      datestamp,
      isUpdate,
      authors,
      categories,
      comment,
      journalRef,
    });
  });

  const tokenText = $("resumptionToken").first().text().trim();
  return {
    records,
    resumptionToken: tokenText || null,
    noRecords: false,
  };
}

export function resolveArxivTargetDate(): string {
  const override = process.env.ARXIV_TARGET_DATE?.trim();
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }
  return yesterdayKey();
}

/**
 * Full-fetch all arXiv Computer Science (`set=cs`) papers announced or updated
 * on the previous calendar day via arXiv's official OAI-PMH `arXivRaw` format,
 * which includes the exact `<version version="v1|v2|...">` history so new
 * submissions (`v1`) and true revisions (`v2+`) are distinguished with 100%
 * accuracy.
 */
export async function fetchArxivBlockchain(
  sourceId: string,
  keywords?: string[],
): Promise<RawArticle[]> {
  const kwList =
    keywords && keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
  const kwRe = buildKeywordRegex(kwList);
  const targetDate = resolveArxivTargetDate();

  let url = `${ARXIV_OAI_ENDPOINT}?verb=ListRecords&metadataPrefix=arXivRaw&set=cs&from=${targetDate}&until=${targetDate}`;
  const matched: ParsedOaiRecord[] = [];
  const seenIds = new Set<string>();

  while (url) {
    const resp = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent":
            "DailyBrief-ArxivOAI/1.0 (+https://github.com/Autosaida/DailyBrief)",
          Accept: "application/xml, text/xml",
        },
      },
      {
        maxAttempts: 5,
        baseDelayMs: 5000,
        maxDelayMs: 30_000,
        timeoutMs: 45_000,
        label: "arxiv-oai",
      },
    );

    if (!resp.ok) {
      throw new Error(`arXiv OAI-PMH HTTP ${resp.status} ${resp.statusText}`);
    }

    const xml = await resp.text();
    const page = parseOaiRawPage(xml);
    if (page.noRecords) break;

    for (const rec of page.records) {
      if (seenIds.has(rec.arxivId)) continue;
      if (!rec.categories.some((c) => c.startsWith("cs."))) continue;
      if (!kwRe.test(`${rec.title}\n${rec.abstract}`)) continue;
      seenIds.add(rec.arxivId);
      matched.push(rec);
    }

    if (page.resumptionToken) {
      url = `${ARXIV_OAI_ENDPOINT}?verb=ListRecords&resumptionToken=${encodeURIComponent(
        page.resumptionToken,
      )}`;
      await sleep(2000);
    } else {
      url = "";
    }
  }

  return matched.map((e) => ({
    sourceId,
    title: e.title,
    url: e.url,
    excerpt: e.abstract,
    publishedAt: new Date(`${e.updatedDate || targetDate}T00:00:00Z`),
    category: "tech" as const,
    arxivId: e.arxivId,
    pdfUrl: e.pdfUrl,
    authors: e.authors,
    categories: e.categories,
    version: e.version,
    isUpdate: e.isUpdate,
    createdDate: e.createdDate,
    updatedDate: e.updatedDate,
    comment: e.comment,
    journalRef: e.journalRef,
    queryDate: targetDate,
    matchedDate: targetDate,
    meta: [
      e.isUpdate ? `${e.version} 更新` : `${e.version} 新投稿`,
      e.categories.join(", "),
      e.authors.join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}
