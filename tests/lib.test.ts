import { describe, expect, it } from "vitest";

import { cached, invalidate } from "@/lib/cache";
import { clampHistory, isValidSymbol, presetStart } from "@/lib/data";
import { normalizeStatement } from "@/lib/data/statements";
import { buildQuote, flattenModules } from "@/lib/data/yahoo";
import { fmtChange, fmtLarge, fmtPct, NA, safeUrl, toCsv, toNum } from "@/lib/format";
import { cagr, freeCashFlow, margin, pctChange, performanceTable, periodReturn, priceSummary, safeDiv, statementGrowth, statementRatios } from "@/lib/metrics";
import { groupRows } from "@/lib/statistics";
import type { PriceBar } from "@/lib/types";

function bars(start: string, n: number, f: (i: number) => number): PriceBar[] {
  const out: PriceBar[] = [];
  const d = new Date(start);
  for (let i = 0; out.length < n; i++) {
    const day = new Date(d.getTime() + i * 86400e3);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const v = f(out.length);
    out.push({ date: day.toISOString(), open: v, high: v, low: v, close: v, adjClose: v, volume: 1 });
  }
  return out;
}

describe("format", () => {
  it("never renders missing as zero", () => {
    expect(fmtLarge(null)).toBe(NA);
    expect(fmtLarge(0)).toBe("0.00");
    expect(fmtLarge(1_234_567_890)).toBe("1.23B");
    expect(fmtLarge(-2_500_000)).toBe("-2.50M");
    expect(fmtPct(0.1234)).toBe("12.34%");
    expect(fmtPct(1.5, { ratio: false, signed: true })).toBe("+1.50%");
    expect(fmtChange(1.5, 0.75)).toBe("+1.50 (+0.75%)");
    expect(toNum("Infinity")).toBeNull();
    expect(toNum({ raw: 3 })).toBe(3);
  });
  it("sanitizes links and csv", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://a.b")).toBe("https://a.b");
    expect(toCsv([["a,b", null, 2]])).toBe('"a,b",,2');
  });
  it("contains no em or en dashes in user-facing strings", () => {
    expect(NA).not.toMatch(/[–—]/);
  });
});

describe("metrics", () => {
  it("handles zero denominators and negative bases", () => {
    expect(safeDiv(1, 0)).toBeNull();
    expect(pctChange(-50, -100)).toBeCloseTo(0.5);
    expect(cagr(121, 100, 2)).toBeCloseTo(0.1);
    expect(cagr(100, -1, 2)).toBeNull();
    expect(margin(25, 0)).toBeNull();
  });
  it("refuses partial-period returns", () => {
    const b = bars("2024-01-01", 260, (i) => 100 + i);
    expect(periodReturn(b, new Date("2024-01-01"))).not.toBeNull();
    expect(periodReturn(b, new Date("2020-01-01"))).toBeNull();
  });
  it("builds a performance table vs benchmark", () => {
    const b = bars("2021-01-01", 900, (i) => 100 + i);
    const m = bars("2021-01-01", 900, (i) => 100 + i / 2);
    const rows = performanceTable(b, m);
    expect(rows.map((r) => r.period)).toEqual(["YTD", "1Y", "3Y", "5Y"]);
    expect(rows[1].difference).toBeCloseTo((rows[1].stock ?? 0) - (rows[1].benchmark ?? 0));
    expect(rows[3].stock).toBeNull();
  });
  it("summarizes prices", () => {
    expect(priceSummary([]).available).toBe(false);
    const s = priceSummary(bars("2024-01-01", 30, (i) => 100 + i));
    expect(s.totalReturn).toBeCloseTo(0.29);
    expect(s.maxDrawdown).toBe(0);
  });
});

