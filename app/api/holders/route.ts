import { TTL } from "@/lib/config";
import { getHolders } from "@/lib/data";
import { handle, json, param } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => json(await getHolders(param(new URL(req.url), "symbol")), TTL.holders));
}
