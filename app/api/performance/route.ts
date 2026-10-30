import { config, TTL } from "@/lib/config";
import { getHistory } from "@/lib/data";
import { handle, json, param } from "@/lib/http";
import { performanceTable } from "@/lib/metrics";
import type { PerformanceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/performance?symbol=AAPL : YTD/1Y/3Y/5Y total returns vs the benchmark index. */
export function GET(req: Request) {
  return handle(async () => {
    const symbol = param(new URL(req.url), "symbol");
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear() - 6, 0, 1));
    const [stock, bench] = await Promise.all([
      getHistory(symbol, { period1: start, period2: now, interval: "1d" }),
      getHistory(config.benchmark(), { period1: start, period2: now, interval: "1d" }),
    ]);
    const data: { benchmark: string; rows: PerformanceRow[] } | null = stock.data
      ? { benchmark: config.benchmark(), rows: performanceTable(stock.data.bars, bench.data?.bars ?? null) }
      : null;
    return json({ ...stock, data }, TTL.history);
  });
}
