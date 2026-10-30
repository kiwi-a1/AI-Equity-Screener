/**
 * Shared data contracts. The provider layer (lib/data) returns these shapes, the API routes
 * (app/api) serve them as JSON, and the UI (components) and AI tools (lib/ai) consume them.
 * Missing values are always `null`, never 0.
 */

export type Num = number | null;

/** Envelope every API route returns. `fetchedAt` is ISO time; `stale` means a fallback copy was served. */
export interface ApiResult<T> {
  data: T | null;
  fetchedAt: string | null;
  stale: boolean;
  error: string | null;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

/** Compact live quote used by the ticker strip and the header. */
export interface Quote {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: Num;
  change: Num;
  changePercent: Num; // percent units (1.5 = 1.5%)
  marketState: string | null;
  preMarketPrice: Num;
  preMarketChangePercent: Num;
  postMarketPrice: Num;
  postMarketChangePercent: Num;
}

/** Full company profile + quote + key statistics, flattened. Keys follow Yahoo field names. */
export interface CompanyInfo extends Quote {
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  website: string | null;
  employees: Num;
  description: string | null;
  financialCurrency: string | null;
  partial: boolean; // true when only basic quote fields could be loaded
  fields: Record<string, Num | string>; // every numeric/date statistic, keyed by Yahoo field name
  derived: string[]; // field names calculated by lib/data/enrich.ts because the source did not report them
}

/** A reference link to an official source (regulator, exchange, investor relations). */
export interface ResourceLink {
  label: string;
  url: string;
  description: string;
}

export interface PriceBar {
  date: string; // ISO
  open: Num;
  high: Num;
  low: Num;
  close: Num;
  adjClose: Num;
  volume: Num;
}

export interface Dividend {
  date: string;
  amount: number;
}

export interface Split {
  date: string;
  ratio: string;
}

export interface History {
  symbol: string;
  currency: string | null;
  interval: string;
  bars: PriceBar[];
  dividends: Dividend[];
  splits: Split[];
}

export type StatementKind = "income" | "balance" | "cashflow";
export type Frequency = "annual" | "quarterly";

export interface StatementLine {
  key: string;
  label: string;
  kind: "money" | "perShare" | "shares";
  isKey: boolean;
  values: Num[]; // aligned with Statement.periods
}

export interface Statement {
  symbol: string;
  kind: StatementKind;
  frequency: Frequency;
  periods: string[]; // ISO dates, newest first
  lines: StatementLine[];
}

export interface Holder {
  holder: string;
  shares: Num;
  pctHeld: Num; // ratio
  value: Num;
  pctChange: Num; // ratio
  dateReported: string | null;
}

export interface InsiderHolder {
  name: string;
  relation: string | null;
  shares: Num;
  latestTransaction: string | null;
  date: string | null;
}

export interface Holders {
  symbol: string;
  insiders: InsiderHolder[];
  resources: ResourceLink[]; // official places to see full ownership filings
  majorFromStatistics: boolean; // true when the breakdown came from key statistics instead of the holders feed
  major: {
    insidersPercentHeld: Num;
    institutionsPercentHeld: Num;
    institutionsFloatPercentHeld: Num;
    institutionsCount: Num;
  };
  institutional: Holder[];
  funds: Holder[];
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  published: string | null; // ISO
  image: string | null;
  summary: string | null;
  source: "finnhub" | "yahoo" | "google" | "resource" | "rss";
}

export interface PerformanceRow {
  period: "YTD" | "1Y" | "3Y" | "5Y";
  stock: Num;
  benchmark: Num;
  difference: Num;
}

/** What the active section shows; sent to the AI analyst as context. */
export interface PageContext {
  section: SectionId;
  filters: Record<string, unknown>;
  visible: Record<string, unknown>;
}

export type SectionId = "summary" | "news" | "statistics" | "history" | "financials" | "holders";

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "news", label: "News" },
  { id: "statistics", label: "Statistics" },
  { id: "history", label: "Historical Data" },
  { id: "financials", label: "Financials" },
  { id: "holders", label: "Holders" },
];