describe("statements", () => {
  const rows = [
    { date: new Date("2023-12-31"), totalRevenue: 800, grossProfit: 300, netIncome: 90, someObscureItem: 1 },
    { date: new Date("2024-12-31"), totalRevenue: 1000, grossProfit: 400, netIncome: 150, pretaxIncome: 180, taxProvision: 30 },
    { date: new Date("2019-12-31") },
  ];
  const stmt = normalizeStatement("X", "income", "annual", rows);
  it("orders periods and rows, drops empty periods", () => {
    expect(stmt.periods.map((p) => p.slice(0, 10))).toEqual(["2024-12-31", "2023-12-31"]);
    expect(stmt.lines[0].key).toBe("totalRevenue");
    expect(stmt.lines.at(-1)?.label).toBe("Some Obscure Item");
    expect(stmt.lines.find((l) => l.key === "pretaxIncome")?.values).toEqual([180, null]);
  });
  it("computes ratios only on matching balance periods", () => {
    const bal = normalizeStatement("X", "balance", "annual", [{ date: new Date("2024-12-31"), stockholdersEquity: 1000, totalAssets: 3000, currentAssets: 400, currentLiabilities: 200 }]);
    const r = Object.fromEntries(statementRatios(stmt, bal).map((x) => [x.label, x.values]));
    expect(r["Gross Margin"][0]).toBeCloseTo(0.4);
    expect(r["Return on Equity (period-end)"][0]).toBeCloseTo(0.15);
    expect(r["Return on Equity (period-end)"][1]).toBeNull();
    expect(r["Current Ratio"][0]).toBeCloseTo(2);
    expect(statementGrowth(stmt, "totalRevenue")[0]).toBeCloseTo(0.25);
  });
  it("derives free cash flow when not reported", () => {
    const cf = normalizeStatement("X", "cashflow", "annual", [{ date: new Date("2024-12-31"), operatingCashFlow: 500, capitalExpenditure: -120 }]);
    expect(freeCashFlow(cf)).toBe(380);
  });
});

describe("yahoo normalization", () => {
  it("flattens modules and normalizes percent units", () => {
    const f = flattenModules([{ symbol: "aapl", regularMarketPrice: 110, regularMarketPreviousClose: 100, regularMarketChangePercent: 0.1, maxAge: 1 }, { regularMarketPrice: 999, exDividendDate: new Date("2025-01-02") }]);
    expect(f.regularMarketPrice).toBe(110);
    expect(f.exDividendDate).toBe("2025-01-02T00:00:00.000Z");
    const q = buildQuote("AAPL", f, true);
    expect(q.changePercent).toBeCloseTo(10);
    expect(q.change).toBeCloseTo(10);
    expect(buildQuote("AAPL", { ...f, regularMarketChangePercent: 10 }, false).changePercent).toBe(10);
  });
  it("statistics rows show NA for missing fields", () => {
    const rows = groupRows({ fields: { trailingPE: 20 } }, "Valuation Measures");
    expect(rows.find((r) => r.field === "trailingPE")?.display).toBe("20.00");
    expect(rows.find((r) => r.field === "pegRatio")?.display).toBe(NA);
  });
});

describe("validation and cache", () => {
  it("validates symbols and clamps history", () => {
    for (const ok of ["AAPL", "brk-b", "RELIANCE.NS", "^GSPC", "EURUSD=X"]) expect(isValidSymbol(ok)).toBe(true);
    for (const bad of ["", "AAPL; rm", "a b"]) expect(isValidSymbol(bad)).toBe(false);
    const now = new Date("2025-06-30T00:00:00Z");
    const c = clampHistory(new Date("2025-01-01"), now, "1m", now);
    expect(c.note).toMatch(/last 7 days/);
    expect(presetStart("YTD", now).toISOString().slice(0, 10)).toBe("2025-01-01");
  });
  it("retries, caches and falls back to stale data", async () => {
    invalidate();
    let n = 0;
    const r1 = await cached("k", 60, async () => {
      if (++n < 2) throw new Error("boom");
      return 42;
    }, { backoffMs: 1 });
    expect(r1.data).toBe(42);
    expect((await cached("k", 60, async () => 0)).data).toBe(42);
    const r3 = await cached("k", 0, async () => { throw new Error("down"); }, { retries: 0 });
    expect(r3.stale).toBe(true);
    expect(r3.data).toBe(42);
    const r4 = await cached("never", 60, async () => { throw new Error("nope"); }, { retries: 0 });
    expect(r4.data).toBeNull();
    expect(r4.error).toMatch(/nope/);
  });
});
