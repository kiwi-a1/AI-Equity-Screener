/** Server-side configuration from environment variables (set them in Vercel project settings). */

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

export const config = {
  analystModel: () => env("ANALYST_MODEL") ?? "claude-opus-5-5",
  analystEffort: () => (env("ANALYST_EFFORT") ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  geminiModel: () => env("GEMINI_MODEL") ?? "gemini-flash-lite-latest",
  benchmark: () => env("BENCHMARK_SYMBOL") ?? "^GSPC",
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  openrouterKey: () => env("OPENROUTER_API_KEY"),
  openrouterModel: () => env("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini",
  groqKey: () => env("GROQ_API_KEY"),
  groqModel: () => env("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
  geminiKey: () => env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"),
  finnhubKey: () => env("FINNHUB_API_KEY"),
  dataProvider: () => (env("DATA_PROVIDER") === "mock" ? "mock" : "live") as "mock" | "live",
};

export type AiProvider = "anthropic" | "groq" | "gemini" | "openrouter";

/**
 * The AI services the chat may use. Groq is preferred; the order of the others is decided at run time
 * from how quickly each has been answering (see lib/ai/index.ts).
 */
export const ACTIVE_PROVIDERS: AiProvider[] = ["groq", "gemini", "openrouter"];
export const PREFERRED_PROVIDER: AiProvider = "groq";

/**
 * Every active AI service with a key set, fastest first. The chat uses the first and moves down the list
 * when one is busy, out of quota or failing. Empty means the chat is disabled.
 */
export function aiProviders(): AiProvider[] {
  const all: [AiProvider, string | undefined][] = [
    ["anthropic", config.anthropicKey()],
    ["groq", config.groqKey()],
    ["gemini", config.geminiKey()],
    ["openrouter", config.openrouterKey()],
  ];
  return all.filter(([p, key]) => key && ACTIVE_PROVIDERS.includes(p)).map(([p]) => p);
}

export function aiProvider(): AiProvider | null {
  return aiProviders()[0] ?? null;
}

/** Cache lifetimes in seconds per data type. */
export const TTL = {
  quote: 5, // short, so prices tick live
  search: 3600,
  history: 15 * 60,
  news: 10 * 60,
  statements: 6 * 3600,
  holders: 6 * 3600,
} as const;
