import { beforeAll, describe, expect, it } from "vitest";

import { runClaude } from "@/lib/ai/anthropic";
import { buildContextNote } from "@/lib/ai/context";
import type { ChatEvent } from "@/lib/ai/events";
import { describeGeminiError, geminiDeclarations, modelChain, runGemini, setRetryDelayForTests } from "@/lib/ai/gemini";
import { SourceLog } from "@/lib/ai/sources";
import { executeTool, TOOL_NAMES, TOOLS } from "@/lib/ai/tools";
import { invalidate } from "@/lib/cache";
import { MOCK_UNKNOWN } from "@/lib/data/mock";

beforeAll(() => {
  setRetryDelayForTests(0);
  process.env.DATA_PROVIDER = "mock";
  invalidate();
});

const run = async (name: string, input: unknown) => {
  const [text, isError] = await executeTool(name, input);
  return { out: JSON.parse(text), isError };
};

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("tools", () => {
  it("are strict JSON schemas with every property required", () => {
    for (const t of TOOLS) {
      const s = t.jsonSchema as { additionalProperties: boolean; required: string[]; properties: object };
      expect(s.additionalProperties).toBe(false);
      expect(new Set(s.required)).toEqual(new Set(Object.keys(s.properties)));
    }
    expect(geminiDeclarations().map((d) => d.name)).toEqual([...TOOL_NAMES, "web_search"]);
  });

  it("return data with retrieval time, and explicit unavailability", async () => {
    const snap = await run("get_company_snapshot", { symbol: "aapl" });
    expect(snap.out).toMatchObject({ available: true, symbol: "AAPL" });
    expect(snap.out.retrieved_at).toBeTruthy();
    const none = await run("get_company_snapshot", { symbol: MOCK_UNKNOWN });
    expect(none.out.available).toBe(false);
    const stats = await run("get_key_statistics", { symbol: "AAPL", groups: ["Balance Sheet Health"] });
    expect(stats.out.groups["Balance Sheet Health"]["Quick Ratio (mrq)"]).toBeNull();
  });

  it("cover history, statements, ratios, holders, news and comparison", async () => {
    expect((await run("get_price_history", { symbol: "AAPL", period: "1y", interval: "1d" })).out.summary.available).toBe(true);
    const st = await run("get_financial_statement", { symbol: "AAPL", statement: "income", frequency: "annual", items: ["totalRevenue", "nope"] });
    expect(st.out.requested_but_not_reported).toEqual(["nope"]);
    expect(st.out.periods_newest_first).toHaveLength(4);
    const ratios = await run("get_financial_ratios", { symbol: "AAPL", frequency: "annual" });
    expect(Object.values(ratios.out.ratios_by_period["Gross Margin"])[0]).toBeCloseTo(0.45);
    expect((await run("get_holders", { symbol: "AAPL" })).out.top_institutional_holders[0].dateReported).toBe("2025-06-30");
    expect((await run("get_company_news", { symbol: "AAPL", limit: 3 })).out.articles).toHaveLength(3);
    const cmp = await run("compare_companies", { symbols: ["AAPL", "MSFT", MOCK_UNKNOWN], metrics: ["Trailing P/E"] });
    expect(Object.keys(cmp.out.metrics["Trailing P/E"])).toEqual(["AAPL", "MSFT"]);
    expect(cmp.out.unavailable_symbols[MOCK_UNKNOWN]).toBeTruthy();
  });

  it("validate inputs and calculate deterministically", async () => {
    expect((await run("calculate", { operation: "cagr", a: 121, b: 100, years: 2 })).out.result).toBeCloseTo(0.1);
    expect((await run("calculate", { operation: "ratio", a: 1, b: 0, years: 0 })).out.defined).toBe(false);
    expect((await run("get_company_snapshot", { symbol: "AAPL; rm" })).isError).toBe(true);
    expect((await run("get_price_history", { symbol: "AAPL", period: "7y", interval: "1d" })).isError).toBe(true);
    expect((await run("nope", {})).isError).toBe(true);
  });
});

describe("context and sources", () => {
  it("builds a bounded context note", () => {
    const note = buildContextNote({ symbol: "AAPL", company: { name: "Apple" }, section: "Financials", filters: { frequency: "annual" }, visible: { x: "y".repeat(9000) } });
    expect(note).toContain("Financials");
    expect(note).toContain("omitted");
    expect(note.length).toBeLessThan(5000);
  });
  it("records tool data and web links safely", () => {
    const log = new SourceLog();
    log.addToolResult("get_company_news", { symbol: "AAPL" }, JSON.stringify({ retrieved_at: "2025-01-01T00:00:00Z", articles: [{ url: "https://n/1", title: "T", publisher: "P" }] }));
    log.addWeb("javascript:x", "bad");
    log.addWeb("https://n/1", "T", null, true);
    const s = log.toJSON();
    expect(s.data[0]).toMatchObject({ tool: "get_company_news", symbol: "AAPL" });
    expect(s.web).toEqual([{ url: "https://n/1", title: "T, P", date: null, cited: true }]);
  });
});

