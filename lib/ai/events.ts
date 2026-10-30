/**
 * Chat wire protocol shared by the /api/chat route (server) and the ChatPanel (client).
 * The route streams one JSON-encoded ChatEvent per line (NDJSON).
 */

export interface Sources {
  web: { url: string; title: string; date: string | null; cited: boolean }[];
  queries: string[];
  data: { tool: string; symbol: string | null; retrievedAt: string }[];
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "step"; text: string; isError: boolean }
  | { type: "error"; text: string }
  | { type: "done"; sources: Sources; history: unknown[]; provider: string };

/** Request body for POST /api/chat. `history` is the opaque provider transcript from the last `done` event. */
export interface ChatRequest {
  message: string;
  history: unknown[];
  provider: string | null;
  context: {
    symbol: string | null;
    company: Record<string, unknown> | null;
    section: string | null;
    filters: Record<string, unknown>;
    visible: Record<string, unknown>;
  };
}

export const TOOL_LABELS: Record<string, string> = {
  get_company_snapshot: "company snapshot",
  get_key_statistics: "key statistics",
  get_price_history: "price history",
  get_financial_statement: "financial statement",
  get_financial_ratios: "financial ratios",
  get_holders: "ownership data",
  get_company_news: "company news",
  get_market_news: "market news",
  compare_companies: "peer comparison",
  calculate: "calculation",
  search_companies: "ticker lookup",
  web_search: "web search",
};

export function describeToolCall(name: string, input: unknown): string {
  const label = TOOL_LABELS[name] ?? name;
  if (!input || typeof input !== "object") return `Fetching ${label}`;
  const i = input as Record<string, unknown>;
  if (name === "web_search" && typeof i.query === "string") return `Searching the web: ${i.query}`;
  const target = typeof i.symbol === "string" ? i.symbol : Array.isArray(i.symbols) ? i.symbols.join(", ") : "";
  const extra = ["statement", "frequency", "period", "operation"].map((k) => i[k]).filter((v) => typeof v === "string").join(" ");
  return `Fetching ${label}${target ? ` for ${target}` : ""}${extra ? ` (${extra})` : ""}`;
}
