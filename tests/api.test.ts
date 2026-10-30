/** API route handlers against the mock provider: shapes, status codes and validation. */
import { beforeAll, describe, expect, it } from "vitest";

import { GET as company } from "@/app/api/company/[symbol]/route";
import { GET as financials } from "@/app/api/financials/route";
import { GET as history } from "@/app/api/history/route";
import { GET as holders } from "@/app/api/holders/route";
import { GET as news } from "@/app/api/news/route";
import { GET as performance } from "@/app/api/performance/route";
import { GET as quotes } from "@/app/api/quotes/route";
import { GET as search } from "@/app/api/search/route";
import { POST as chat, GET as chatInfo } from "@/app/api/chat/route";
import { invalidate } from "@/lib/cache";

beforeAll(() => {
  process.env.DATA_PROVIDER = "mock";
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  invalidate();
});

const req = (path: string) => new Request(`http://localhost${path}`);

describe("api routes", () => {
  it("search and quotes", async () => {
    const s = await (await search(req("/api/search?q=app"))).json();
    expect(s.data[0].symbol).toBe("AAPL");
    const q = await (await quotes(req("/api/quotes?symbols=AAPL,MSFT,bad%20one"))).json();
    expect(q.data.map((x: { symbol: string }) => x.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("company, including unknown and invalid symbols", async () => {
    const ok = await company(req("/api/company/AAPL"), { params: Promise.resolve({ symbol: "AAPL" }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.name).toBe("Apple Inc.");
    expect(ok.headers.get("Cache-Control")).toMatch(/s-maxage/);
    const missing = await company(req("/api/company/ZZZZ"), { params: Promise.resolve({ symbol: "ZZZZ" }) });
    expect(missing.status).toBe(502);
    const bad = await company(req("/api/company/x"), { params: Promise.resolve({ symbol: "a b" }) });
    expect(bad.status).toBe(400);
  });

  it("history with presets, custom ranges and intraday limits", async () => {
    const h = await (await history(req("/api/history?symbol=AAPL&range=1Y&interval=1d"))).json();
    expect(h.data.bars.length).toBeGreaterThan(200);
    const intraday = await history(req("/api/history?symbol=AAPL&range=1Y&interval=1m"));
    expect(intraday.headers.get("X-Range-Note")).toMatch(/7 days/);
    expect((await history(req("/api/history?symbol=AAPL&range=9Y"))).status).toBe(400);
    expect((await history(req("/api/history?symbol=AAPL&start=2024-01-01&end=2024-02-01&interval=1wk"))).status).toBe(200);
  });

  it("financials, holders, news and performance", async () => {
    const f = await (await financials(req("/api/financials?symbol=AAPL&statement=balance&frequency=quarterly"))).json();
    expect(f.data.kind).toBe("balance");
    expect((await financials(req("/api/financials?symbol=AAPL&statement=nope"))).status).toBe(400);
    const h = await (await holders(req("/api/holders?symbol=AAPL"))).json();
    expect(h.data.institutional).toHaveLength(5);
    const n = await (await news(req("/api/news?symbol=AAPL&name=Apple"))).json();
    expect(n.data.length).toBeGreaterThan(0);
    const p = await (await performance(req("/api/performance?symbol=AAPL"))).json();
    expect(p.data.rows.map((r: { period: string }) => r.period)).toEqual(["YTD", "1Y", "3Y", "5Y"]);
  });

  it("chat reports missing configuration and validates the body", async () => {
    expect(await chatInfo().json()).toEqual({ provider: null });
    expect((await chat(new Request("http://localhost/api/chat", { method: "POST", body: "{}" }))).status).toBe(400);
    const res = await chat(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ message: "hi", history: [], provider: null, context: {} }) }));
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("error");
    expect(lines.at(-1).type).toBe("done");
  });
});
