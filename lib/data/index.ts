/**
 * Data service: the single entry point for market data. Picks the provider (live or mock),
 * validates inputs and wraps every call in the TTL cache. API routes and AI tools both call these.
 */
import { cached } from "../cache";
import { toNum } from "../format";
import { config, TTL } from "../config";
import type { ApiResult, CompanyInfo, Frequency, History, Holders, NewsItem, Quote, SearchHit, Statement, StatementKind } from "../types";
import { mockProvider } from "./mock";
import { deriveFields, enrichmentNeeds } from "./enrich";
import { aggregateNews, googleNews, liveNewsSources, type NewsSources } from "./news";
import { aggregateMarketNews, liveMarketNewsSources, marketNewsResources, type MarketNewsSources } from "./marketNews";
import { filingLinks, newsResources } from "./resources";
import type { HistoryRequest, MarketDataProvider } from "./provider";
import { yahooProvider } from "./yahoo";

export function provider(): MarketDataProvider {
  return config.dataProvider() === "mock" ? mockProvider : yahooProvider;
}

const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/;

export function normalizeSymbol(s: unknown): string {
  return typeof s === "string" ? s.trim().toUpperCase() : "";
}

export function isValidSymbol(s: unknown): boolean {
  return SYMBOL_RE.test(normalizeSymbol(s));
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function requireSymbol(s: unknown): string {
  const sym = normalizeSymbol(s);
  if (!isValidSymbol(sym)) throw new InputError(`Invalid ticker symbol: ${String(s)}`);
  return sym;
}

export const INTERVALS = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"] as const;
export type Interval = (typeof INTERVALS)[number];

/** Maximum lookback in days the source serves for intraday intervals. */
export const INTRADAY_MAX_DAYS: Partial<Record<Interval, number>> = { "1m": 7, "5m": 59, "15m": 59, "30m": 59, "60m": 729 };

export const RANGE_PRESETS = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export function presetStart(preset: RangePreset, now = new Date()): Date {
  const d = new Date(now);
  switch (preset) {
    case "1M": d.setUTCMonth(d.getUTCMonth() - 1); break;
    case "3M": d.setUTCMonth(d.getUTCMonth() - 3); break;
    case "6M": d.setUTCMonth(d.getUTCMonth() - 6); break;
    case "YTD": return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case "1Y": d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case "5Y": d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    case "MAX": return new Date(Date.UTC(1970, 0, 2));
  }
  return d;
}

/** Clamp a history request to what the source can serve; returns a user-facing note if changed. */
export function clampHistory(start: Date, end: Date, interval: Interval, now = new Date()): { start: Date; end: Date; note: string | null } {
  let note: string | null = null;
  if (end > now) end = now;
  if (start > end) [start, end] = [end, start];
  const max = INTRADAY_MAX_DAYS[interval];
  if (max) {
    const earliest = new Date(now.getTime() - max * 86400e3);
    if (start < earliest) {
      start = earliest;
      note = `${interval} data is only available for about the last ${max} days, so the range starts on ${earliest.toISOString().slice(0, 10)}.`;
    }
  }
  return { start, end, note };
}

export async function searchSymbols(query: string): Promise<ApiResult<SearchHit[]>> {
  const q = query.trim().slice(0, 60);
  if (!q) return { data: [], fetchedAt: null, stale: false, error: null };
  return cached(`search:${q.toLowerCase()}`, TTL.search, () => provider().search(q), { retries: 1 });
}

export async function getQuotes(symbols: string[]): Promise<ApiResult<Quote[]>> {
  const list = [...new Set(symbols.map(normalizeSymbol).filter(isValidSymbol))].slice(0, 20);
  return cached(`quotes:${list.join(",")}`, TTL.quote, async () => {
    let quotes: Quote[] = [];
    try {
      quotes = (await provider().quotes(list)).filter((q) => q.price !== null);
    } catch {
      quotes = [];
    }
    // Fallback for any symbol the quote feed missed: last two daily closes from price history.
    const missing = list.filter((s) => !quotes.some((q) => q.symbol === s));
    const filled = await Promise.all(missing.map((s) => quoteFromHistory(s).catch(() => null)));
    const all = [...quotes, ...filled.filter((q): q is Quote => q !== null)];
    if (!all.length && list.length) throw new Error("No quotes are available right now");
    return list.map((s) => all.find((q) => q.symbol === s)).filter((q): q is Quote => !!q);
  }, { retries: 1 });
}

async function quoteFromHistory(symbol: string): Promise<Quote | null> {
  const now = new Date();
  const h = await provider().history(symbol, { period1: new Date(now.getTime() - 10 * 86400e3), period2: now, interval: "1d" });
  const bars = h.bars.filter((b) => b.close !== null);
  if (!bars.length) return null;
  const last = bars[bars.length - 1].close as number;
  const prev = bars.length > 1 ? (bars[bars.length - 2].close as number) : null;
  const change = prev !== null ? last - prev : null;
  return {
    symbol, name: null, currency: h.currency, exchange: null, price: last, change,
    changePercent: change !== null && prev ? (change / prev) * 100 : null, marketState: null,
    preMarketPrice: null, preMarketChangePercent: null, postMarketPrice: null, postMarketChangePercent: null,
    volume: bars[bars.length - 1].volume ?? null,
  };
}

/** Company profile plus calculated fallbacks for any statistic the source left out. */
export async function getCompany(symbol: string): Promise<ApiResult<CompanyInfo>> {
  const s = requireSymbol(symbol);
  return cached(`company:${s}`, TTL.quote, async () => enrichCompany(await provider().company(s)));
}

const skip = <T,>(): Promise<T> => Promise.reject(new Error("not needed"));

export async function enrichCompany(info: CompanyInfo): Promise<CompanyInfo> {
  const needs = enrichmentNeeds(info.fields);
  if (!needs.prices && !needs.statements && !needs.actions) return info;
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 372 * 86400e3);
  const value = <T,>(r: PromiseSettledResult<ApiResult<T>>) => (r.status === "fulfilled" ? r.value.data : null);
  const [bars, bench, incQ, incA, balQ, cfQ, actions] = await Promise.allSettled([
    needs.prices ? getHistory(info.symbol, { period1: yearAgo, period2: now, interval: "1d" }) : skip<ApiResult<History>>(),
    needs.prices ? getHistory(config.benchmark(), { period1: yearAgo, period2: now, interval: "1d" }) : skip<ApiResult<History>>(),
    needs.statements ? getStatement(info.symbol, "income", "quarterly") : skip<ApiResult<Statement>>(),
    needs.statements ? getStatement(info.symbol, "income", "annual") : skip<ApiResult<Statement>>(),
    needs.statements ? getStatement(info.symbol, "balance", "quarterly") : skip<ApiResult<Statement>>(),
    needs.statements ? getStatement(info.symbol, "cashflow", "quarterly") : skip<ApiResult<Statement>>(),
    needs.actions ? getHistory(info.symbol, { period1: new Date(Date.UTC(1990, 0, 1)), period2: now, interval: "1mo" }) : skip<ApiResult<History>>(),
  ]);
  const { fields, derived } = deriveFields(info.fields, {
    price: info.price,
    bars1y: value(bars)?.bars,
    benchBars1y: value(bench)?.bars,
    incomeQ: value(incQ),
    incomeA: value(incA),
    balanceQ: value(balQ),
    cashflowQ: value(cfQ),
    dividends: value(actions)?.dividends,
    splits: value(actions)?.splits,
  });
  return { ...info, fields, derived: [...info.derived, ...derived] };
}

