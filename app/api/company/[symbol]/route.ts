import { TTL } from "@/lib/config";
import { getCompany } from "@/lib/data";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  return handle(async () => json(await getCompany(decodeURIComponent(symbol)), TTL.quote));
}
