/** Server-side configuration from environment variables (set them in Vercel project settings). */

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

export const config = {
  analystModel: () => env("ANALYST_MODEL") ?? "claude-opus-5-5",
  analystEffort: () => (env("ANALYST_EFFORT") ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  geminiModel: () => env("GEMINI_MODEL") ?? "gemini-flash-latest",
  benchmark: () => env("BENCHMARK_SYMBOL") ?? "^GSPC",
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  openrouterKey: () => env("OPENROUTER_API_KEY"),
  openrouterModel: () => env("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini",
  geminiKey: () => env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"),
  finnhubKey: () => env("FINNHUB_API_KEY"),
  dataProvider: () => (env("DATA_PROVIDER") === "mock" ? "mock" : "live") as "mock" | "live",
};

export type AiProvider = "anthropic" | "openrouter" | "gemini";

/** Claude if an Anthropic key is set, then OpenRouter, then Gemini, otherwise null (chat disabled). */
export function aiProvider(): AiProvider | null {
  if (config.anthropicKey()) return "anthropic";
  if (config.openrouterKey()) return "openrouter";
  if (config.geminiKey()) return "gemini";
  return null;
}

/** Cache lifetimes in seconds per data type. */
export const TTL = {
  quote: 30,
  search: 3600,
  history: 15 * 60,
  news: 10 * 60,
  statements: 6 * 3600,
  holders: 6 * 3600,
} as const;
