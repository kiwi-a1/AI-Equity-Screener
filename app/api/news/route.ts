import { TTL } from "@/lib/config";
import { getNews } from "@/lib/data";
import { handle, json, param } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/news?symbol=AAPL&name=Apple%20Inc. (name improves the general news search) */
export function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    return json(await getNews(param(url, "symbol"), param(url, "name") || null), TTL.news);
  });
}
