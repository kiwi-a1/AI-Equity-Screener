import { beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/market-news/route";
import { executeTool } from "@/lib/ai/tools";
import { invalidate } from "@/lib/cache";
import { getMarketNews } from "@/lib/data";
import { aggregateMarketNews, marketNewsResources, parseRss } from "@/lib/data/marketNews";

beforeAll(() => {
  process.env.DATA_PROVIDER = "mock";
  invalidate();
});

const RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>Stocks rally on rate hopes</title><link>https://pub.example/a</link><pubDate>Wed, 29 Oct 2025 14:00:00 GMT</pubDate>
<description>&lt;p&gt;Markets &amp;amp; bonds rose.&lt;/p&gt;</description><media:content url="https://img.example/a.jpg" medium="image"/></item>
<item><title>Oil slips</title><link>https://pub.example/b</link><enclosure url="https://img.example/b.jpg" type="image/jpeg"/></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

describe("market news", () => {
  it("parses RSS with media images, enclosures and HTML descriptions", () => {
    const items = parseRss(RSS, "Example Wire");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Stocks rally on rate hopes", publisher: "Example Wire", image: "https://img.example/a.jpg", published: "2025-10-29T14:00:00.000Z" });
    expect(items[0].summary).toBe("Markets & bonds rose.");
    expect(items[1].image).toBe("https://img.example/b.jpg");
  });

  it("parses Atom feeds", () => {
    const atom = `<feed><entry><title>Atom story</title><link href="https://pub.example/c"/><updated>2025-10-29T10:00:00Z</updated></entry></feed>`;
    expect(parseRss(atom, "Atom Pub")[0]).toMatchObject({ url: "https://pub.example/c", publisher: "Atom Pub" });
  });

  it("merges publishers, tolerates failures and fills covers", async () => {
    const out = await aggregateMarketNews({
      feeds: [async () => parseRss(RSS, "A"), async () => { throw new Error("blocked"); }, async () => [{ id: "x", title: "Fed holds rates", url: "https://other.example/x", publisher: "B", published: "2025-10-29T15:00:00Z", image: null, summary: null, source: "rss" }]],
      ogImage: async (u) => `${u}.jpg`,
    });
    expect(out[0].title).toBe("Fed holds rates");
    expect(out[0].image).toBe("https://other.example/x.jpg");
    await expect(aggregateMarketNews({ feeds: [async () => { throw new Error("down"); }] })).rejects.toThrow("down");
  });

  it("falls back to publisher pages when every feed fails", async () => {
    invalidate("market-news");
    const r = await getMarketNews({ feeds: [async () => { throw new Error("down"); }] });
    expect(r.data).toEqual(marketNewsResources());
    invalidate("market-news");
  });

  it("serves headlines from the API route and the AI tool", async () => {
    const body = await (await GET()).json();
    expect(body.data.length).toBeGreaterThan(5);
    const [text, isError] = await executeTool("get_market_news", { limit: 3 });
    expect(isError).toBe(false);
    expect(JSON.parse(text).articles).toHaveLength(3);
  });
});
