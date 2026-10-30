import { TTL } from "@/lib/config";
import { searchSymbols } from "@/lib/data";
import { handle, json, param } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => json(await searchSymbols(param(new URL(req.url), "q")), TTL.search));
}
