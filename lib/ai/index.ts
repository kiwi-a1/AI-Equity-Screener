/**
 * Entry point for the analyst. Runs one chat turn on the first configured AI service; if that service
 * fails before writing any answer, the turn moves on to the next one, so a busy or out-of-quota
 * service never leaves the user with an error while another could answer.
 */
import { aiProviders, type AiProvider } from "../config";
import { runClaude } from "./anthropic";
import { buildContextNote } from "./context";
import type { ChatEvent, ChatRequest } from "./events";
import { runGemini } from "./gemini";
import { groq, openrouter, runOpenAI } from "./openai";
import { executeTool } from "./tools";

/** Services that share a transcript format, so the conversation carries over between them. */
const FAMILY: Record<AiProvider, string> = { anthropic: "anthropic", gemini: "gemini", groq: "openai", openrouter: "openai" };

const LABELS: Record<AiProvider, string> = { anthropic: "Claude", gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };

type Runner = (history: unknown[], message: string, note: string) => AsyncGenerator<ChatEvent>;
const RUNNERS: Record<AiProvider, Runner> = {
  anthropic: (h, m, n) => runClaude(h as Record<string, unknown>[], m, n),
  gemini: (h, m, n) => runGemini(h as Parameters<typeof runGemini>[0], m, n),
  groq: (h, m, n) => runOpenAI(groq(), h as Record<string, unknown>[], m, n),
  openrouter: (h, m, n) => runOpenAI(openrouter(), h as Record<string, unknown>[], m, n),
};

/** Services that failed recently are tried last for a while, so one slow failure is not paid on every question. */
const COOLDOWN_MS = 90_000;
const coolingUntil = new Map<AiProvider, number>();
export function resetCooldowns() {
  coolingUntil.clear();
}

/**
 * The selected company's snapshot (price, valuation, key figures), fetched up front so most questions
 * can be answered in one model call instead of waiting for a tool round trip. Cached data, so it is quick;
 * skipped if it takes too long.
 */
async function preload(symbol: string | null): Promise<string> {
  if (!symbol) return "";
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  const res = await Promise.race([executeTool("get_company_snapshot", { symbol }).catch(() => null), timeout]);
  if (!res || res[1]) return "";
  return `\n\nPreloaded get_company_snapshot result for ${symbol} (retrieved just now; use it directly instead of calling that tool again):\n${res[0].slice(0, 5000)}`;
}

export async function* runAnalyst(req: ChatRequest, runners: Record<AiProvider, Runner> = RUNNERS, providers: AiProvider[] = aiProviders()): AsyncGenerator<ChatEvent> {
  if (!providers.length) {
    yield { type: "error", text: "The AI assistant is not set up yet. Please check back soon." };
    yield { type: "done", sources: { web: [], queries: [], data: [] }, history: [], provider: "none" };
    return;
  }
  const started = Date.now();
  const note = buildContextNote(req.context) + (await preload(req.context?.symbol ?? null));
  const prevFamily = req.provider ? FAMILY[req.provider as AiProvider] : null;

  const now = Date.now();
  const order = [...providers.filter((p) => (coolingUntil.get(p) ?? 0) <= now), ...providers.filter((p) => (coolingUntil.get(p) ?? 0) > now)];
  const reasons: string[] = [];
  for (const provider of order) {
    // Histories are format-specific; start fresh when switching to a different family.
    const history = prevFamily === FAMILY[provider] && Array.isArray(req.history) ? [...req.history] : [];
    const held: ChatEvent[] = [];
    let wrote = false;
    let failed = false;
    for await (const ev of runners[provider](history, req.message, note)) {
      if (ev.type === "text") wrote = true;
      if (!wrote && ev.type === "error") {
        failed = true; // swallow and try the next service
        reasons.push(`${LABELS[provider]}: ${ev.text}`);
        continue;
      }
      if (failed) continue; // drop the failed run's done event
      if (!wrote && ev.type === "step") {
        held.push(ev);
        continue;
      }
      if (held.length) yield* held.splice(0);
      yield ev;
    }
    if (!failed) {
      coolingUntil.delete(provider);
      console.log(`[ai] answered by ${LABELS[provider]} in ${Date.now() - started} ms`);
      return;
    }
    coolingUntil.set(provider, Date.now() + COOLDOWN_MS);
    if (provider !== order.at(-1)) yield { type: "status", text: "Still working on it" };
  }
  // Every service failed. Visitors get one neutral message; the per-service reasons go to the server
  // log (Vercel: project, Logs) so the right key or setting can be fixed.
  console.error(`[ai] no service could answer. ${reasons.join(" | ")}`);
  const busy = reasons.every((r) => /busy|limit|try again/i.test(r));
  yield { type: "error", text: busy ? "The AI assistant is very busy right now. Please try again in a moment." : "The AI assistant is unavailable right now. Please try again shortly." };
  yield { type: "done", sources: { web: [], queries: [], data: [] }, history: [], provider: "none" };
}
