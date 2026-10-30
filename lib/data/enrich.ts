/**
 * Fills statistics the data source did not report, using deterministic calculations on the company's own
 * price history and reported statements. Every filled field is listed in `derived` so the UI can mark it as
 * calculated. Existing reported values are never overwritten.
 */
import { toNum } from "../format";
import { closes, pctChange, safeDiv } from "../metrics";
import type { Dividend, PriceBar, Split, Statement } from "../types";

export interface EnrichInputs {
  price: number | null;
  bars1y?: PriceBar[] | null; // daily, about one year
  benchBars1y?: PriceBar[] | null; // benchmark index, same window
  dividends?: Dividend[] | null; // full history
  splits?: Split[] | null;
  incomeQ?: Statement | null;
  incomeA?: Statement | null;
  balanceQ?: Statement | null;
  cashflowQ?: Statement | null;
}

type Fields = Record<string, number | string | null>;

const line = (s: Statement | null | undefined, key: string): (number | null)[] => s?.lines.find((l) => l.key === key)?.values ?? [];
const latest = (s: Statement | null | undefined, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = line(s, k)[0];
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

/** Sum of the latest four quarters; null unless all four are reported. */
export function ttm(s: Statement | null | undefined, key: string): number | null {
  const v = line(s, key).slice(0, 4);
  if (v.length < 4 || v.some((x) => x === null)) return null;
  return (v as number[]).reduce((a, b) => a + b, 0);
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function dailyReturns(bars: PriceBar[]): Map<string, number> {
  const s = closes(bars);
  const out = new Map<string, number>();
  for (let i = 1; i < s.length; i++) out.set(new Date(s[i].t).toISOString().slice(0, 10), s[i].v / s[i - 1].v - 1);
  return out;
}

/** Beta of daily returns against the benchmark on matching dates (needs 60+ overlapping days). */
export function beta(stock: PriceBar[], bench: PriceBar[]): number | null {
  const a = dailyReturns(stock);
  const b = dailyReturns(bench);
  const pairs: [number, number][] = [];
  for (const [d, r] of a) if (b.has(d)) pairs.push([r, b.get(d)!]);
  if (pairs.length < 60) return null;
  const ma = mean(pairs.map((p) => p[0]))!;
  const mb = mean(pairs.map((p) => p[1]))!;
  let cov = 0;
  let varB = 0;
  for (const [x, y] of pairs) {
    cov += (x - ma) * (y - mb);
    varB += (y - mb) ** 2;
  }
  return varB === 0 ? null : cov / varB;
}

export function deriveFields(reported: Fields, inp: EnrichInputs): { fields: Fields; derived: string[] } {
  const f: Fields = { ...reported };
  const derived: string[] = [];
  const has = (k: string) => toNum(f[k]) !== null || (typeof f[k] === "string" && f[k] !== "");
  const set = (k: string, v: number | string | null | undefined) => {
    if (has(k) || v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return;
    f[k] = v;
    derived.push(k);
  };
  const num = (k: string) => toNum(f[k]);
  const price = inp.price ?? num("regularMarketPrice") ?? num("currentPrice");

  // ---- from daily prices
  const bars = inp.bars1y ?? [];
  if (bars.length) {
    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    set("previousClose", prev?.close);
    set("open", last.open);
    set("dayHigh", last.high);
    set("dayLow", last.low);
    set("volume", last.volume);
    const highs = bars.map((b) => b.high).filter((v): v is number => v !== null);
    const lows = bars.map((b) => b.low).filter((v): v is number => v !== null);
    if (highs.length) set("fiftyTwoWeekHigh", Math.max(...highs));
    if (lows.length) set("fiftyTwoWeekLow", Math.min(...lows));
    const vols = bars.map((b) => b.volume).filter((v): v is number => v !== null);
    if (vols.length >= 20) set("averageVolume", mean(vols.slice(-63)));
    if (vols.length >= 10) set("averageVolume10days", mean(vols.slice(-10)));
    const c = bars.map((b) => b.close).filter((v): v is number => v !== null);
    if (c.length >= 50) set("fiftyDayAverage", mean(c.slice(-50)));
    if (c.length >= 200) set("twoHundredDayAverage", mean(c.slice(-200)));
    const adj = closes(bars);
    if (adj.length > 200) set("52WeekChange", pctChange(adj[adj.length - 1].v, adj[0].v));
    const bench = inp.benchBars1y ?? [];
    if (bench.length > 200) {
      const bc = closes(bench);
      set("SandP52WeekChange", pctChange(bc[bc.length - 1].v, bc[0].v));
      set("beta", beta(bars, bench));
    }
  }

  // ---- from statements (trailing twelve months from quarterly data, latest quarter for balances)
  const inc = inp.incomeQ;
  const revenue = ttm(inc, "totalRevenue");
  const gross = ttm(inc, "grossProfit");
  const opInc = ttm(inc, "operatingIncome");
  const ebitda = ttm(inc, "EBITDA");
  const netIncome = ttm(inc, "netIncome");
  const eps = ttm(inc, "dilutedEPS") ?? ttm(inc, "basicEPS");
  set("totalRevenue", revenue);
  set("grossProfits", gross);
  set("ebitda", ebitda);
  set("netIncomeToCommon", ttm(inc, "netIncomeCommonStockholders") ?? netIncome);
  set("trailingEps", eps);
  set("grossMargins", safeDiv(gross, revenue));
  set("operatingMargins", safeDiv(opInc, revenue));
  set("ebitdaMargins", safeDiv(ebitda, revenue));
  set("profitMargins", safeDiv(netIncome, revenue));
  const revQ = line(inc, "totalRevenue");
  const niQ = line(inc, "netIncome");
  if (revQ.length >= 5) set("revenueGrowth", pctChange(revQ[0], revQ[4]));
  if (niQ.length >= 5) set("earningsQuarterlyGrowth", pctChange(niQ[0], niQ[4]));
  if (inc?.periods.length) set("mostRecentQuarter", inc.periods[0]);
  if (inp.incomeA?.periods.length) set("lastFiscalYearEnd", inp.incomeA.periods[0]);

  const bal = inp.balanceQ;
  const cash = latest(bal, "cashCashEquivalentsAndShortTermInvestments") ??
    (latest(bal, "cashAndCashEquivalents") !== null ? (latest(bal, "cashAndCashEquivalents") as number) + (latest(bal, "otherShortTermInvestments") ?? 0) : null);
  const debt = latest(bal, "totalDebt");
  const equity = latest(bal, "stockholdersEquity");
  const assets = latest(bal, "totalAssets");
  const shares = latest(bal, "ordinarySharesNumber");
  set("totalCash", cash);
  set("totalDebt", debt);
  if (equity !== null && equity > 0) {
    set("debtToEquity", debt !== null ? (debt / equity) * 100 : null);
    set("returnOnEquity", safeDiv(netIncome, equity));
  }
  set("returnOnAssets", safeDiv(netIncome, assets));
  set("currentRatio", safeDiv(latest(bal, "currentAssets"), latest(bal, "currentLiabilities")));
  set("sharesOutstanding", shares ?? latest(inc, "dilutedAverageShares", "basicAverageShares"));
  const sharesOut = num("sharesOutstanding");
  set("bookValue", safeDiv(equity, sharesOut));
  set("totalCashPerShare", safeDiv(num("totalCash"), sharesOut));
  set("revenuePerShare", safeDiv(num("totalRevenue"), sharesOut));

  const cf = inp.cashflowQ;
  set("operatingCashflow", ttm(cf, "operatingCashFlow"));
  set("freeCashflow", ttm(cf, "freeCashFlow"));

  // ---- valuation from price and the figures above
  if (price !== null) {
    set("marketCap", sharesOut !== null ? price * sharesOut : null);
    const e = num("trailingEps");
    if (e !== null && e > 0) set("trailingPE", price / e);
    set("priceToBook", (num("bookValue") ?? 0) > 0 ? safeDiv(price, num("bookValue")) : null);
  }
  const mcap = num("marketCap");
  set("priceToSalesTrailing12Months", safeDiv(mcap, num("totalRevenue")));
  if (mcap !== null && num("totalDebt") !== null && num("totalCash") !== null) {
    set("enterpriseValue", mcap + (num("totalDebt") as number) - (num("totalCash") as number));
  }
  set("enterpriseToRevenue", safeDiv(num("enterpriseValue"), num("totalRevenue")));
  if ((num("ebitda") ?? 0) > 0) set("enterpriseToEbitda", safeDiv(num("enterpriseValue"), num("ebitda")));

  // ---- dividends and splits
  const divs = [...(inp.dividends ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (divs.length) {
    const yearAgo = Date.now() - 365 * 86400e3;
    const trailing = divs.filter((d) => Date.parse(d.date) >= yearAgo).reduce((a, d) => a + d.amount, 0);
    if (trailing > 0) {
      set("trailingAnnualDividendRate", trailing);
      if (price) set("trailingAnnualDividendYield", trailing / price);
      const e = num("trailingEps");
      if (e !== null && e > 0) set("payoutRatio", trailing / e);
    }
    set("lastDividendDate", divs[divs.length - 1].date);
    set("lastDividendValue", divs[divs.length - 1].amount);
  }
  const splits = [...(inp.splits ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (splits.length) {
    set("lastSplitFactor", splits[splits.length - 1].ratio);
    set("lastSplitDate", splits[splits.length - 1].date);
  }
  return { fields: f, derived };
}

/** Which input groups are worth fetching, given what is still missing. */
export function enrichmentNeeds(fields: Fields): { prices: boolean; statements: boolean; actions: boolean } {
  const missing = (keys: string[]) => keys.some((k) => toNum(fields[k]) === null && !(typeof fields[k] === "string" && fields[k]));
  return {
    prices: missing(["fiftyTwoWeekHigh", "fiftyTwoWeekLow", "averageVolume", "fiftyDayAverage", "twoHundredDayAverage", "beta", "52WeekChange", "previousClose", "open"]),
    statements: missing(["totalRevenue", "trailingEps", "profitMargins", "grossMargins", "returnOnEquity", "totalCash", "totalDebt", "marketCap", "trailingPE", "operatingCashflow", "mostRecentQuarter", "lastFiscalYearEnd", "sharesOutstanding", "bookValue"]),
    actions: missing(["trailingAnnualDividendRate", "lastSplitFactor", "lastDividendDate"]),
  };
}