describe("Claude runner (scripted client)", () => {
  function client(script: { content: Record<string, unknown>[]; stop_reason: string }[]) {
    const requests: Record<string, unknown>[] = [];
    return {
      requests,
      beta: {
        messages: {
          stream(params: Record<string, unknown>) {
            requests.push({ ...params, messages: [...(params.messages as unknown[])] });
            const msg = script.shift()!;
            return {
              async *[Symbol.asyncIterator]() {
                for (const b of msg.content) {
                  yield { type: "content_block_start", content_block: b };
                  if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } };
                }
              },
              finalMessage: async () => msg,
            };
          },
        },
      },
    };
  }

  it("runs tools in parallel, streams text and keeps history valid", async () => {
    const c = client([
      { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "t1", name: "get_company_snapshot", input: { symbol: "AAPL" } },
        { type: "tool_use", id: "t2", name: "calculate", input: { operation: "growth", a: 110, b: 100, years: 0 } },
      ] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Revenue grew 10%." }] },
    ]);
    const history: Record<string, unknown>[] = [];
    const events = await collect(runClaude(history, "How is AAPL?", "ctx", c as never));
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Revenue grew 10%.");
    expect(events.filter((e) => e.type === "step")).toHaveLength(2);
    expect(history.map((m) => m.role)).toEqual(["user", "system", "assistant", "user", "assistant"]);
    const req = c.requests[0];
    expect(req.fallbacks).toBe("default");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect((req.tools as { type?: string }[]).at(-1)?.type).toBe("web_search_20260209");
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.sources.data[0].tool).toBe("get_company_snapshot");
  });

  it("rolls back the turn on API failure", async () => {
    const failing = { beta: { messages: { stream: () => { throw new Error("connection reset"); } } } };
    const history: Record<string, unknown>[] = [{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }];
    const events = await collect(runClaude(history, "q", "ctx", failing as never));
    expect(events[0].type).toBe("error");
    expect(history).toHaveLength(2);
  });
});

