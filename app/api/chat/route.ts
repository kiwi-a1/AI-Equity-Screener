import { runAnalyst } from "@/lib/ai";
import type { ChatEvent, ChatRequest } from "@/lib/ai/events";
import { aiProvider } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET: which AI provider is configured (no secrets). */
export function GET() {
  return Response.json({ provider: aiProvider() });
}

/** POST: run one analyst turn and stream ChatEvents as NDJSON. */
export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body?.message !== "string" || !body.message.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  const request: ChatRequest = {
    message: body.message.trim().slice(0, 4000),
    history: Array.isArray(body.history) ? body.history : [],
    provider: typeof body.provider === "string" ? body.provider : null,
    context: {
      symbol: body.context?.symbol ?? null,
      company: body.context?.company ?? null,
      section: body.context?.section ?? null,
      filters: body.context?.filters ?? {},
      visible: body.context?.visible ?? {},
    },
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        for await (const ev of runAnalyst(request)) send(ev);
      } catch (err) {
        send({ type: "error", text: `Unexpected error: ${(err as Error)?.message ?? err}` });
        send({ type: "done", sources: { web: [], queries: [], data: [] }, history: request.history, provider: request.provider ?? "none" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
