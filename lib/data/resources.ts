/**
 * Official reference links for a company (regulators, exchanges, investor relations). Used as guaranteed,
 * non-empty fallbacks when a feed returns nothing, so no section is ever blank.
 */
import { safeUrl } from "../format";
import type { NewsItem, ResourceLink } from "../types";

function market(symbol: string): "us" | "nse" | "bse" | "lse" | "other" {
  if (symbol.endsWith(".NS")) return "nse";
  if (symbol.endsWith(".BO")) return "bse";
  if (symbol.endsWith(".L")) return "lse";
  if (/^[A-Z]{1,5}(-[A-Z])?$/.test(symbol)) return "us";
  return "other";
}

const base = (symbol: string) => symbol.split(".")[0];

export function filingLinks(symbol: string, companyName: string | null): ResourceLink[] {
  const name = companyName ?? symbol;
  const links: ResourceLink[] = [];
  switch (market(symbol)) {
    case "us":
      links.push(
        { label: `SEC EDGAR filings for ${name}`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol.replace("-", "."))}&owner=include&count=40`, description: "Annual and quarterly reports, current reports and insider ownership filings." },
        { label: `Institutional ownership filings (13F) mentioning ${name}`, url: `https://www.sec.gov/edgar/search/#/q=%22${encodeURIComponent(name)}%22&forms=13F-HR`, description: "Full-text search of quarterly institutional holdings reports." },
      );
      break;
    case "nse":
      links.push(
        { label: `NSE corporate announcements for ${name}`, url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(base(symbol))}`, description: "Exchange filings, shareholding pattern and corporate actions." },
        { label: `BSE filings for ${name}`, url: `https://www.bseindia.com/corporates/ann.html`, description: "Announcements and shareholding disclosures on BSE." },
      );
      break;
    case "bse":
      links.push({ label: `BSE filings for ${name}`, url: `https://www.bseindia.com/corporates/ann.html`, description: "Announcements and shareholding disclosures on BSE." });
      break;
    case "lse":
      links.push({ label: `London Stock Exchange news for ${name}`, url: `https://www.londonstockexchange.com/stock/${encodeURIComponent(base(symbol))}/company-page`, description: "Regulatory news service announcements." });
      break;
    default:
      links.push({ label: `Regulatory filings search for ${name}`, url: `https://www.google.com/search?q=${encodeURIComponent(`${name} investor relations annual report`)}`, description: "Search for the company's investor-relations and filings pages." });
  }
  return links;
}

/** Reference entries shown in the news feed when no articles are available. */
export function newsResources(symbol: string, companyName: string | null, website: string | null): NewsItem[] {
  const name = companyName ?? symbol;
  const items: ResourceLink[] = [];
  const site = safeUrl(website);
  if (site) items.push({ label: `${name} investor relations and press releases`, url: site, description: "The company's own announcements and press releases." });
  items.push(...filingLinks(symbol, companyName));
  items.push({ label: `Latest coverage of ${name} on Google News`, url: `https://news.google.com/search?q=${encodeURIComponent(name)}`, description: "Live headlines from publishers worldwide." });
  return items.map((r, i) => ({
    id: `resource-${i}`, title: r.label, url: r.url, publisher: new URL(r.url).hostname.replace(/^www\./, ""),
    published: null, image: null, summary: r.description, source: "resource",
  }));
}
