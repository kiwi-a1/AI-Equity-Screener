/**
 * News aggregation: Finnhub (if FINNHUB_API_KEY is set) + the market-data provider's feed + Google News RSS.
 * Results are merged, de-duplicated by URL and normalized title, sorted newest first, and each article gets
 * a cover image (from the source, or the article page's og:image when the source has none).
 */
import { XMLParser } from "fast-xml-parser";

import { config } from "../config";
import { safeUrl } from "../format";
import type { NewsItem } from "../types";

const UA = "Mozilla/5.0 (compatible; EquityScreener/1.0)";

export async function fetchWithTimeout(url: string, ms = 6000, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function finnhubNews(symbol: string, apiKey: string, fetcher = fetchWithTimeout): Promise<NewsItem[]> {
  const to = new Date();
  const from = new Date(Date.now() - 21 * 86400e3);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${isoDay(from)}&to=${isoDay(to)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(data)) return [];
  return data
    .map<NewsItem | null>((n) => {
      const link = safeUrl(n.url);
      if (!link || !n.headline) return null;
      return {
        id: `fh-${n.id ?? link}`,
        title: String(n.headline).trim(),
        url: link,
        publisher: (n.source as string) || null,
        published: typeof n.datetime === "number" ? new Date(n.datetime * 1000).toISOString() : null,
        image: safeUrl(n.image),
        summary: typeof n.summary === "string" && n.summary.trim() ? n.summary.trim().slice(0, 400) : null,
        source: "finnhub",
      };
    })
    .filter((n): n is NewsItem => n !== null)
    .slice(0, 30);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export function parseGoogleRss(xml: string): NewsItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = doc.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  return items
    .map<NewsItem | null>((it) => {
      const link = safeUrl(it.link);
      const src = it.source as { "#text"?: string } | string | undefined;
      const publisher = typeof src === "string" ? src : src?.["#text"] ?? null;
      let title = String(it.title ?? "").trim();
      if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
      if (!link || !title) return null;
      const pub = it.pubDate ? new Date(String(it.pubDate)) : null;
      return {
        id: `g-${String(it.guid && typeof it.guid === "object" ? (it.guid as Record<string, unknown>)["#text"] : it.guid ?? link)}`,
        title,
        url: link,
        publisher,
        published: pub && !Number.isNaN(pub.getTime()) ? pub.toISOString() : null,
        image: null,
        summary: null,
        source: "google",
      };
    })
    .filter((n): n is NewsItem => n !== null);
}

export async function googleNews(query: string, fetcher = fetchWithTimeout, financeOnly = true): Promise<NewsItem[]> {
  const q = encodeURIComponent(financeOnly ? `${query} stock` : query);
  const res = await fetcher(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  return parseGoogleRss(await res.text()).slice(0, 20);
}

/** Read og:image / twitter:image from an article page (first 200 KB only). */
export async function fetchOgImage(url: string, fetcher = fetchWithTimeout): Promise<string | null> {
  try {
    const res = await fetcher(url, 3500, { redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 200_000);
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    const img = m ? safeUrl(m[1].replace(/&amp;/g, "&")) : null;
    // Google News redirect pages carry Google's own logo, which is not a useful cover.
    return img && !/gstatic\.com|googleusercontent\.com\/.*=s0-w300/.test(img) ? img : null;
  } catch {
    return null;
  }
}

export function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Merge lists in priority order, dropping duplicates (same URL or same normalized title). Newest first. */
export function mergeNews(lists: NewsItem[][], limit = 30): NewsItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Map<string, NewsItem>();
  const out: NewsItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      const t = normTitle(item.title);
      const dup = seenTitle.get(t);
      if (seenUrl.has(item.url) || dup) {
        if (dup && !dup.image && item.image) dup.image = item.image; // keep the best cover
        continue;
      }
      const copy = { ...item };
      seenUrl.add(item.url);
      seenTitle.set(t, copy);
      out.push(copy);
    }
  }
  out.sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0));
  return out.slice(0, limit);
}

export interface NewsSources {
  provider: (symbol: string) => Promise<NewsItem[]>;
  finnhub?: (symbol: string) => Promise<NewsItem[]>;
  google?: (query: string) => Promise<NewsItem[]>;
  ogImage?: (url: string) => Promise<string | null>;
}

/** Gather from all sources in parallel; any one failing is tolerated. Throws only if every source failed. */
export async function aggregateNews(symbol: string, companyName: string | null, sources: NewsSources, limit = 30): Promise<NewsItem[]> {
  // Only configured sources take part; their order is the merge priority.
  const jobs: Array<Promise<NewsItem[]>> = [];
  if (sources.finnhub) jobs.push(sources.finnhub(symbol));
  jobs.push(sources.provider(symbol));
  if (sources.google) jobs.push(sources.google(companyName || symbol));
  const settled = await Promise.allSettled(jobs);
  if (settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const merged = mergeNews(lists, limit);

  if (sources.ogImage) {
    const missing = merged.filter((n) => !n.image).slice(0, 10);
    const imgs = await Promise.all(missing.map((n) => sources.ogImage!(n.url)));
    missing.forEach((n, i) => (n.image = imgs[i]));
  }
  return merged;
}

export function liveNewsSources(provider: (s: string) => Promise<NewsItem[]>): NewsSources {
  const key = config.finnhubKey();
  return {
    provider,
    finnhub: key ? (s) => finnhubNews(s, key) : undefined,
    google: (q) => googleNews(q),
    ogImage: (u) => fetchOgImage(u),
  };
}
