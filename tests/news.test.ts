import { describe, expect, it } from "vitest";

import { aggregateNews, finnhubNews, mergeNews, parseGoogleRss } from "@/lib/data/news";
import type { NewsItem } from "@/lib/types";

const item = (id: string, title: string, url: string, published: string, image: string | null = null, source: NewsItem["source"] = "yahoo"): NewsItem =>
  ({ id, title, url, publisher: "P", published, image, summary: null, source });

describe("news", () => {
  it("parses Google News RSS and strips the publisher suffix", () => {
    const xml = `<rss><channel><item><title>Apple beats estimates - Reuters</title><link>https://news.google.com/a</link><pubDate>Tue, 28 Oct 2025 12:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source><guid>g1</guid></item><item><title>Bad</title><link>javascript:x</link></item></channel></rss>`;
    const items = parseGoogleRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Apple beats estimates");
    expect(items[0].publisher).toBe("Reuters");
    expect(items[0].published).toBe("2025-10-28T12:00:00.000Z");
  });

  it("parses Finnhub results with images", async () => {
    const fake = async () => new Response(JSON.stringify([{ id: 1, headline: "H", url: "https://x.com/1", source: "CNBC", datetime: 1761652800, image: "https://img/1.jpg", summary: "S" }]));
    const out = await finnhubNews("AAPL", "k", fake as never);
    expect(out[0]).toMatchObject({ title: "H", publisher: "CNBC", image: "https://img/1.jpg", source: "finnhub" });
  });

  it("merges by priority, de-duplicates by url and title, keeps a cover image", () => {
    const a = [item("1", "Apple beats estimates", "https://a/1", "2025-10-28T10:00:00Z")];
    const b = [item("2", "Apple Beats Estimates!", "https://b/2", "2025-10-28T10:00:00Z", "https://img/2.jpg"), item("3", "Other", "https://b/3", "2025-10-29T10:00:00Z")];
    const out = mergeNews([a, b]);
    expect(out.map((n) => n.id)).toEqual(["3", "1"]);
    expect(out[1].image).toBe("https://img/2.jpg");
  });

  it("tolerates failing sources and fills covers from og:image", async () => {
    const out = await aggregateNews("AAPL", "Apple", {
      provider: async () => [item("y", "From provider", "https://y/1", "2025-10-28T00:00:00Z")],
      finnhub: async () => { throw new Error("401"); },
      google: async () => [item("g", "From google", "https://g/1", "2025-10-29T00:00:00Z", null, "google")],
      ogImage: async (u) => `${u}/cover.jpg`,
    });
    expect(out.map((n) => n.id)).toEqual(["g", "y"]);
    expect(out[0].image).toBe("https://g/1/cover.jpg");
  });

  it("throws only when every source fails", async () => {
    await expect(aggregateNews("X", null, { provider: async () => { throw new Error("down"); } })).rejects.toThrow("down");
  });
});
