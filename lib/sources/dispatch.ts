import { fetchArxivBlockchain } from "./arxiv-blockchain";
import { fetchOpenAlexVenues } from "./openalex-venues";
import { fetchRss } from "./rss";
import { fetchSecurityIndustryNews } from "./security-news";
import type { RawArticle, SourceDef } from "./types";

/**
 * Single dispatcher used by daily.ts and dry-run.ts.
 * Add a new branch here when introducing a custom non-RSS fetcher.
 */
export async function fetchSource(source: SourceDef): Promise<RawArticle[]> {
  if (source.id === "arxiv-blockchain") {
    return fetchArxivBlockchain(source.id, source.keywords);
  }
  if (source.id === "openalex-venues") {
    return fetchOpenAlexVenues(source.id, source.keywords);
  }
  if (source.id === "security-industry-news") {
    return fetchSecurityIndustryNews(source.id);
  }
  return fetchRss(source.id, source.url, source.category, {
    useCurl: source.useCurl,
  });
}
