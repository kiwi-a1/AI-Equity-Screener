import { TTL } from "@/lib/config";
import { getQuotes } from "@/lib/data";
import { handle, json, param } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const symbols = param(new URL(req.url), "symbols").split(",").filter(Boolean);
    return json(await getQuotes(symbols), TTL.quote);
  });
}
