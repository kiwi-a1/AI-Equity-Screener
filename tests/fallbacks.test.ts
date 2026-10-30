/** Proves the "never empty" guarantees using the sparse mock company, whose detailed feeds are all empty. */
import { beforeAll, describe, expect, it } from "vitest";

import { GET as history } from "@/app/api/history/route";
import { invalidate } from "@/lib/cache";
import { getCompany, getHolders, getNews, getQuotes, getStatement } from "@/lib/data";
import { beta, deriveFields, enrichmentNeeds, ttm } from "@/lib/data/enrich";
import { MOCK_SPARSE } from "@/lib/data/mock";
import { filingLinks, newsResources } from "@/lib/data/resources";
import { normalizeStatement } from "@/lib/data/statements";
import type { PriceBar } from "@/lib/types";

beforeAll(() => {
  process.env.DATA_PROVIDER = "mock";
  invalidate();
});

const bars = (n: number, f: (i: number) => number): PriceBar[] =>
  Array.from({ length: n }, (_, i) => {
    const v = f(i);
    return { date: new Date(Date.UTC(2025, 0, 1) + i * 86400e3).toISOString(), open: v, high: v * 1.01, low: v * 0.99, close: v, adjClose: v, volume: 1000 + i };
  });

describe("enrichment", () => {
  const incomeQ = normalizeStatement("X", "income", "quarterly", [0, 1, 2, 3, 4].map((i) => ({
    date: new Date(Date.UTC(2025, 8 - 3 * i, 30)), totalRevenue: 100 - i * 5, grossProfit: 40, operatingIncome: 20, netIncome: 10, dilutedEPS: 0.5,
  })));
  const balanceQ = normalizeStatement("X", "balance", "quarterly", [{ date: new Date(Date.UTC(2025, 8, 30)), stockholdersEquity: 200, totalAssets: 500, totalDebt: 100, cashAndCashEquivalents: 50, ordinarySharesNumber: 20, currentAssets: 90, currentLiabilities: 60 }]);

  it("computes trailing twelve months only from four complete quarters", () => {
    expect(ttm(incomeQ, "totalRevenue")).toBe(100 + 95 + 90 + 85);
    expect(ttm(incomeQ, "missing")).toBeNull();
  });

  it("fills missing statistics, marks them derived, and never overwrites reported values", () => {
    const { fields, derived } = deriveFields({ trailingPE: 99 }, { price: 50, bars1y: bars(260, (i) => 40 + i / 10), benchBars1y: bars(260, (i) => 100 + i / 20), incomeQ, balanceQ });
    expect(fields.trailingPE).toBe(99);
    expect(derived).not.toContain("trailingPE");
    expect(fields.trailingEps).toBe(2);
    expect(fields.marketCap).toBe(1000);
    expect(fields.profitMargins).toBeCloseTo(40 / 370);
    expect(fields.debtToEquity).toBeCloseTo(50);
    expect(fields.bookValue).toBe(10);
    expect(fields.enterpriseValue).toBe(1050);
    expect(fields.revenueGrowth).toBeCloseTo(0.25);
    expect(fields.fiftyTwoWeekHigh).toBeGreaterThan(60);
    expect(fields.twoHundredDayAverage).not.toBeNull();
    expect(derived).toEqual(expect.arrayContaining(["marketCap", "trailingEps", "beta", "fiftyTwoWeekLow"]));
  });

  it("knows which inputs are worth fetching", () => {
    expect(enrichmentNeeds({})).toEqual({ prices: true, statements: true, actions: true });
  });

  it("computes beta against the benchmark", () => {
    const b = bars(200, (i) => 100 * (1 + 0.01 * Math.sin(i)));
    const s = bars(200, (i) => 100 * (1 + 0.02 * Math.sin(i)));
    expect(beta(s, b)).toBeGreaterThan(1.5);
  });
});

describe("official resource links", () => {
  it("covers US and Indian listings", () => {
    expect(filingLinks("AAPL", "Apple")[0].url).toContain("sec.gov");
    expect(filingLinks("RELIANCE.NS", "Reliance")[0].url).toContain("nseindia.com");
    const items = newsResources("AAPL", "Apple", "https://apple.com");
    expect(items[0]).toMatchObject({ source: "resource", url: "https://apple.com" });
    expect(items.every((i) => i.title && i.summary)).toBe(true);
  });
});

describe("sparse company: every section still has content", () => {
  it("company statistics are calculated from statements and prices", async () => {
    const c = (await getCompany(MOCK_SPARSE)).data!;
    expect(c.partial).toBe(true);
    for (const k of ["marketCap", "trailingPE", "fiftyTwoWeekHigh", "averageVolume", "totalRevenue", "profitMargins", "beta"]) {
      expect(c.fields[k], k).not.toBeUndefined();
      expect(c.derived).toContain(k);
    }
  });

  it("news falls back to official sources", async () => {
    const n = (await getNews(MOCK_SPARSE, null)).data!;
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((i) => i.source === "resource")).toBe(true);
  });

  it("holders fall back to key-statistics percentages and filing links", async () => {
    const h = (await getHolders(MOCK_SPARSE)).data!;
    expect(h.resources.length).toBeGreaterThan(0);
    expect(h.institutional).toEqual([]);
  });

  it("annual statements are empty but quarterly exist for the UI fallback", async () => {
    expect((await getStatement(MOCK_SPARSE, "income", "annual")).data!.lines).toHaveLength(0);
    expect((await getStatement(MOCK_SPARSE, "income", "quarterly")).data!.lines.length).toBeGreaterThan(0);
  });

  it("quotes come back for every requested symbol", async () => {
    const q = (await getQuotes(["AAPL", MOCK_SPARSE])).data!;
    expect(q.map((x) => x.symbol)).toEqual(["AAPL", MOCK_SPARSE]);
  });

  it("an empty custom range widens to daily prices with a note", async () => {
    const res = await history(new Request("http://localhost/api/history?symbol=AAPL&start=2025-01-04&end=2025-01-05&interval=1d"));
    const body = await res.json();
    expect(body.data.bars.length).toBeGreaterThan(0);
    expect(res.headers.get("X-Range-Note")).toMatch(/daily prices/);
  });
});
