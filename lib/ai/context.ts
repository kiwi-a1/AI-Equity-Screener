/** Builds the per-turn application context note sent to the analyst with each question. */
import type { ChatRequest } from "./events";

const MAX_CHARS = 4000;

export function buildContextNote(ctx: ChatRequest["context"], now = new Date()): string {
  const company = ctx.company ?? {};
  const pick = (k: string) => (company[k] === undefined || company[k] === null ? undefined : company[k]);
  const payload: Record<string, unknown> = {
    current_utc_time: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
    selected_company: Object.fromEntries(
      Object.entries({
        symbol: ctx.symbol,
        name: pick("name"),
        exchange: pick("exchange"),
        currency: pick("currency"),
        sector: pick("sector"),
        industry: pick("industry"),
        last_price: pick("price"),
        change_percent_today: pick("changePercent"),
      }).filter(([, v]) => v !== undefined && v !== null),
    ),
    active_section: ctx.section,
    filters: ctx.filters ?? {},
    visible_on_screen: ctx.visible ?? {},
  };
  let text = JSON.stringify(payload);
  if (text.length > MAX_CHARS) {
    payload.visible_on_screen = { note: "omitted because it is large; use tools to fetch details" };
    text = JSON.stringify(payload);
  }
  return `Application context for the next user message (from the app, not the user). Use it to resolve references; fetch data with tools as needed.\n${text}`;
}
