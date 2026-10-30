/** Live provider backed by the yahoo-finance2 library. */
import YahooFinance from "yahoo-finance2";

import { safeUrl, toNum } from "../format";
import type { CompanyInfo, Frequency, Holder, Holders, NewsItem, Quote, SearchHit, StatementKind } from "../types";
import { NotFoundError, type HistoryRequest, type MarketDataProvider } from "./provider";
import { normalizeStatement } from "./statements";

type Yf = InstanceType<typeof YahooFinance>;
let client: Yf | null = null;

function yf(fresh = false): Yf {
  if (!client || fresh) client = new YahooFinance({ suppressNotices: ["yahooSurvey"], versionCheck: false });
  return client;
}

const RETRYABLE = /401|403|429|crumb|cookie|unauthori[sz]ed|too many/i;

/** Run a call; if Yahoo rejects the session (crumb/cookie/429), retry once with a fresh client. */
async function call<T>(fn: (c: Yf) => Promise<T>): Promise<T> {
  try {
    return await fn(yf());
  } catch (err) {
    if (err instanceof Error && RETRYABLE.test(`${err.name} ${err.message}`)) return fn(yf(true));
    throw err;
  }
}

const NO_VALIDATE = { validateResult: false } as const;

function isoOrNull(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number" && v > 0) return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && !Number.isNaN(new Date(v).getTime())) return new Date(v).toISOString();
  return null;
}

/** Copy primitive fields of quoteSummary modules into one flat map (first non-null wins). */
export function flattenModules(modules: Record<string, unknown>[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const mod of modules) {
    if (!mod || typeof mod !== "object") continue;
    for (const [k, raw] of Object.entries(mod)) {
      if (k in out || k === "maxAge") continue;
      if (raw instanceof Date) {
        const iso = isoOrNull(raw);
        if (iso) out[k] = iso;
      } else if (typeof raw === "string") {
        if (raw.trim()) out[k] = raw.trim();
      } else {
        const n = toNum(raw);
        if (n !== null) out[k] = n;
      }
    }
  }
  return out;
}

function str(f: Record<string, number | string>, ...keys: string[]): string | null {
  for (const k of keys) if (typeof f[k] === "string") return f[k] as string;
  return null;
}

