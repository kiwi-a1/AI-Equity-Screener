import { TTL } from "@/lib/config";
import { clampHistory, getHistory, InputError, INTERVALS, presetStart, RANGE_PRESETS, type Interval, type RangePreset } from "@/lib/data";
import { handle, json, param } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/history?symbol=AAPL&range=1Y&interval=1d  or  &start=2024-01-01&end=2024-06-30 */
export function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const interval = (param(url, "interval") || "1d") as Interval;
    if (!INTERVALS.includes(interval)) throw new InputError(`Unsupported interval: ${interval}`);
    const now = new Date();
    let start: Date;
    let end = now;
    const range = (param(url, "range") || "1Y").toUpperCase() as RangePreset;
    if (param(url, "start")) {
      start = new Date(param(url, "start"));
      if (param(url, "end")) end = new Date(`${param(url, "end")}T23:59:59Z`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new InputError("Invalid start or end date");
    } else {
      if (!RANGE_PRESETS.includes(range)) throw new InputError(`Unknown range: ${range}`);
      start = presetStart(range, now);
    }
    const clamped = clampHistory(start, end, interval, now);
    const symbol = param(url, "symbol");
    let result = await getHistory(symbol, { period1: clamped.start, period2: clamped.end, interval });
    let note = clamped.note;
    // Never return an empty chart: widen to daily bars (intraday on a closed market, or a range with no trading).
    if (result.data && !result.data.bars.length) {
      const wideStart = new Date(Math.min(clamped.start.getTime(), now.getTime() - 92 * 86400e3));
      const wider = await getHistory(symbol, { period1: wideStart, period2: now, interval: "1d" });
      if (wider.data?.bars.length) {
        result = wider;
        note = "No trades were recorded for the selected range and interval, so recent daily prices are shown instead.";
      }
    }
    const res = json(result, TTL.history);
    if (note) res.headers.set("X-Range-Note", note);
    return res;
  });
}
