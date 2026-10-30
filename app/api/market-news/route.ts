import { TTL } from "@/lib/config";
import { getMarketNews } from "@/lib/data";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/market-news : general finance headlines from several publishers (landing page). */
export function GET() {
  return handle(async () => json(await getMarketNews(), TTL.news));
}
