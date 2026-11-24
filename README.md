# 区块链每日论文与安全追踪（DailyBrief）

> 面向区块链、智能合约与安全研究者的自动化每日情报系统：基于 GitHub Actions + GitHub Pages 零基础设施运行，每天定时抓取 **arXiv 论文**、**CCF-A 及重点顶会/顶刊正式发表论文** 与 **安全/行业快讯**，经 LLM 专业去噪、优先级排序与中文深度解读后，自动发布静态网页并推送邮件。

🌐 **在线站点**：https://autosaida.github.io/DailyBrief/

---

## ✨ 三大核心板块

页面顶部采用 3 个并行一级 Tab，并支持历史归档（每期均低调标注生成所用的大模型，方便换模型后对比效果）：

### 1. arXiv 今日论文（区块链）
- **数据源**：arXiv 官方 **OAI-PMH `arXivRaw` 增量接口**（`set=cs` 计算机科学全集），支持 `resumptionToken` 自动翻页全量拉取。
- **版本追踪**：直接解析 `<version>` 列表，精准区分 **`v1 新投稿`** 与 **`v2+ 更新`**（如顶会录用后的终版更新），并提取 `comments`（会议录用备注）与 `journal-ref`。
- **检索与时间**：严格查前一天（不回退，避免周末重复推送），在标题 + 摘要上做词边界匹配（默认关键词：`blockchain`、`smart contract`、`defi`，可在 [`sources.config.json`](sources.config.json) 随时增删）。
- **AI 处理**：专业去噪（过滤低相关挂名跨界应用与泛概念综述，被过滤论文折叠展示防误杀）+ 隐式优先级排序（应用层/安全/软件工程/实证度量优先，infra/共识/密码学靠后）+ 自由拟定标签 + 完整作者与高密度中文学术解读。

### 2. 会议 / 期刊正式发表论文
- **数据源**：OpenAlex 官方 API，覆盖 [`venues.config.json`](venues.config.json) 中配置的 **68 个顶会与顶刊**：
  - **CCF 第七版（2026）全部 58 个 A 类会议**（含安全四大、软工四大、系统、网络、数据库、理论、AI、HCI、图形学、交叉等全领域）
  - **CCF-A 安全与软工期刊（7 本）**：`TDSC`、`TIFS`、`Journal of Cryptology`、`TSE`、`TOSEM`、`TOPLAS`、`TSC`
  - **特别关注会议（3 个）**：`FC`、`SIGMETRICS`、`IMC`
- **增量机制**：按 OpenAlex 入库日期（`created_date` = 前一天）精准增量捕获，自带**完整作者与所属单位（Institutions）**、发表日期、DOI 与开放获取 PDF。
- **交互**：0 篇时明确提示数量为 0 且不调 LLM；有新论文时自动按会议/期刊生成二级子 Tab（如 `ASE`、`CCS`、`TDSC`、`TIFS`、`FC`）。

### 3. 安全与行业快讯
- **数据源**：[`news-sources.config.json`](news-sources.config.json) 收录的 **21 个实测可用信源**：
  - **安全事件**：DeFiLlama Hacks API、Rekt News
  - **安全情报与审计机构**：Chainalysis、TRM Labs、SlowMist 慢雾、BlockSec、PeckShield 派盾、Trail of Bits、Immunefi、Zellic、Sigma Prime
  - **前沿协议研究**：ethresear.ch、Ethereum Magicians、Flashbots Collective、Vitalik Buterin、a16z Crypto
  - **主流行业媒体**：DL News、The Block、Blockworks、CoinDesk、The Defiant（自动预过滤纯币价/行情预测标题并控量）
- **分类与展示**：AI 去噪过滤纯行情播报与广告软文，按 **安全事件与情报 → 安全与协议研究 → 行业与监管动态** 分组排序并提供二级子 Tab 筛选。

### 4. 自动邮件推送（Resend）
- 每天构建并发布 GitHub Pages 后，自动通过 Resend API 发送内联 HTML 邮件到指定邮箱（即使当天全为 0 篇也会发送简短说明邮件），邮件顶部附带「打开完整网页版」按钮。

---

## 🚀 GitHub Actions + Pages 部署配置

工作流定义在 [`.github/workflows/daily.yml`](.github/workflows/daily.yml)，采用 `Time gate` 每小时探测并精准命中本地时区（默认北京时间 `08:00`），自带防 GitHub 吞定时任务的补跑机制。