function num(f: Record<string, number | string>, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = toNum(f[k]);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Build a Quote. `pctIsRatio`: quoteSummary returns change percents as ratios (0.0123),
 * the quote endpoint as percents (1.23). Output is always percent units.
 */
export function buildQuote(symbol: string, f: Record<string, number | string>, pctIsRatio: boolean): Quote {
  const scale = (v: number | null) => (v === null ? null : pctIsRatio ? v * 100 : v);
  const price = num(f, "regularMarketPrice", "currentPrice");
  const prev = num(f, "regularMarketPreviousClose", "previousClose");
  let change = num(f, "regularMarketChange");
  if (change === null && price !== null && prev !== null) change = price - prev;
  let pct = scale(num(f, "regularMarketChangePercent"));
  if (pct === null && change !== null && prev) pct = (change / prev) * 100;
  return {
    symbol: (str(f, "symbol") ?? symbol).toUpperCase(),
    name: str(f, "longName", "shortName", "displayName"),
    currency: str(f, "currency"),
    exchange: str(f, "fullExchangeName", "exchangeName", "exchange"),
    price,
    change,
    changePercent: pct,
    marketState: str(f, "marketState"),
    preMarketPrice: num(f, "preMarketPrice"),
    preMarketChangePercent: scale(num(f, "preMarketChangePercent")),
    postMarketPrice: num(f, "postMarketPrice"),
    postMarketChangePercent: scale(num(f, "postMarketChangePercent")),
  };
}

export function buildCompany(symbol: string, f: Record<string, number | string>, partial: boolean, pctIsRatio: boolean): CompanyInfo {
  return {
    ...buildQuote(symbol, f, pctIsRatio),
    quoteType: str(f, "quoteType"),
    sector: str(f, "sector", "sectorDisp"),
    industry: str(f, "industry", "industryDisp"),
    country: str(f, "country"),
    website: safeUrl(str(f, "website")),
    employees: num(f, "fullTimeEmployees"),
    description: str(f, "longBusinessSummary"),
    financialCurrency: str(f, "financialCurrency"),
    partial,
    fields: f,
    derived: [],
  };
}

function holderRows(list: unknown): Holder[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((h: Record<string, unknown>) => ({
      holder: String(h.organization ?? "").trim(),
      shares: toNum(h.position),
      pctHeld: toNum(h.pctHeld),
      value: toNum(h.value),
      pctChange: toNum(h.pctChange),
      dateReported: isoOrNull(h.reportDate),
    }))
    .filter((h) => h.holder)
    .sort((a, b) => (b.shares ?? -1) - (a.shares ?? -1));
}

export const yahooProvider: MarketDataProvider = {
  async search(query) {
    const res = await call((c) => c.search(query, { quotesCount: 8, newsCount: 0, enableFuzzyQuery: true }, NO_VALIDATE));
    const quotes = ((res as { quotes?: Record<string, unknown>[] }).quotes ?? []).filter((q) => q.symbol && q.isYahooFinance !== false);
    return quotes.map<SearchHit>((q) => ({
      symbol: String(q.symbol).toUpperCase(),
      name: String(q.longname ?? q.shortname ?? q.symbol),
      exchange: (q.exchDisp as string) ?? (q.exchange as string) ?? null,
      type: (q.typeDisp as string) ?? (q.quoteType as string) ?? null,
    }));
  },

  async quotes(symbols) {
    if (!symbols.length) return [];
    const res = (await call((c) => c.quote(symbols, {}, NO_VALIDATE))) as unknown;
    const arr = (Array.isArray(res) ? res : [res]) as Record<string, unknown>[];
    return arr.map((q) => buildQuote(String(q.symbol), flattenModules([q]), false));
  },

  async company(symbol) {
    let summaryError: unknown = null;
    try {
      const res = (await call((c) =>
        c.quoteSummary(
          symbol,
          { modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile", "calendarEvents"] },
          NO_VALIDATE,
        ),
      )) as Record<string, Record<string, unknown> | undefined>;
      const cal = res.calendarEvents ?? {};
      const earnings = (cal.earnings ?? {}) as { earningsDate?: unknown[] };
      const calFields = {
        earningsDate: earnings.earningsDate?.[0],
        earningsDateEnd: earnings.earningsDate?.[1],
        calendarExDividendDate: cal.exDividendDate,
        calendarDividendDate: cal.dividendDate,
      };
      const f = flattenModules([res.price ?? {}, res.summaryDetail ?? {}, res.financialData ?? {}, res.defaultKeyStatistics ?? {}, res.assetProfile ?? {}, calFields]);
      if (num(f, "regularMarketPrice", "currentPrice") !== null || str(f, "longName", "shortName")) return buildCompany(symbol, f, false, true);
    } catch (err) {
      summaryError = err;
    }
    // Fallback: the lighter quote endpoint (often still served when quoteSummary is throttled).
    try {
      const q = (await call((c) => c.quote(symbol, {}, NO_VALIDATE))) as Record<string, unknown> | undefined;
      if (q && (q.regularMarketPrice !== undefined || q.longName || q.shortName)) return buildCompany(symbol, flattenModules([q]), true, false);
    } catch (err) {
      summaryError = summaryError ?? err;
    }
    if (summaryError) throw summaryError;
    throw new NotFoundError(`No data found for ${symbol}`);
  },

  async history(symbol, req) {
    const res = (await call((c) =>
      c.chart(symbol, { period1: req.period1, period2: req.period2, interval: req.interval, events: "div|split", return: "array" }, NO_VALIDATE),
    )) as {
      meta?: { currency?: string };
      quotes?: Record<string, unknown>[];
      events?: { dividends?: Record<string, unknown>[]; splits?: Record<string, unknown>[] };
    };
    const bars = (res.quotes ?? [])
      .map((q) => ({
        date: isoOrNull(q.date) ?? "",
        open: toNum(q.open),
        high: toNum(q.high),
        low: toNum(q.low),
        close: toNum(q.close),
        adjClose: toNum(q.adjclose),
        volume: toNum(q.volume),
      }))
      .filter((b) => b.date && b.close !== null);
    const dividends = (res.events?.dividends ?? [])
      .map((d) => ({ date: isoOrNull(d.date) ?? "", amount: toNum(d.amount) ?? 0 }))
      .filter((d) => d.date && d.amount > 0);
    const splits = (res.events?.splits ?? [])
      .map((s) => ({ date: isoOrNull(s.date) ?? "", ratio: String(s.splitRatio ?? `${s.numerator}:${s.denominator}`) }))
      .filter((s) => s.date);
    return { symbol, currency: res.meta?.currency ?? null, interval: req.interval, bars, dividends, splits };
  },

  async statement(symbol, kind, frequency) {
    const module = kind === "income" ? "financials" : kind === "balance" ? "balance-sheet" : "cash-flow";
    let primaryError: unknown = null;
    try {
      const rows = (await call((c) =>
        c.fundamentalsTimeSeries(symbol, { period1: "2015-01-01", type: frequency === "annual" ? "annual" : "quarterly", module }, NO_VALIDATE),
      )) as Array<Record<string, unknown>>;
      const stmt = normalizeStatement(symbol, kind, frequency, Array.isArray(rows) ? rows : []);
      if (stmt.lines.length) return stmt;
    } catch (err) {
      primaryError = err;
    }
    // Fallback: the older statement-history modules, mapped onto the same line-item keys.
    try {
      const rows = await legacyStatementRows(symbol, kind, frequency);
      const stmt = normalizeStatement(symbol, kind, frequency, rows);
      if (stmt.lines.length || !primaryError) return stmt;
    } catch (err) {
      if (!primaryError) throw err;
    }
    throw primaryError;
  },

  async holders(symbol) {
    const res = (await call((c) =>
      c.quoteSummary(symbol, { modules: ["majorHoldersBreakdown", "institutionOwnership", "fundOwnership", "insiderHolders"] }, NO_VALIDATE),
    )) as Record<string, Record<string, unknown> | undefined>;
    const major = res.majorHoldersBreakdown ?? {};
    const insiders = ((res.insiderHolders?.holders ?? []) as Record<string, unknown>[])
      .map((h) => ({
        name: String(h.name ?? "").trim(),
        relation: (h.relation as string) ?? null,
        shares: toNum(h.positionDirect),
        latestTransaction: (h.transactionDescription as string) ?? null,
        date: isoOrNull(h.latestTransDate),
      }))
      .filter((h) => h.name);
    const result: Holders = {
      symbol,
      insiders,
      resources: [],
      majorFromStatistics: false,
      major: {
        insidersPercentHeld: toNum(major.insidersPercentHeld),
        institutionsPercentHeld: toNum(major.institutionsPercentHeld),
        institutionsFloatPercentHeld: toNum(major.institutionsFloatPercentHeld),
        institutionsCount: toNum(major.institutionsCount),
      },
      institutional: holderRows(res.institutionOwnership?.ownershipList),
      funds: holderRows(res.fundOwnership?.ownershipList),
    };
    return result;
  },

  async news(symbol) {
    const res = (await call((c) => c.search(symbol, { quotesCount: 0, newsCount: 20 }, NO_VALIDATE))) as { news?: Record<string, unknown>[] };
    return (res.news ?? [])
      .map<NewsItem | null>((n) => {
        const url = safeUrl(n.link);
        if (!url || !n.title) return null;
        const res = ((n.thumbnail as { resolutions?: { url: string; width: number }[] })?.resolutions ?? []).filter((r) => safeUrl(r.url));
        const thumb = res.sort((a, b) => Math.abs(a.width - 240) - Math.abs(b.width - 240))[0];
        return {
          id: String(n.uuid ?? url),
          title: String(n.title),
          url,
          publisher: (n.publisher as string) ?? null,
          published: isoOrNull(n.providerPublishTime),
          image: thumb ? thumb.url : null,
          summary: null,
          source: "yahoo",
        };
      })
      .filter((n): n is NewsItem => n !== null);
  },
};

const LEGACY_KEYS: Record<StatementKind, Record<string, string>> = {
  income: {
    totalRevenue: "totalRevenue", costOfRevenue: "costOfRevenue", grossProfit: "grossProfit", researchDevelopment: "researchAndDevelopment",
    sellingGeneralAdministrative: "sellingGeneralAndAdministration", totalOperatingExpenses: "operatingExpense", operatingIncome: "operatingIncome",
    interestExpense: "interestExpense", incomeBeforeTax: "pretaxIncome", incomeTaxExpense: "taxProvision", netIncome: "netIncome",
    netIncomeApplicableToCommonShares: "netIncomeCommonStockholders", ebit: "EBIT", totalOtherIncomeExpenseNet: "otherIncomeExpense",
  },
  balance: {
    cash: "cashAndCashEquivalents", shortTermInvestments: "otherShortTermInvestments", netReceivables: "receivables", inventory: "inventory",
    totalCurrentAssets: "currentAssets", propertyPlantEquipment: "netPPE", goodWill: "goodwill", intangibleAssets: "otherIntangibleAssets",
    totalAssets: "totalAssets", accountsPayable: "accountsPayable", totalCurrentLiabilities: "currentLiabilities", shortLongTermDebt: "currentDebt",
    longTermDebt: "longTermDebt", totalLiab: "totalLiabilitiesNetMinorityInterest", totalStockholderEquity: "stockholdersEquity",
    retainedEarnings: "retainedEarnings",
  },
  cashflow: {
    netIncome: "netIncomeFromContinuingOperations", depreciation: "depreciationAndAmortization", totalCashFromOperatingActivities: "operatingCashFlow",
    capitalExpenditures: "capitalExpenditure", totalCashflowsFromInvestingActivities: "investingCashFlow", repurchaseOfStock: "repurchaseOfCapitalStock",
    dividendsPaid: "cashDividendsPaid", totalCashFromFinancingActivities: "financingCashFlow", changeInCash: "changesInCash", issuanceOfStock: "issuanceOfCapitalStock",
  },
};

async function legacyStatementRows(symbol: string, kind: StatementKind, frequency: Frequency): Promise<Array<Record<string, unknown>>> {
  const q = frequency === "quarterly" ? "Quarterly" : "";
  const [mod, listKey] =
    kind === "income" ? [`incomeStatementHistory${q}`, "incomeStatementHistory"]
    : kind === "balance" ? [`balanceSheetHistory${q}`, "balanceSheetStatements"]
    : [`cashflowStatementHistory${q}`, "cashflowStatements"];
  const res = (await call((c) => c.quoteSummary(symbol, { modules: [mod as never] }, NO_VALIDATE))) as Record<string, Record<string, unknown> | undefined>;
  const list = (res[mod]?.[listKey] ?? []) as Record<string, unknown>[];
  const map = LEGACY_KEYS[kind];
  const rows = list.map((r) => {
    const row: Record<string, unknown> = { date: r.endDate };
    for (const [from, to] of Object.entries(map)) if (r[from] !== undefined) row[to] = toNum(r[from]);
    return row;
  });
  if (kind === "cashflow") {
    for (const row of rows) {
      const ocf = toNum(row.operatingCashFlow);
      const capex = toNum(row.capitalExpenditure);
      if (ocf !== null && capex !== null) row.freeCashFlow = ocf + capex;
    }
  }
  return rows;
}
