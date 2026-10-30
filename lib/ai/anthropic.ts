/**
 * Claude runner: streaming tool-use loop with the market-data tools plus server-side web search.
 * History is append-only (prompt caching and preserved thinking rely on it); a turn that fails
 * with an API error is rolled back so the returned history stays valid.
 */
import Anthropic from "@anthropic-ai/sdk";

import { config } from "../config";
import { describeToolCall, type ChatEvent } from "./events";
import { SYSTEM_PROMPT } from "./prompt";
import { SourceLog } from "./sources";
import { executeTool, TOOLS } from "./tools";

const MAX_STEPS = 14;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 6 };

type Msg = Record<string, unknown>;
type Block = { type: string; [k: string]: unknown };

interface StreamLike extends AsyncIterable<{ type: string; [k: string]: unknown }> {
  finalMessage(): Promise<{ content: Block[]; stop_reason: string | null; stop_details?: unknown }>;
}
export interface ClaudeClientLike {
  beta: { messages: { stream(params: Record<string, unknown>): StreamLike } };
}

function collect(content: Block[], log: SourceLog): void {
  for (const b of content) {
    if (b.type === "server_tool_use" && b.name === "web_search") log.addQuery((b.input as Msg | undefined)?.query);
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as Block[]) if (r.type === "web_search_result") log.addWeb(r.url, r.title, r.page_age);
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations as Block[]) log.addWeb(c.url, c.title, null, true);
    }
  }
}

export async function* runClaude(
  history: Msg[],
  userText: string,
  contextNote: string,
  client: ClaudeClientLike = new Anthropic({ apiKey: config.anthropicKey() }) as unknown as ClaudeClientLike,
): AsyncGenerator<ChatEvent> {
  const startLen = history.length;
  history.push({ role: "user", content: userText });
  history.push({ role: "system", content: contextNote });
  const log = new SourceLog();
  const tools = [
    ...TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.jsonSchema, strict: true, eager_input_streaming: true })),
    WEB_SEARCH,
  ];
  let jsonRetries = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream({
        model: config.analystModel(),
        max_tokens: 64000,
        system: SYSTEM_PROMPT,
        messages: history,
        tools,
        thinking: { type: "adaptive" },
        output_config: { effort: config.analystEffort() },
        cache_control: { type: "ephemeral" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
      let message;
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta") {
            const d = ev.delta as Block;
            if (d.type === "text_delta") yield { type: "text", text: String(d.text) };
          } else if (ev.type === "content_block_start") {
            const b = ev.content_block as Block;
            if (b.type === "server_tool_use") yield { type: "status", text: "Searching the web" };
            else if (b.type === "tool_use") yield { type: "status", text: describeToolCall(String(b.name), null) };
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // Tool input JSON the SDK could not parse at all: re-issue the step (bounded). API errors propagate.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        step--;
        continue;
      }

      history.push({ role: "assistant", content: message.content });
      collect(message.content, log);
      const stop = message.stop_reason;
      if (stop === "pause_turn") continue;
      if (stop === "refusal") {
        yield { type: "error", text: "The model declined to answer this request." };
        break;
      }
      const toolUses = message.content.filter((b) => b.type === "tool_use") as (Block & { id: string; name: string; input: unknown })[];
      if (!toolUses.length) {
        if (stop === "max_tokens") yield { type: "error", text: "The answer reached the length limit and was cut off." };
        break;
      }
      if (stop === "max_tokens") {
        history.push({
          role: "user",
          content: toolUses.map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Tool input was truncated; not executed." })),
        });
        yield { type: "error", text: "The answer reached the length limit and was cut off." };
        break;
      }
      for (const b of toolUses) yield { type: "status", text: describeToolCall(b.name, b.input) };
      const outputs = await Promise.all(toolUses.map((b) => executeTool(b.name, b.input)));
      const results = toolUses.map((b, i) => {
        const [content, isError] = outputs[i];
        if (!isError) log.addToolResult(b.name, b.input, content);
        return { type: "tool_result", tool_use_id: b.id, content, is_error: isError };
      });
      for (let i = 0; i < toolUses.length; i++) yield { type: "step", text: describeToolCall(toolUses[i].name, toolUses[i].input), isError: outputs[i][1] };
      history.push({ role: "user", content: results });
      if (step === MAX_STEPS - 1) yield { type: "error", text: "Stopped after too many research steps; the answer may be incomplete." };
    }
  } catch (err) {
    history.splice(startLen);
    yield { type: "error", text: describeClaudeError(err) };
  }
  yield { type: "done", sources: log.toJSON(), history, provider: "anthropic" };
}

export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is missing or invalid.";
  if (err instanceof Anthropic.RateLimitError) return "The AI service is rate limited right now. Please wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Check the network connection.";
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status ?? "unknown"}): ${err.message}`;
  return `AI error: ${(err as Error)?.message ?? String(err)}`;
}
