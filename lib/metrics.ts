/**
 * Deterministic financial calculations shared by the UI and the AI analyst's tools.
 * Missing inputs or meaningless denominators return null, never 0.
 */
import { toNum } from "./format";
import type { Num, PerformanceRow, PriceBar, Statement } from "./types";

export function safeDiv(a: unknown, b: unknown): Num {
  const x = toNum(a);
  const y = toNum(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

/** Growth as a ratio (0.10 = +10%). Uses |previous| so growth from a negative base keeps its direction. */
export function pctChange(current: unknown, previous: unknown): Num {
  const c = toNum(current);
  const p = toNum(previous);
  if (c === null || p === null || p === 0) return null;
  return (c - p) / Math.abs(p);
}

export function cagr(end: unknown, start: unknown, years: number): Num {
  const e = toNum(end);
  const s = toNum(start);
  if (e === null || s === null || years <= 0 || s <= 0 || e <= 0) return null;
  return (e / s) ** (1 / years) - 1;
}

export function margin(part: unknown, revenue: unknown): Num {
  const r = toNum(revenue);
  if (r === null || r <= 0) return null;
  return safeDiv(part, r);
}

// ----------------------------------------------------------------------------------------- prices

/** Closing series, preferring adjusted closes for return math. */
export function closes(bars: PriceBar[], adjusted = true): { t: number; v: number }[] {
  const useAdj = adjusted && bars.some((b) => b.adjClose !== null);
  return bars
    .map((b) => ({ t: Date.parse(b.date), v: (useAdj ? b.adjClose : b.close) as number | null }))
    .filter((p): p is { t: number; v: number } => p.v !== null && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Return between the last close on/before `start` and the last close on/before `end`; null if history doesn't cover it. */
export function periodReturn(bars: PriceBar[], start: Date, end?: Date): Num {
  const s = closes(bars);
  if (s.length < 2) return null;
  const startT = start.getTime();
  const endT = end ? end.getTime() : s[s.length - 1].t;
  if (s[0].t > startT + 5 * 86400e3) return null;
  const before = s.filter((p) => p.t <= startT);
  const base = before.length ? before[before.length - 1].v : s[0].v;
  const upto = s.filter((p) => p.t <= endT);
  if (!upto.length) return null;
  return pctChange(upto[upto.length - 1].v, base);
}

export function performanceTable(stock: PriceBar[], bench: PriceBar[] | null): PerformanceRow[] {
  const s = closes(stock);
  const asOf = s.length ? new Date(s[s.length - 1].t) : new Date();
  const back = (years: number) => new Date(Date.UTC(asOf.getUTCFullYear() - years, asOf.getUTCMonth(), asOf.getUTCDate()));
  const periods: [PerformanceRow["period"], Date][] = [
    ["YTD", new Date(Date.UTC(asOf.getUTCFullYear() - 1, 11, 31))],
    ["1Y", back(1)],
    ["3Y", back(3)],
    ["5Y", back(5)],
  ];
  return periods.map(([period, start]) => {
    const st = periodReturn(stock, start, asOf);
    const bm = bench ? periodReturn(bench, start, asOf) : null;
    return { period, stock: st, benchmark: bm, difference: st !== null && bm !== null ? st - bm : null };
  });
}

export function annualizedVolatility(bars: PriceBar[], periodsPerYear = 252): Num {
  const s = closes(bars);
  if (s.length < 20) return null;
  const rets = s.slice(1).map((p, i) => p.v / s[i].v - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(bars: PriceBar[]): Num {
  const s = closes(bars);
  if (s.length < 2) return null;
  let peak = s[0].v;
  let worst = 0;
  for (const p of s) {
    peak = Math.max(peak, p.v);
    worst = Math.min(worst, p.v / peak - 1);
  }
  return worst;
}

export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = values.slice(i + 1 - window, i + 1);
    if (slice.some((v) => v === null)) return null;
    return (slice as number[]).reduce((a, b) => a + b, 0) / window;
  });
}

export interface PriceSummary {
  available: boolean;
  startDate?: string;
  endDate?: string;
  startPrice?: number;
  endPrice?: number;
  high?: number;
  low?: number;
  totalReturn?: Num;
  annualizedVolatility?: Num;
  maxDrawdown?: Num;
  observations?: number;
  priceBasis?: "Adj Close" | "Close";
}

export function priceSummary(bars: PriceBar[], dailyBars = true): PriceSummary {
  const s = closes(bars);
  if (!s.length) return { available: false };
  const highs = bars.map((b) => b.high).filter((v): v is number => v !== null);
  const lows = bars.map((b) => b.low).filter((v): v is number => v !== null);
  return {
    available: true,
    startDate: new Date(s[0].t).toISOString().slice(0, 10),
    endDate: new Date(s[s.length - 1].t).toISOString().slice(0, 10),
    startPrice: s[0].v,
    endPrice: s[s.length - 1].v,
    high: highs.length ? Math.max(...highs) : undefined,
    low: lows.length ? Math.min(...lows) : undefined,
    totalReturn: pctChange(s[s.length - 1].v, s[0].v),
    annualizedVolatility: dailyBars ? annualizedVolatility(bars) : null,
    maxDrawdown: maxDrawdown(bars),
    observations: s.length,
    priceBasis: bars.some((b) => b.adjClose !== null) ? "Adj Close" : "Close",
  };
}

// ------------------------------------------------------------------------------------ statements

const val = (stmt: Statement | null, key: string, period: string): Num => {
  if (!stmt) return null;
  const i = stmt.periods.indexOf(period);
  const line = stmt.lines.find((l) => l.key === key);
  return i < 0 || !line ? null : line.values[i] ?? null;
};

/** Period-over-period growth for one line, aligned with stmt.periods (newest first). */
export function statementGrowth(stmt: Statement, key: string): Num[] {
  const line = stmt.lines.find((l) => l.key === key);
  if (!line) return [];
  return line.values.map((v, i) => (i + 1 < line.values.length ? pctChange(v, line.values[i + 1]) : null));
}

export type RatioRow = { label: string; kind: "pct" | "ratio"; values: Num[] };

/**
 * Margins and returns per income-statement period. Balance-sheet ratios only use a balance-sheet
 * period with exactly the same date (no mixing of incompatible periods).
 */
export function statementRatios(income: Statement, balance: Statement | null): RatioRow[] {
  const p = income.periods;
  const row = (label: string, kind: RatioRow["kind"], f: (period: string) => Num): RatioRow => ({ label, kind, values: p.map(f) });
  const rev = (x: string) => val(income, "totalRevenue", x);
  const equity = (x: string) => {
    const e = val(balance, "stockholdersEquity", x);
    return e !== null && e > 0 ? e : null;
  };
  const rows = [
    row("Gross Margin", "pct", (x) => margin(val(income, "grossProfit", x), rev(x))),
    row("Operating Margin", "pct", (x) => margin(val(income, "operatingIncome", x), rev(x))),
    row("EBITDA Margin", "pct", (x) => margin(val(income, "EBITDA", x), rev(x))),
    row("Net Margin", "pct", (x) => margin(val(income, "netIncome", x), rev(x))),
    row("Effective Tax Rate", "pct", (x) => safeDiv(val(income, "taxProvision", x), val(income, "pretaxIncome", x))),
    row("R&D as % of Revenue", "pct", (x) => margin(val(income, "researchAndDevelopment", x), rev(x))),
  ];
  if (balance && balance.periods.length) {
    rows.push(
      row("Return on Equity (period-end)", "pct", (x) => safeDiv(val(income, "netIncome", x), equity(x))),
      row("Return on Assets (period-end)", "pct", (x) => safeDiv(val(income, "netIncome", x), val(balance, "totalAssets", x))),
      row("Debt to Equity", "ratio", (x) => safeDiv(val(balance, "totalDebt", x), equity(x))),
      row("Current Ratio", "ratio", (x) => safeDiv(val(balance, "currentAssets", x), val(balance, "currentLiabilities", x))),
    );
  }
  return rows;
}

export function freeCashFlow(cashflow: Statement, periodIndex = 0): Num {
  const get = (k: string) => cashflow.lines.find((l) => l.key === k)?.values[periodIndex] ?? null;
  const reported = get("freeCashFlow");
  if (reported !== null) return reported;
  const ocf = get("operatingCashFlow");
  const capex = get("capitalExpenditure");
  if (ocf === null || capex === null) return null;
  return capex < 0 ? ocf + capex : ocf - capex;
}
