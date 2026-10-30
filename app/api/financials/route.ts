import { TTL } from "@/lib/config";
import { getStatement } from "@/lib/data";
import { handle, json, param } from "@/lib/http";
import type { Frequency, StatementKind } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/financials?symbol=AAPL&statement=income|balance|cashflow&frequency=annual|quarterly */
export function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const kind = (param(url, "statement") || "income") as StatementKind;
    const freq = (param(url, "frequency") || "annual") as Frequency;
    return json(await getStatement(param(url, "symbol"), kind, freq), TTL.statements);
  });
}
