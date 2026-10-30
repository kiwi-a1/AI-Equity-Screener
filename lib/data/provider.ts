/**
 * The contract every market-data source implements. lib/data/index.ts picks the implementation
 * (live or mock) and adds caching; nothing else talks to a data source directly. To switch to a
 * different vendor later, implement this interface and register it in index.ts.
 */
import type { CompanyInfo, Frequency, History, Holders, NewsItem, Quote, SearchHit, Statement, StatementKind } from "../types";

export interface HistoryRequest {
  period1: Date;
  period2: Date;
  interval: "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";
}

export interface MarketDataProvider {
  search(query: string): Promise<SearchHit[]>;
  quotes(symbols: string[]): Promise<Quote[]>;
  company(symbol: string): Promise<CompanyInfo>;
  history(symbol: string, req: HistoryRequest): Promise<History>;
  statement(symbol: string, kind: StatementKind, frequency: Frequency): Promise<Statement>;
  holders(symbol: string): Promise<Holders>;
  /** Company news from the provider itself; other news sources are merged in lib/data/news.ts. */
  news(symbol: string): Promise<NewsItem[]>;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFound";
  }
}