describe("Gemini runner (scripted client)", () => {
  it("runs functions and grounded web search, and records citations", async () => {
    const script = [
      [{ candidates: [{ content: { parts: [{ functionCall: { name: "get_company_snapshot", args: { symbol: "AAPL" } } }, { functionCall: { name: "web_search", args: { query: "Apple earnings" } } }] } }] }],
      [{ candidates: [{ content: { parts: [{ text: "Apple looks " }, { text: "strong." }] } }] }],
    ];
    const fake = {
      models: {
        generateContentStream: async () => (async function* () { yield* script.shift()!; })(),
        generateContent: async () => ({ text: "Record revenue.", candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://news.example/a", title: "Example News" } }] } }] }),
      },
    };
    const history: { role: "user" | "model"; parts: unknown[] }[] = [];
    const events = await collect(runGemini(history as never, "How is AAPL?", "ctx", fake as never));
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Apple looks strong.");
    expect(history.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.sources.web[0].url).toBe("https://news.example/a");
    expect(done.sources.queries).toEqual(["Apple earnings"]);
  });

  it("explains quota errors and rolls back", async () => {
    const fake = { models: { generateContentStream: async () => { throw new Error("429 RESOURCE_EXHAUSTED"); }, generateContent: async () => ({}) } };
    const history = [{ role: "user", parts: [] }];
    const events = await collect(runGemini(history as never, "q", "ctx", fake as never));
    expect((events.find((e) => e.type === "error") as { text: string }).text).toMatch(/usage limit/);
    expect(history).toHaveLength(1);
  });
});

describe("Gemini busy handling", () => {
  it("retries a busy model, then falls back to a lighter one", async () => {
    const models: string[] = [];
    const fake = {
      models: {
        generateContentStream: async (p: { model: string }) => {
          models.push(p.model);
          if (models.length < 3) throw new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand."}}');
          return (async function* () { yield { candidates: [{ content: { parts: [{ text: "Answer." }] } }] }; })();
        },
        generateContent: async () => ({}),
      },
    };
    const events = await collect(runGemini([] as never, "q", "ctx", fake as never));
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Answer.");
    expect(models[2]).toBe(modelChain()[1]);
    expect(events.some((e) => e.type === "status" && /busy/.test((e as { text: string }).text))).toBe(false);
  });

  it("shows a plain message, never raw JSON, when everything is busy", async () => {
    const fake = { models: { generateContentStream: async () => { throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'); }, generateContent: async () => ({}) } };
    const events = await collect(runGemini([] as never, "q", "ctx", fake as never));
    const err = events.find((e) => e.type === "error") as { text: string };
    expect(err.text).toBe("The AI service is very busy right now. Please try again in a moment.");
    expect(describeGeminiError(new Error("API key not valid"))).toMatch(/GEMINI_API_KEY/);
  });
});

describe("openai-compatible runner", () => {
  const svc = (call: import("@/lib/ai/openai").Fetcher) => ({ name: "groq" as const, label: "Groq", models: () => ["m1", "m2"], call });
  it("runs a tool call then answers", async () => {
    const { runOpenAI } = await import("@/lib/ai/openai");
    let n = 0;
    const fake = async () =>
      n++ === 0
        ? { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function" as const, function: { name: "get_company_snapshot", arguments: '{"symbol":"AAPL"}' } }] } }] }
        : { choices: [{ message: { content: "Apple looks fine." } }] };
    const events = [];
    for await (const e of runOpenAI(svc(fake), [], "How is AAPL?", "ctx")) events.push(e);
    expect(events.some((e) => e.type === "step")).toBe(true);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toContain("Apple");
    expect(events.at(-1)?.type).toBe("done");
  });
  it("tries the next model when one fails", async () => {
    const { runOpenAI } = await import("@/lib/ai/openai");
    const seen: string[] = [];
    const fake = async (b: Record<string, unknown>) => {
      seen.push(b.model as string);
      if (b.model === "m1") throw new Error("503 overloaded");
      return { choices: [{ message: { content: "ok" } }] };
    };
    const events = [];
    for await (const e of runOpenAI(svc(fake), [], "hi", "ctx")) events.push(e);
    expect(seen).toEqual(["m1", "m2"]);
    expect(events.some((e) => e.type === "text")).toBe(true);
  });
  it("rolls back and explains errors", async () => {
    const { runOpenAI } = await import("@/lib/ai/openai");
    const h: Record<string, unknown>[] = [];
    const events = [];
    for await (const e of runOpenAI(svc(async () => { throw new Error("401 bad key"); }), h, "hi", "ctx")) events.push(e);
    expect(h.length).toBe(0);
    expect(events.some((e) => e.type === "error" && /GROQ_API_KEY/.test(e.text))).toBe(true);
  });
});

describe("provider failover", () => {
  it("moves to the next service when the first fails before answering", async () => {
    process.env.GROQ_API_KEY = "x";
    process.env.GEMINI_API_KEY = "y";
    const { runAnalyst } = await import("@/lib/ai");
    const done = { web: [], queries: [], data: [] };
    const runners = {
      anthropic: async function* () {},
      groq: async function* () {
        yield { type: "error" as const, text: "busy" };
        yield { type: "done" as const, sources: done, history: [], provider: "groq" };
      },
      gemini: async function* () {
        yield { type: "text" as const, text: "answer" };
        yield { type: "done" as const, sources: done, history: [], provider: "gemini" };
      },
      openrouter: async function* () {},
    };
    const events = [];
    for await (const e of runAnalyst({ message: "hi", history: [], provider: null, context: { symbol: null, company: null, section: null, filters: {}, visible: {} } }, runners)) events.push(e);
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect((events.at(-1) as { provider: string }).provider).toBe("gemini");
  });
  it("hides service names when every service fails", async () => {
    process.env.GROQ_API_KEY = "x";
    process.env.GEMINI_API_KEY = "y";
    const { runAnalyst } = await import("@/lib/ai");
    const done = { web: [], queries: [], data: [] };
    const fail = (p: string) => async function* () {
      yield { type: "error" as const, text: `The ${p} API key is missing or invalid.` };
      yield { type: "done" as const, sources: done, history: [], provider: p };
    };
    const runners = { anthropic: fail("Claude"), groq: fail("Groq"), gemini: fail("Gemini"), openrouter: fail("OpenRouter") };
    const events = [];
    const log = console.error;
    console.error = () => {};
    for await (const e of runAnalyst({ message: "hi", history: [], provider: null, context: { symbol: null, company: null, section: null, filters: {}, visible: {} } }, runners)) events.push(e);
    console.error = log;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const text = JSON.stringify(events.filter((e) => e.type !== "done"));
    expect(text).toMatch(/AI assistant is unavailable/);
    expect(text).not.toMatch(/groq|gemini|openrouter|claude/i);
  });
});

describe("follow-up questions", () => {
  it("splits them from the answer, also mid-stream", async () => {
    const { splitFollowUps, FOLLOWUP_MARKER } = await import("@/lib/ai/prompt");
    const full = `Apple grew revenue 6%.\n\n${FOLLOWUP_MARKER}\n- How do margins compare with Microsoft?\n- What drove services growth?\n- 3. Is the valuation stretched?`;
    expect(splitFollowUps(full)).toEqual({
      body: "Apple grew revenue 6%.",
      followUps: ["How do margins compare with Microsoft?", "What drove services growth?", "Is the valuation stretched?"],
    });
    expect(splitFollowUps("Apple grew.\n\n[[follow").body).toBe("Apple grew.");
    expect(splitFollowUps("No marker here").followUps).toEqual([]);
  });
});
