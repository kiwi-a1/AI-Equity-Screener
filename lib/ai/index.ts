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

/** Services that share a transcript format, so the conversation carries over between them. */
const FAMILY: Record<AiProvider, string> = { anthropic: "anthropic", gemini: "gemini", groq: "openai", openrouter: "openai" };

type Runner = (history: unknown[], message: string, note: string) => AsyncGenerator<ChatEvent>;
const RUNNERS: Record<AiProvider, Runner> = {
  anthropic: (h, m, n) => runClaude(h as Record<string, unknown>[], m, n),
  gemini: (h, m, n) => runGemini(h as Parameters<typeof runGemini>[0], m, n),
  groq: (h, m, n) => runOpenAI(groq(), h as Record<string, unknown>[], m, n),
  openrouter: (h, m, n) => runOpenAI(openrouter(), h as Record<string, unknown>[], m, n),
};

export async function* runAnalyst(req: ChatRequest, runners: Record<AiProvider, Runner> = RUNNERS): AsyncGenerator<ChatEvent> {
  const providers = aiProviders();
  if (!providers.length) {
    yield { type: "error", text: "No AI key is configured. Add GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY to the environment." };
    yield { type: "done", sources: { web: [], queries: [], data: [] }, history: [], provider: "none" };
    return;
  }
  const note = buildContextNote(req.context);
  const prevFamily = req.provider ? FAMILY[req.provider as AiProvider] : null;

  for (const [i, provider] of providers.entries()) {
    const isLast = i === providers.length - 1;
    // Histories are format-specific; start fresh when switching to a different family.
    const history = prevFamily === FAMILY[provider] && Array.isArray(req.history) ? [...req.history] : [];
    const held: ChatEvent[] = [];
    let wrote = false;
    let failed = false;
    for await (const ev of runners[provider](history, req.message, note)) {
      if (ev.type === "text") wrote = true;
      if (!wrote && !isLast && ev.type === "error") {
        failed = true; // swallow and try the next service
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
    if (!failed) return;
    yield { type: "status", text: "Switching to a backup AI service" };
  }
}
