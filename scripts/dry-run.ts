import "./_env";

import { fetchSource } from "../lib/sources/dispatch";
import { sources } from "../lib/sources/registry";
import type { RawArticle } from "../lib/sources/types";

// Source-fetch sanity check only — does NOT call the LLM.
// For the full ingest → AI analysis → render pipeline use `npm run daily`.
async function main() {
  console.log("Fetching from sources…\n");
  const articles: Array<RawArticle & { source: string }> = [];

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

  console.log(`\nTotal items: ${articles.length}`);
  console.log("\nSample items:");
  articles.slice(0, 10).forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.sourceId}] ${a.title}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
