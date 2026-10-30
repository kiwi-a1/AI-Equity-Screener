/**
 * Synthetic provider for automated tests and offline UI checks only (DATA_PROVIDER=mock).
 * Every number here is generated; nothing is real market data.
 */
import type { CompanyInfo, Holders, NewsItem, PriceBar, Quote, Statement } from "../types";
import { NotFoundError, type MarketDataProvider } from "./provider";
import { normalizeStatement } from "./statements";

export const MOCK_UNKNOWN = "ZZZZ";
/** A company whose detailed feeds are all empty: used to prove every fallback path fills the page. */
export const MOCK_SPARSE = "SPRS";

const NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", MSFT: "Microsoft Corporation", TSLA: "Tesla, Inc.", NVDA: "NVIDIA Corporation",
  AMZN: "Amazon.com, Inc.", GOOGL: "Alphabet Inc.", META: "Meta Platforms, Inc.", NFLX: "Netflix, Inc.",
  "RELIANCE.NS": "Reliance Industries Limited", "^GSPC": "S&P 500", [MOCK_SPARSE]: "Sparse Example Corp",
};

function seed(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(s: string) {
  let x = seed(s) || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

function basePrice(symbol: string): number {
  return 50 + (seed(symbol) % 450);
}

function mockQuote(symbol: string): Quote {
  const price = basePrice(symbol);
  const r = rng(symbol + "q")();
  const change = Number(((r - 0.45) * price * 0.04).toFixed(2));
  return {
    symbol, name: NAMES[symbol] ?? `${symbol} Holdings`, currency: symbol.endsWith(".NS") ? "INR" : "USD",
    exchange: symbol.endsWith(".NS") ? "NSE" : "NasdaqGS", price, change,
    changePercent: (change / (price - change)) * 100, marketState: "REGULAR",
    preMarketPrice: null, preMarketChangePercent: null, postMarketPrice: price + 0.4, postMarketChangePercent: 0.21,
  };
}

function bars(symbol: string, from: Date, to: Date, stepDays: number): PriceBar[] {
  const r = rng(symbol + "h");
  const out: PriceBar[] = [];
  let p = basePrice(symbol) * 0.7;
  for (let t = from.getTime(); t <= to.getTime(); t += stepDays * 86400000) {
    const d = new Date(t);
    if (stepDays === 1 && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
    p *= 1 + (r() - 0.48) * 0.03;
    out.push({ date: d.toISOString(), open: p * 0.995, high: p * 1.01, low: p * 0.99, close: p, adjClose: p * 0.985, volume: Math.round(1e6 + r() * 4e6) });
  }
  return out;
}

function statementRows(kind: string, annual: boolean): Array<Record<string, unknown>> {
  const n = annual ? 4 : 5;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const d = annual ? new Date(Date.UTC(2025 - i, 8, 30)) : new Date(Date.UTC(2025, 8 - 3 * i, 30));
    const g = 1 - i * 0.07;
    const s = annual ? 1 : 0.25;
    if (kind === "income") {
      rows.push({ date: d, totalRevenue: 400e9 * g * s, costOfRevenue: 220e9 * g * s, grossProfit: 180e9 * g * s, operatingExpense: 60e9 * g * s,
        researchAndDevelopment: 30e9 * g * s, sellingGeneralAndAdministration: 27e9 * g * s, operatingIncome: 120e9 * g * s,
        pretaxIncome: 121e9 * g * s, taxProvision: 20e9 * g * s, netIncome: 100e9 * g * s, basicEPS: 6.5 * g * s, dilutedEPS: 6.4 * g * s,
        dilutedAverageShares: 15.5e9, EBITDA: 135e9 * g * s, someObscureItem: 1e9 * g });
    } else if (kind === "balance") {
      rows.push({ date: d, cashAndCashEquivalents: 30e9 * g, currentAssets: 150e9 * g, totalAssets: 360e9 * g, currentLiabilities: 170e9 * g,
        totalDebt: 100e9 * g, stockholdersEquity: 65e9 * g, totalLiabilitiesNetMinorityInterest: 295e9 * g, retainedEarnings: null });
    } else {
      rows.push({ date: d, operatingCashFlow: 115e9 * g * s, capitalExpenditure: -10e9 * g * s, freeCashFlow: 105e9 * g * s,
        repurchaseOfCapitalStock: -90e9 * g * s, cashDividendsPaid: -15e9 * g * s, financingCashFlow: -110e9 * g * s });
    }
  }
  rows.push({ date: new Date(Date.UTC(2019, 8, 30)) }); // an empty period, as the live source sometimes returns
  return rows;
}

function holders(prefix: string) {
  return "ABCDE".split("").map((c, i) => ({
    holder: `${prefix} ${c}`, shares: 1.4e9 / (i + 1), pctHeld: 0.09 / (i + 1), value: 2.7e11 / (i + 1),
    pctChange: i === 4 ? null : (i - 2) / 100, dateReported: "2025-06-30T00:00:00.000Z",
  }));
}

export const mockProvider: MarketDataProvider = {
  async search(query) {
    const q = query.toUpperCase();
    return Object.entries(NAMES)
      .filter(([s, n]) => s.startsWith(q) || n.toUpperCase().includes(q))
      .slice(0, 8)
      .map(([symbol, name]) => ({ symbol, name, exchange: symbol.endsWith(".NS") ? "NSE" : "NASDAQ", type: "Equity" }));
  },
  async quotes(symbols) {
    return symbols.filter((s) => s !== MOCK_UNKNOWN).map(mockQuote);
  },
  async company(symbol) {
    if (symbol === MOCK_UNKNOWN) throw new NotFoundError(`No data found for ${symbol}`);
    const q = mockQuote(symbol);
    if (symbol === MOCK_SPARSE) {
      return { ...q, quoteType: "EQUITY", sector: null, industry: null, country: null, website: null, employees: null,
        description: null, financialCurrency: null, partial: true, fields: { regularMarketPrice: q.price! }, derived: [] };
    }
    const p = q.price!;
    const fields: CompanyInfo["fields"] = {
      previousClose: p - (q.change ?? 0), open: p * 0.99, dayLow: p * 0.98, dayHigh: p * 1.01, fiftyTwoWeekLow: p * 0.7,
      fiftyTwoWeekHigh: p * 1.1, volume: 5e7, averageVolume: 5.5e7, averageVolume10days: 5.2e7, bid: p - 0.05, ask: p + 0.05,
      bidSize: 100, askSize: 200, marketCap: 3e12, enterpriseValue: 3.1e12, trailingPE: 30.5, forwardPE: 28.1, pegRatio: 2.1,
      priceToSalesTrailing12Months: 7.9, priceToBook: 45, enterpriseToRevenue: 8, enterpriseToEbitda: 22, trailingEps: 6.2,
      forwardEps: 7, earningsDate: "2026-11-28T00:00:00.000Z", dividendRate: 1, dividendYield: 0.005,
      exDividendDate: "2026-10-09T00:00:00.000Z", profitMargins: 0.24, grossMargins: 0.45, operatingMargins: 0.3,
      ebitdaMargins: 0.34, returnOnAssets: 0.22, returnOnEquity: 1.5, totalRevenue: 3.9e11, revenueGrowth: 0.05,
      totalCash: 6e10, totalDebt: 1e11, debtToEquity: 150, currentRatio: 0.9, beta: 1.2, "52WeekChange": 0.2,
      SandP52WeekChange: 0.15, sharesOutstanding: 1.5e10, heldPercentInsiders: 0.02, heldPercentInstitutions: 0.62,
      shortRatio: 1.5, lastSplitFactor: "4:1", targetMeanPrice: p * 1.1, recommendationKey: "buy",
      lastFiscalYearEnd: "2025-09-30T00:00:00.000Z", mostRecentQuarter: "2025-09-30T00:00:00.000Z",
    };
    return {
      ...q, quoteType: "EQUITY", sector: "Technology", industry: "Consumer Electronics", country: "United States",
      website: "https://example.com", employees: 160000,
      description: `${q.name} is a synthetic company profile used for automated testing.`,
      financialCurrency: q.currency, partial: false, fields, derived: [],
    };
  },
  async history(symbol, req) {
    if (symbol === MOCK_UNKNOWN) return { symbol, currency: null, interval: req.interval, bars: [], dividends: [], splits: [] };
    const step = req.interval === "1wk" ? 7 : req.interval === "1mo" ? 30 : 1;
    const b = bars(symbol, req.period1, req.period2, step);
    const dividends = b.filter((_, i) => i % 63 === 30).map((x) => ({ date: x.date, amount: 0.24 }));
    return { symbol, currency: "USD", interval: req.interval, bars: b, dividends, splits: [{ date: "2020-08-31T00:00:00.000Z", ratio: "4:1" }] };
  },
  async statement(symbol, kind, frequency): Promise<Statement> {
    if (symbol === MOCK_SPARSE && frequency === "annual") return normalizeStatement(symbol, kind, frequency, []);
    return normalizeStatement(symbol, kind, frequency, statementRows(kind, frequency === "annual"));
  },
  async holders(symbol): Promise<Holders> {
    if (symbol === MOCK_SPARSE) {
      return { symbol, insiders: [], resources: [], majorFromStatistics: false, institutional: [], funds: [],
        major: { insidersPercentHeld: null, institutionsPercentHeld: null, institutionsFloatPercentHeld: null, institutionsCount: null } };
    }
    return {
      symbol,
      insiders: [{ name: "Jane Example", relation: "Chief Executive Officer", shares: 3.2e6, latestTransaction: "Sale", date: "2025-08-01T00:00:00.000Z" }],
      resources: [],
      majorFromStatistics: false,
      major: { insidersPercentHeld: 0.02, institutionsPercentHeld: 0.62, institutionsFloatPercentHeld: 0.63, institutionsCount: 6500 },
      institutional: holders("Institution"),
      funds: holders("Fund"),
    };
  },
  async news(symbol): Promise<NewsItem[]> {
    if (symbol === MOCK_SPARSE) return [];
    const now = Date.now();
    return Array.from({ length: 6 }, (_, i) => ({
      id: `mock-${symbol}-${i}`, title: `Test headline ${i + 1} about ${symbol}`, url: `https://example.com/news/${i}`,
      publisher: i % 2 ? "Test Wire" : "Example Daily", published: new Date(now - i * 7 * 3600e3).toISOString(),
      image: null, summary: "Synthetic summary text used for automated testing.", source: "yahoo",
    }));
  },
};
