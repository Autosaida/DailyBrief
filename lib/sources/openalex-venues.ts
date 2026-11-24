import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, sleep } from "../retry";
import { yesterdayKey } from "../utils";
import type { RawArticle } from "./types";

const OPENALEX_API = "https://api.openalex.org/works";
const LNCS_SOURCE_ID = "S106296714";
const DEFAULT_KEYWORDS = ["blockchain", "smart contract", "defi"];
const SOURCE_BATCH_SIZE = 30;
const PER_PAGE = 200;
const MAX_PAGES_PER_BATCH = 5;

export interface VenueDef {
  abbr: string;
  name: string;
  tier: string;
  area: string;
  openalexIds: string[];
  lncsPattern?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENUES_CONFIG_PATH = path.resolve(__dirname, "../..", "venues.config.json");

export function loadVenuesConfig(): VenueDef[] {
  if (!fs.existsSync(VENUES_CONFIG_PATH)) {
    throw new Error(`Venues config missing: ${VENUES_CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(VENUES_CONFIG_PATH, "utf8")) as VenueDef[];
}

export function resolveOpenAlexTargetDate(): string {
  const override = process.env.OPENALEX_TARGET_DATE?.trim();
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }
  return yesterdayKey();
}

function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted || typeof inverted !== "object") return "";
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      pairs.push([pos, word]);
    }
  }
  if (pairs.length === 0) return "";
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map((p) => p[1]).join(" ");
}

function buildSearchExpr(keywords: string[]): string {
  return keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (k.includes(" ") ? `"${k}"` : k))
    .join(" OR ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  type?: string | null;
  publication_date?: string | null;
  created_date?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    raw_source_name?: string | null;
    source?: {
      id?: string | null;
      display_name?: string | null;
    } | null;
  } | null;
  open_access?: {
    oa_url?: string | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
    institutions?: Array<{ display_name?: string | null }> | null;
  }> | null;
}

async function fetchWorksForSourceIds(
  sourceIds: string[],
  searchExpr: string,
  fromPubDate: string,
): Promise<OpenAlexWork[]> {
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  const results: OpenAlexWork[] = [];
  let cursor: string | null = "*";
  let pageCount = 0;

  while (cursor && pageCount < MAX_PAGES_PER_BATCH) {
    pageCount++;
    const filter = [
      `primary_location.source.id:${sourceIds.join("|")}`,
      `from_publication_date:${fromPubDate}`,
      `title_and_abstract.search:(${searchExpr})`,
    ].join(",");

    const params = new URLSearchParams({
      filter,
      "per-page": String(PER_PAGE),
      cursor,
      sort: "publication_date:desc",
      select:
        "id,doi,title,type,publication_date,created_date,abstract_inverted_index,primary_location,open_access,authorships",
    });
    if (apiKey) params.set("api_key", apiKey);

    const url = `${OPENALEX_API}?${params.toString()}`;
    const resp = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent":
            "DailyBrief-OpenAlex/1.0 (https://github.com/Autosaida/DailyBrief)",
          Accept: "application/json",
        },
      },
      {
        maxAttempts: 4,
        baseDelayMs: 2000,
        maxDelayMs: 20_000,
        timeoutMs: 30_000,
        label: "openalex",
      },
    );

    if (resp.status === 401) {
      throw new Error(
        "OpenAlex HTTP 401 Unauthorized (shared anonymous IP daily budget exhausted — set a free OPENALEX_API_KEY in .env.local / GitHub Secrets from https://openalex.org/settings/api)",
      );
    }
    if (!resp.ok) {
      throw new Error(`OpenAlex HTTP ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as {
      results?: OpenAlexWork[];
      meta?: { next_cursor?: string | null };
    };
    const batch = data.results ?? [];
    results.push(...batch);

    const next = data.meta?.next_cursor ?? null;
    if (!next || batch.length < PER_PAGE) {
      cursor = null;
    } else {
      cursor = next;
      await sleep(300);
    }
  }

  return results;
}

/**
 * Fetch newly indexed conference papers from OpenAlex free API for all
 * CCF-A (7th ed., 2026) + FC + SIGMETRICS + IMC venues defined in
 * `venues.config.json`.
 *
 * OpenAlex's free tier restricts `from_created_date` as a server-side filter,
 * so we fetch recent works (published within the last ~2 years) matching the
 * target venues + keywords via cursor pagination, then filter client-side by
 * `created_date === targetDate` (previous calendar day, or OPENALEX_TARGET_DATE).
 */
export async function fetchOpenAlexVenues(
  sourceId: string,
  keywords?: string[],
): Promise<RawArticle[]> {
  const venues = loadVenuesConfig();
  const kwList =
    keywords && keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
  const searchExpr = buildSearchExpr(kwList);
  const kwRe = buildKeywordRegex(kwList);
  const targetDate = resolveOpenAlexTargetDate();

  // Look back ~2 years on publication_date to catch conferences whose proceedings
  // get indexed months after the conference date.
  const targetYear = Number.parseInt(targetDate.slice(0, 4), 10) || new Date().getUTCFullYear();
  const fromPubDate = `${targetYear - 2}-01-01`;

  // Map OpenAlex source ID -> VenueDef
  const idToVenue = new Map<string, VenueDef>();
  const allDirectIds: string[] = [];
  const lncsVenues: Array<{ venue: VenueDef; re: RegExp }> = [];

  for (const v of venues) {
    for (const sid of v.openalexIds) {
      if (!idToVenue.has(sid)) {
        idToVenue.set(sid, v);
        allDirectIds.push(sid);
      }
    }
    if (v.lncsPattern) {
      lncsVenues.push({ venue: v, re: new RegExp(v.lncsPattern, "i") });
    }
  }

  const allWorks: Array<{ work: OpenAlexWork; venue: VenueDef }> = [];

  // 1. Direct venue Source IDs in batches (per-batch error isolation)
  for (let i = 0; i < allDirectIds.length; i += SOURCE_BATCH_SIZE) {
    if (i > 0) await sleep(300);
    const batchIds = allDirectIds.slice(i, i + SOURCE_BATCH_SIZE);
    try {
      const works = await fetchWorksForSourceIds(batchIds, searchExpr, fromPubDate);
      for (const w of works) {
        const sid = w.primary_location?.source?.id?.replace(
          "https://openalex.org/",
          "",
        );
        if (!sid) continue;
        const venue = idToVenue.get(sid);
        if (venue) allWorks.push({ work: w, venue });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401/.test(msg)) throw err;
      console.warn(`[openalex] batch ${i / SOURCE_BATCH_SIZE + 1} failed, continuing: ${msg}`);
    }
  }

  // 2. Springer LNCS series for LNCS-published venues (FC, CRYPTO, EUROCRYPT, CAV, FM)
  if (lncsVenues.length > 0) {
    await sleep(300);
    try {
      const lncsWorks = await fetchWorksForSourceIds(
        [LNCS_SOURCE_ID],
        searchExpr,
        fromPubDate,
      );
      for (const w of lncsWorks) {
        const rawName = [
          w.primary_location?.raw_source_name ?? "",
          w.primary_location?.source?.display_name ?? "",
        ].join(" ");
        const matched = lncsVenues.find((lv) => lv.re.test(rawName));
        if (matched) allWorks.push({ work: w, venue: matched.venue });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401/.test(msg)) throw err;
      console.warn(`[openalex] LNCS batch failed, continuing: ${msg}`);
    }
  }

  // Filter strictly to targetDate (`created_date`), exclude preprints, deduplicate.
  const seen = new Set<string>();
  const out: RawArticle[] = [];

  for (const { work, venue } of allWorks) {
    if (!work.id || seen.has(work.id)) continue;
    if (work.type === "preprint") continue;

    const createdDate = (work.created_date ?? "").slice(0, 10);
    if (createdDate !== targetDate) continue;

    const title = (work.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    const abstract = reconstructAbstract(work.abstract_inverted_index);
    if (!kwRe.test(`${title}\n${abstract}`)) continue;

    seen.add(work.id);

    const authors: string[] = [];
    for (const a of work.authorships ?? []) {
      const name = a.author?.display_name?.trim();
      if (!name) continue;
      const insts = (a.institutions ?? [])
        .map((i) => i.display_name?.trim())
        .filter((n): n is string => Boolean(n));
      const uniqueInsts = Array.from(new Set(insts));
      authors.push(
        uniqueInsts.length > 0 ? `${name} (${uniqueInsts.join("; ")})` : name,
      );
    }

    const doi = work.doi?.trim() || undefined;
    const url =
      doi ||
      work.primary_location?.landing_page_url?.trim() ||
      work.id;
    const pdfUrl =
      work.primary_location?.pdf_url?.trim() ||
      work.open_access?.oa_url?.trim() ||
      undefined;
    const pubDate = (work.publication_date ?? "").slice(0, 10);

    out.push({
      sourceId,
      title,
      url,
      pdfUrl,
      doi,
      excerpt: abstract,
      publishedAt: pubDate ? new Date(`${pubDate}T00:00:00Z`) : undefined,
      category: "tech" as const,
      authors,
      venueAbbr: venue.abbr,
      venueName: work.primary_location?.source?.display_name?.trim() || venue.name,
      venueTier: venue.tier,
      createdDate,
      queryDate: targetDate,
      matchedDate: targetDate,
      meta: `${venue.abbr} (${venue.tier}) · 入库 ${createdDate}`,
    });
  }

  return out;
}
