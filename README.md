# Equity Screener Powered by AI

A company research website: live quotes, price history, valuation statistics, financial statements, ownership,
merged news with cover images, and an AI analyst (Claude or Gemini) that follows the company and section you are viewing.

Built with Next.js (React + TypeScript). Deploys to Vercel; every change committed to GitHub redeploys automatically.

## Deploy on Vercel (no coding)

1. Put these files at the top level of a GitHub repository (`package.json` must be at the root).
2. Go to **vercel.com**, sign in with GitHub, click **Add New... > Project**, and import the repository.
   Vercel detects Next.js automatically; leave the build settings as they are.
3. Before clicking Deploy, open **Environment Variables** and add:
   - `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) for the AI analyst
   - `FINNHUB_API_KEY` (optional, free at finnhub.io) for a richer news feed
4. Click **Deploy**. You get a link like `https://your-project.vercel.app`.

After that, any edit you commit on GitHub (including edits made in the GitHub website) goes live in about a minute.
If you change an environment variable later, redeploy from the Vercel dashboard (Deployments > ... > Redeploy).

## Run on your own computer

```bash
npm install
cp .env.example .env.local   # then put your keys in .env.local
npm run dev
```

Open http://localhost:3000.

## How the code is organized

```
app/
  page.tsx, layout.tsx, globals.css    page shell and the design system (Times New Roman, ruled ledgers)
  api/                                 server routes; every one returns { data, fetchedAt, stale, error }
    search, quotes, company/[symbol], history, financials, holders, news, market-news, performance, chat
components/
  Workspace.tsx                        app shell, URL state (?s=AAPL&tab=financials), section routing
  SearchBox.tsx                        live suggestions while typing, keyboard navigation
  TickerStrip.tsx                      featured companies with live prices (click to open)
  CompanyHeader.tsx                    name, identity and live price (refreshes every 30 seconds)
  ChatPanel.tsx                        AI analyst, always visible on the right, streams answers
  sections/                            Summary, News, Statistics, HistoricalData, Financials, Holders
  ui.tsx, charts.tsx, useApi.ts        shared building blocks
lib/
  types.ts                             data contracts shared by server, UI and AI
  data/provider.ts                     the MarketDataProvider interface
  data/yahoo.ts, data/mock.ts          live implementation and the synthetic test implementation
  data/index.ts                        cached services used by API routes and AI tools
  data/news.ts                         company news: Finnhub + provider feed + Google News, merged and de-duplicated
  data/marketNews.ts                   landing-page market news: CNBC, MarketWatch, Investing.com, Seeking Alpha,
                                       Google News Business (RSS) + Finnhub general news
  data/statements.ts                   statement line-item definitions and normalization
  metrics.ts, statistics.ts            deterministic calculations and metric groups
  ai/                                  tools, prompt, context note, Claude and Gemini runners, sources
tests/                                 unit, API and AI-loop tests (run with: npm test)
```

**Data flow.** UI component > `/api/...` route > `lib/data` service (cache, retries, stale fallback) > provider.
The AI tools call the same `lib/data` services, so the chatbot and the pages always agree.

**Switching data vendors.** Implement `MarketDataProvider` (lib/data/provider.ts) for the new vendor and return it
from `provider()` in lib/data/index.ts. Nothing else changes.

**Missing data** is always `null` and shown as N/A, never as 0. Ratios refuse zero or missing denominators and never
mix statement periods with different dates.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | one AI key | Gemini analyst (used when no Anthropic key is set) |
| `ANTHROPIC_API_KEY` | one AI key | Claude analyst (preferred when set) |
| `FINNHUB_API_KEY` | optional | Extra news source with cover images |
| `GEMINI_MODEL` | optional | Default `gemini-flash-latest` |
| `ANALYST_MODEL`, `ANALYST_EFFORT` | optional | Claude model (default `claude-opus-5-5`) and effort (`medium`) |
| `BENCHMARK_SYMBOL` | optional | Default `^GSPC` (S&P 500) |
| `DATA_PROVIDER=mock` | testing only | Synthetic data for offline tests |

## Tests

```bash
npm test
```

## Notes

Market data comes from an unofficial interface and can be delayed, incomplete or temporarily blocked for some
servers. If that happens persistently on Vercel, switch to a licensed provider through `MarketDataProvider`.
Nothing on this site is investment advice.
