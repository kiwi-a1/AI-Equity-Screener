/** Entry point for the analyst: picks the configured provider and runs one chat turn. */
import { aiProvider } from "../config";
import { runClaude } from "./anthropic";
import { buildContextNote } from "./context";
import type { ChatEvent, ChatRequest } from "./events";
import { runGemini } from "./gemini";

export async function* runAnalyst(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const provider = aiProvider();
  if (!provider) {
    yield { type: "error", text: "No AI key is configured. Add GEMINI_API_KEY or ANTHROPIC_API_KEY to the environment." };
    yield { type: "done", sources: { web: [], queries: [], data: [] }, history: [], provider: "none" };
    return;
  }
  // Histories are provider-specific; start fresh if the configured provider changed.
  const history = req.provider === provider && Array.isArray(req.history) ? [...req.history] : [];
  const note = buildContextNote(req.context);
  if (provider === "anthropic") yield* runClaude(history as Record<string, unknown>[], req.message, note);
  else yield* runGemini(history as Parameters<typeof runGemini>[0], req.message, note);
}