export async function getHistory(symbol: string, req: HistoryRequest): Promise<ApiResult<History>> {
  const s = requireSymbol(symbol);
  if (!INTERVALS.includes(req.interval as Interval)) throw new InputError(`Unsupported interval: ${req.interval}`);
  const key = `history:${s}:${req.interval}:${req.period1.toISOString().slice(0, 10)}:${req.period2.toISOString().slice(0, 13)}`;
  return cached(key, TTL.history, () => provider().history(s, req));
}

export async function getStatement(symbol: string, kind: StatementKind, frequency: Frequency): Promise<ApiResult<Statement>> {
  const s = requireSymbol(symbol);
  if (!["income", "balance", "cashflow"].includes(kind)) throw new InputError(`Unknown statement: ${kind}`);
  if (!["annual", "quarterly"].includes(frequency)) throw new InputError(`Unknown frequency: ${frequency}`);
  return cached(`stmt:${s}:${kind}:${frequency}`, TTL.statements, () => provider().statement(s, kind, frequency));
}

export async function getHolders(symbol: string): Promise<ApiResult<Holders>> {
  const s = requireSymbol(symbol);
  return cached(`holders:${s}`, TTL.holders, async () => {
    let h: Holders | null = null;
    try {
      h = await provider().holders(s);
    } catch {
      h = null; // fall through to the statistics-based breakdown and official filing links
    }
    const company = (await getCompany(s).catch(() => null))?.data ?? null;
    const out: Holders = h ?? {
      symbol: s, insiders: [], institutional: [], funds: [], resources: [], majorFromStatistics: false,
      major: { insidersPercentHeld: null, institutionsPercentHeld: null, institutionsFloatPercentHeld: null, institutionsCount: null },
    };
    // Fallback for the breakdown: the same percentages reported in key statistics.
    if (company && out.major.insidersPercentHeld === null && out.major.institutionsPercentHeld === null) {
      const ins = toNum(company.fields.heldPercentInsiders);
      const inst = toNum(company.fields.heldPercentInstitutions);
      if (ins !== null || inst !== null) {
        out.major = { ...out.major, insidersPercentHeld: ins, institutionsPercentHeld: inst };
        out.majorFromStatistics = true;
      }
    }
    out.resources = filingLinks(s, company?.name ?? null);
    return out;
  });
}

