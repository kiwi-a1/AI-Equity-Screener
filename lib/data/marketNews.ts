/**
 * General market news for the landing page (separate from company news). Pulls several publishers' public
 * RSS feeds plus Finnhub's general news (when FINNHUB_API_KEY is set), merges them newest first, removes
 * duplicates and fills missing cover images from each article's own page. Every item links to the original.
 */
import { XMLParser } from "fast-xml-parser";

import { safeUrl } from "../format";
import type { NewsItem } from "../types";
import { fetchOgImage, fetchWithTimeout, mergeNews } from "./news";

export interface Feed {
  publisher: string;
  url: string;
}

export const MARKET_FEEDS: Feed[] = [
  { publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  { publisher: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069" },
  { publisher: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { publisher: "Investing.com", url: "https://www.investing.com/rss/news_25.rss" },
  { publisher: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
  { publisher: "Google News Business", url: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en" },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const text = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  return "";
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function imageOf(it: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  for (const key of ["media:content", "media:thumbnail", "enclosure", "media:group"]) {
    const v = it[key];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (o["media:content"]) candidates.push(...(Array.isArray(o["media:content"]) ? o["media:content"] : [o["media:content"]]).map((m) => (m as Record<string, unknown>)["@_url"]));
      const type = String(o["@_type"] ?? o["@_medium"] ?? "image");
      if (/image/.test(type) || key !== "enclosure") candidates.push(o["@_url"]);
    }
  }
  const desc = text(it.description);
  const m = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) candidates.push(m[1]);
  for (const c of candidates) {
    const u = safeUrl(c);
    if (u) return u;
  }
  return null;
}

/** Parse any RSS 2.0 feed (also tolerates Atom entries). */
export function parseRss(xml: string, publisher: string): NewsItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const items = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
  return items
    .map<NewsItem | null>((it) => {
      const linkRaw = it.link;
      const link = safeUrl(typeof linkRaw === "object" && linkRaw ? (linkRaw as Record<string, unknown>)["@_href"] : text(linkRaw));
      const src = text(it.source) || null;
      let title = stripHtml(text(it.title));
      if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3)).trim();
      if (!link || !title) return null;
      const dateRaw = text(it.pubDate) || text(it.published) || text(it.updated) || text(it["dc:date"]);
      const d = dateRaw ? new Date(dateRaw) : null;
      const summary = stripHtml(text(it.description) || text(it.summary));
      return {
        id: `rss-${link}`,
        title,
        url: link,
        publisher: src ?? publisher,
        published: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        image: imageOf(it),
        summary: summary && summary !== title ? summary.slice(0, 300) : null,
        source: "rss",
      };
    })
    .filter((n): n is NewsItem => n !== null);
}

export async function fetchFeed(feed: Feed, fetcher = fetchWithTimeout): Promise<NewsItem[]> {
  const res = await fetcher(feed.url, 6000, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`${feed.publisher} HTTP ${res.status}`);
  return parseRss(await res.text(), feed.publisher).slice(0, 25);
}

export async function finnhubGeneralNews(apiKey: string, fetcher = fetchWithTimeout): Promise<NewsItem[]> {
  const res = await fetcher(`https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : [])
    .map<NewsItem | null>((n) => {
      const url = safeUrl(n.url);
      if (!url || !n.headline) return null;
      return {
        id: `fhg-${n.id ?? url}`, title: String(n.headline).trim(), url, publisher: (n.source as string) || null,
        published: typeof n.datetime === "number" ? new Date(n.datetime * 1000).toISOString() : null,
        image: safeUrl(n.image), summary: typeof n.summary === "string" && n.summary.trim() ? n.summary.trim().slice(0, 300) : null, source: "finnhub",
      };
    })
    .filter((n): n is NewsItem => n !== null)
    .slice(0, 30);
}

export interface MarketNewsSources {
  feeds: Array<() => Promise<NewsItem[]>>;
  ogImage?: (url: string) => Promise<string | null>;
}

/** Collect every source in parallel; failures are tolerated. Throws only if all sources fail. */
export async function aggregateMarketNews(src: MarketNewsSources, limit = 40): Promise<NewsItem[]> {
  const settled = await Promise.allSettled(src.feeds.map((f) => f()));
  if (settled.length && settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  // Interleave so one prolific publisher cannot crowd out the others, then sort by time.
  const merged = mergeNews(lists, limit);
  if (src.ogImage) {
    const missing = merged.filter((n) => !n.image && !n.url.includes("news.google.com")).slice(0, 12);
    const imgs = await Promise.all(missing.map((n) => src.ogImage!(n.url)));
    missing.forEach((n, i) => (n.image = imgs[i]));
  }
  return merged;
}

export function liveMarketNewsSources(finnhubKey: string | undefined): MarketNewsSources {
  const feeds: MarketNewsSources["feeds"] = MARKET_FEEDS.map((f) => () => fetchFeed(f));
  if (finnhubKey) feeds.unshift(() => finnhubGeneralNews(finnhubKey));
  return { feeds, ogImage: (u) => fetchOgImage(u) };
}

/** Never-empty fallback: the publishers' own market pages. */
export function marketNewsResources(): NewsItem[] {
  const links = [
    ["CNBC Markets", "https://www.cnbc.com/markets/", "Live market coverage, earnings and economy news."],
    ["MarketWatch", "https://www.marketwatch.com/latest-news", "Latest headlines across stocks, bonds and the economy."],
    ["Investing.com News", "https://www.investing.com/news/stock-market-news", "Stock market news from around the world."],
    ["Google News Business", "https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB", "Business headlines from many publishers."],
  ];
  return links.map(([title, url, summary], i) => ({
    id: `market-resource-${i}`, title, url, publisher: new URL(url).hostname.replace(/^www\./, ""), published: null, image: null, summary, source: "resource",
  }));
}
