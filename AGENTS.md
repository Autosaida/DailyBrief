# AGENTS.md

Operational knowledge for any AI coding agent working on this repo.

## What this project is

A customized, static, local-first & GitHub-Actions-first **daily blockchain / smart-contract / security research tracker** (forked from `leiting-eric/DailyBrief` for its multi-backend LLM layer, timezone-gated Actions workflow, and static archive publishing; all content, fetchers, prompts, and rendering are custom-built).

It produces a self-contained single-file HTML report with **3 parallel primary tabs**, publishes to GitHub Pages (`gh-pages`), and optionally emails a daily summary via Resend:

1. **arXiv 今日论文（区块链）** — arXiv OAI-PMH `arXivRaw` incremental full-fetch (`set=cs`) for the previous day, distinguishing `v1 新投稿` vs `v2+ 更新`, with AI noise filtering, implicit priority sorting (application / security / SE / measurement first; infra / consensus / cryptography later), free-form topics, full author list, and Chinese academic summaries.
2. **会议 / 期刊正式发表论文** — OpenAlex API daily tracker across **68 venues** in `venues.config.json` (all 58 CCF 7th-ed. A-tier conferences + 7 CCF-A security/SE journals + FC / SIGMETRICS / IMC), matched by previous-day `created_date`, with full authors + institutions and per-venue secondary tabs.
3. **安全与行业快讯** — 21 security/intel/research/news sources in `news-sources.config.json` (DeFiLlama Hacks, Rekt News, Chainalysis, TRM Labs, SlowMist, BlockSec, PeckShield, Trail of Bits, Immunefi, Zellic, Sigma Prime, ethresear.ch, Ethereum Magicians, Flashbots, Vitalik, a16z Crypto, DL News, The Block, Blockworks, CoinDesk, The Defiant), filtered and grouped into 3 sections.

No web framework, no DB, no servers.

## Project layout

```
sources.config.json          # Top-level source registry (3 sources + keywords)
venues.config.json           # 68 tracked conferences & journals (OpenAlex IDs / LNCS patterns)
news-sources.config.json     # 21 security & industry news RSS/API sources
lib/
  retry.ts                   # Shared HTTP 429/5xx/network backoff + transient LLM error helper
  utils.ts                   # todayKey / yesterdayKey / getReportTz (honors REPORT_TZ)
  ai/
    llm.ts                   # Pluggable LLM dispatcher (runLlm / getModelTag / validateBackendCredentials)
    backends/                # openai-compat / anthropic-compat / claude-cli
    arxiv-blockchain.ts      # arXiv CS paper filtering, sorting & Chinese analysis (batch size 8)
    venue-papers.ts          # OpenAlex venue paper filtering, sorting & Chinese analysis (batch size 8)
    security-news.ts         # Security & industry news filtering, grouping & summary (batch size 6)
  sources/
    dispatch.ts              # Routes source.id -> custom fetcher or generic rss.ts
    arxiv-blockchain.ts      # arXiv OAI-PMH arXivRaw full-fetch + word-boundary keyword match
    openalex-venues.ts       # OpenAlex batched cursor fetcher + client-side created_date match
    security-news.ts         # DeFiLlama Hacks API + concurrent RSS fetcher with price-noise pre-filter
    registry.ts / types.ts   # JSON loader & shared RawArticle types
  output/
    render.ts                # 3-tab single-file HTML + Markdown renderer (all CSS/JS inlined)
scripts/
  _env.ts                    # dotenv preload — imported FIRST by every entry script
  daily.ts                   # Main pipeline (fetch 3 sources -> AI analyze -> write JSON/HTML)
  dry-run.ts                 # Fetch-only validation (no LLM)
  render.ts                  # Re-render HTML/MD from cached daily_reports/<date>/<date>.json (<1s)
  build-site.mjs             # Generate index.html + archive.html (with per-day model badge) + .nojekyll
  send-email.ts              # Resend REST API daily email sender (skips cleanly if unset)
  sources.ts                 # `npm run sources` / `npm run sources:check`
  quota-report.ts            # LLM call usage summary from logs/llm-calls.jsonl
```

## Core invariants

1. **Configuration files are the single source of truth.**
   - `sources.config.json` — top-level sources & keywords
   - `venues.config.json` — tracked conferences/journals & OpenAlex IDs
   - `news-sources.config.json` — tracked security/research/industry feeds
   Never hardcode source/venue lists in TS.

2. **All LLM calls go through `lib/ai/llm.ts` `runLlm()`.** Never import a specific backend directly.

3. **All external HTTP fetches use `lib/retry.ts` `fetchWithRetry()`** (bounded exponential backoff on 429/5xx/network errors; honors `Retry-After`). Multi-batch LLM calls keep a 4s cooldown between batches and backoff on transient errors.

4. **Date keying uses `lib/utils.ts` `todayKey()` / `yesterdayKey()`.** Always honors `REPORT_TZ`. Never hardcode `Asia/Shanghai` or `UTC`. Target dates strictly query the previous day (no fallback to older days, preventing weekend duplicates); optional debug overrides `ARXIV_TARGET_DATE`, `OPENALEX_TARGET_DATE`, `NEWS_TARGET_DATE` are supported.

5. **Per-source fetch errors are non-fatal.** Never `process.exit()` inside a fetcher.

6. **No build/bundle step.** `tsx` runs TypeScript directly; HTML/CSS/JS is hand-rendered in `lib/output/render.ts`.

## Commands

| Task | Command |
|---|---|
| Full pipeline | `npm run daily` |
| Fetch-only sanity check | `npm run dry-run` |
| Re-render HTML from cache | `npm run render [date]` |
| Build static site + archive | `npm run build-site` |
| Send daily email via Resend | `npm run send-email [date]` |
| List / validate sources | `npm run sources` / `npm run sources:check` |
| LLM usage summary | `npm run quota-report` |
| Unit tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |

## What NOT to do

- Don't add Playwright / Puppeteer or heavy web frameworks (Next.js, Express, etc.)
- Don't import a specific LLM backend directly; always use `runLlm()`
- Don't add scores/ratings or preset topic lists to the arXiv / venue paper outputs (topics must be model-generated; priority sorting stays implicit in prompts and is not shown in the UI)
- Don't truncate author lists in paper cards
- Don't commit `.env.local` or `daily_reports/`