export async function getNews(symbol: string, companyName: string | null, sources?: NewsSources): Promise<ApiResult<NewsItem[]>> {
  const s = requireSymbol(symbol);
  const p = provider();
  const live = config.dataProvider() !== "mock";
  const src = sources ?? (live ? liveNewsSources((x) => p.news(x)) : { provider: (x: string) => p.news(x) });
  return cached(`news:${s}`, TTL.news, async () => {
    let items: NewsItem[] = await aggregateNews(s, companyName, src).catch(() => []);
    // Fallback 1: broader general-news search by company name.
    if (!items.length && companyName && live && !sources) items = await googleNews(companyName, undefined, false).catch(() => []);
    // Fallback 2: official sources, so the section is never blank.
    if (!items.length) {
      const company = (await getCompany(s).catch(() => null))?.data ?? null;
      items = newsResources(s, companyName || company?.name || null, company?.website ?? null);
    }
    return items;
  }, { retries: 0 });
}

/** General finance headlines for the landing page, from many publishers. Never empty. */
export async function getMarketNews(sources?: MarketNewsSources): Promise<ApiResult<NewsItem[]>> {
  const live = config.dataProvider() !== "mock";
  const src = sources ?? (live ? liveMarketNewsSources(config.finnhubKey()) : { feeds: [() => mockMarketNews()] });
  return cached("market-news", TTL.news, async () => {
    const items = await aggregateMarketNews(src).catch(() => [] as NewsItem[]);
    return items.length ? items : marketNewsResources();
  }, { retries: 0 });
}

async function mockMarketNews(): Promise<NewsItem[]> {
  const pubs = ["CNBC", "MarketWatch", "Investing.com", "Seeking Alpha"];
  const now = Date.now();
  return Array.from({ length: 12 }, (_, i) => ({
    id: `mock-market-${i}`, title: `Test market headline ${i + 1}`, url: `https://example.com/market/${i}`, publisher: pubs[i % pubs.length],
    published: new Date(now - i * 2.5 * 3600e3).toISOString(), image: null, summary: "Synthetic market summary used for automated testing.", source: "rss",
  }));
}
