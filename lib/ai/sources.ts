/** Collects the evidence behind an answer: web results, citations and market-data retrievals. */
import { safeUrl } from "../format";
import type { Sources } from "./events";

export class SourceLog {
  private web = new Map<string, { title: string; date: string | null; cited: boolean }>();
  queries: string[] = [];
  private data: Sources["data"] = [];

  addWeb(url: unknown, title: unknown, date: unknown = null, cited = false): void {
    const u = safeUrl(url);
    if (!u) return;
    const existing = this.web.get(u);
    if (existing) {
      existing.cited ||= cited;
      existing.date ??= typeof date === "string" ? date : null;
      return;
    }
    this.web.set(u, { title: typeof title === "string" && title ? title : u, date: typeof date === "string" ? date : null, cited });
  }

  addQuery(q: unknown): void {
    if (typeof q === "string" && q.trim()) this.queries.push(q.trim());
  }

  /** Record a successful tool result (JSON text) and any article links it carries. */
  addToolResult(tool: string, input: unknown, resultJson: string): void {
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(resultJson);
    } catch {
      return;
    }
    if (!result || typeof result !== "object" || tool === "calculate") return;
    const retrieved = result.retrieved_at;
    if (typeof retrieved === "string") {
      const i = (input ?? {}) as Record<string, unknown>;
      const symbol = typeof i.symbol === "string" ? i.symbol : Array.isArray(i.symbols) ? i.symbols.join(", ") : null;
      this.data.push({ tool, symbol, retrievedAt: retrieved });
    }
    const articles = result.articles;
    if (Array.isArray(articles)) {
      for (const a of articles as Record<string, unknown>[]) this.addWeb(a.url, `${a.title}${a.publisher ? `, ${a.publisher}` : ""}`, a.published);
    }
  }

  toJSON(): Sources {
    const web = [...this.web.entries()]
      .map(([url, v]) => ({ url, ...v }))
      .sort((a, b) => Number(b.cited) - Number(a.cited));
    return { web, queries: [...new Set(this.queries)], data: this.data };
  }
}