1. **开启权限**：仓库 **Settings → Actions → General → Workflow permissions** 设为 **Read and write permissions**。
2. **配置 Secrets & Variables**（**Settings → Secrets and variables → Actions**，Repository 级别）：
   - **Secrets**：
     - `LLM_API_KEY`（或具体提供商 Key，如 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）
     - `OPENALEX_API_KEY`（免费领取：https://openalex.org/settings/api ，提供 `$1/day` 独享额度）
     - `RESEND_API_KEY`（可选，免费领取：https://resend.com ，配置后启用每日邮件）
   - **Variables**：
     - `LLM_BACKEND`：`openai` / `deepseek` / `anthropic` / `minimax` / `zhipu`
     - `LLM_BASE_URL`：如 Gemini 官方 OpenAI 兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai/`
     - `LLM_MODEL`：如 `gemini-3.6-flash`
     - `REPORT_LOCALE`：`zh`
     - `REPORT_TZ`：`Asia/Shanghai`
     - `MAIL_TO`：收件邮箱（多个用逗号分隔；可选 `MAIL_FROM` 覆盖默认发件人）
     - 可选调度覆盖：`REPORT_HOUR`（默认 `8`）、`REPORT_DAYS`（默认 `*`）
3. **首次触发 & 开启 Pages**：
   - 在 **Actions → Daily Brief** 手动点击 **Run workflow** 生成 `gh-pages` 分支；
   - 在 **Settings → Pages** 将 Source 设为 `Deploy from a branch` → `gh-pages` / `/ (root)`。

---

## 🛠️ 本地运行与常用命令

前置要求：Node.js 20+。复制 `.env.example` 为 `.env.local` 并填入相应 Key：

```bash
npm install
cp .env.example .env.local
```

| 命令 | 用途 |
|---|---|
| `npm run daily` | 跑完整管线（抓取 3 板块 → AI 去噪与中文解读 → 渲染 HTML/JSON） |
| `npm run dry-run` | 仅抓取验证 3 板块数据源连通性，不调 LLM |
| `npm run render [date]` | 改样式/排版后从 `daily_reports/<date>/<date>.json` 秒级重渲染 HTML |
| `npm run build-site` | 生成 `daily_reports/index.html`、`archive.html` 与 `.nojekyll` |
| `npm run send-email [date]` | 手动发送指定日期（默认今天）的日报邮件 |
| `npm run sources` | 查看 `sources.config.json` 中数据源状态 |
| `npm run sources:check` | 校验 `sources.config.json` 格式 |
| `npm run quota-report` | 查看 `logs/llm-calls.jsonl` 中各 LLM 调用统计 |
| `npm test` | 运行核心模块单元测试 |

**调试历史指定日期**：可通过环境变量临时指定目标查询日期，例如：
```bash
ARXIV_TARGET_DATE=2026-11-18 OPENALEX_TARGET_DATE=2026-01-29 NEWS_TARGET_DATE=2026-11-23 npm run daily
```

---

## ⚙️ 自定义配置入口（无需改代码）

- 调整 arXiv / OpenAlex 检索关键词：编辑 [`sources.config.json`](sources.config.json) 中的 `keywords` 数组
- 增删追踪的顶会 / 顶刊：编辑 [`venues.config.json`](venues.config.json)
- 增删安全机构 / 研究论坛 / 行业媒体：编辑 [`news-sources.config.json`](news-sources.config.json)
- 调整去噪标准、排序优先级或中文解读风格：编辑 `lib/ai/arxiv-blockchain.ts`、`lib/ai/venue-papers.ts`、`lib/ai/security-news.ts`

---

## 📁 项目结构

```text
DailyBrief/
├── sources.config.json          # 顶层 3 大板块注册表（含检索关键词）
├── venues.config.json           # 68 个 CCF-A 会议/期刊 + FC/SIGMETRICS/IMC 清单
├── news-sources.config.json     # 21 个安全事件/机构/研究论坛/行业媒体清单
├── lib/
│   ├── ai/
│   │   ├── llm.ts               # 可插拔多 LLM 后端统一调度层
│   │   ├── backends/            # openai-compat / anthropic-compat / claude-cli
│   │   ├── arxiv-blockchain.ts  # arXiv 论文去噪、排序与中文解读
│   │   ├── venue-papers.ts      # 会议/期刊论文去噪、排序与中文解读
│   │   └── security-news.ts     # 安全与行业快讯去噪、分类与中文提炼
│   ├── sources/
│   │   ├── dispatch.ts          # 源抓取分发器
│   │   ├── arxiv-blockchain.ts  # arXiv OAI-PMH (arXivRaw) 全量增量抓取器
│   │   ├── openalex-venues.ts   # OpenAlex 顶会/顶刊按入库日增量抓取器
│   │   ├── security-news.ts     # DeFiLlama Hacks + 20 个安全/研究/媒体 RSS 抓取器
│   │   └── rss.ts               # 通用 RSS 抓取器（保留扩展用）
│   ├── output/render.ts         # 3-Tab 单文件内联 HTML & Markdown 渲染器
│   ├── retry.ts                 # 统一 HTTP 429/5xx 与网络异常退避重试工具
│   └── utils.ts                 # 时区日期工具（todayKey / yesterdayKey）
├── scripts/
│   ├── daily.ts                 # 主管线入口
│   ├── dry-run.ts               # 仅抓取测试
│   ├── render.ts                # 缓存秒级重渲染
│   ├── build-site.mjs           # 静态站点与带模型标识的归档页生成器
│   ├── send-email.ts            # Resend 每日邮件推送脚本
│   ├── sources.ts               # 源配置查看与校验
│   └── quota-report.ts          # LLM 调用统计
└── .github/workflows/daily.yml  # GitHub Actions 定时构建、Pages 发布与发信
```

---

## 🙏 致谢

本项目底层框架（可插拔 LLM 后端、GitHub Actions 时区门禁与静态归档发布）Fork 自开源项目 [leiting-eric/DailyBrief](https://github.com/leiting-eric/DailyBrief)，并在此基础上全面重构为面向区块链、智能合约与安全研究的每日学术与情报追踪系统。

## 📝 License

MIT
