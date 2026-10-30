"use client";
/**
 * App shell. URL state: ?s=SYMBOL&tab=section. Without a symbol the home view shows the masthead,
 * search and featured companies; with one it shows the company header, section tabs and the section.
 * The AI analyst column is always present on the right.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { SECTIONS, type CompanyInfo, type PageContext, type SectionId } from "@/lib/types";

import ChatPanel, { type ChatHandle } from "./ChatPanel";
import MarketNews from "./MarketNews";
import MarketOverview from "./MarketOverview";
import CompanyHeader from "./CompanyHeader";
import SearchBox from "./SearchBox";
import Financials from "./sections/Financials";
import HistoricalData from "./sections/HistoricalData";
import Holders from "./sections/Holders";
import News from "./sections/News";
import Statistics from "./sections/Statistics";
import Summary from "./sections/Summary";
import type { SectionProps } from "./sections/types";
import { ThemeToggle } from "./theme";
import TickerStrip from "./TickerStrip";
import { Loading, Notice } from "./ui";
import { useApi } from "./useApi";

const SECTION_COMPONENTS: Record<SectionId, (p: SectionProps) => React.ReactNode> = {
  summary: Summary,
  news: News,
  statistics: Statistics,
  history: HistoricalData,
  financials: Financials,
  holders: Holders,
};

const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export default function Workspace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const symbol = (params.get("s") ?? "").toUpperCase() || null;
  const tabParam = params.get("tab") as SectionId | null;
  const section: SectionId = SECTIONS.some((s) => s.id === tabParam) ? (tabParam as SectionId) : "summary";

  const company = useApi<CompanyInfo>(symbol ? `/api/company/${encodeURIComponent(symbol)}` : null, { refreshMs: 30_000 });
  const [context, setContext] = useState<PageContext | null>(null);
  const chatRef = useRef<ChatHandle>(null);

  const navigate = useCallback(
    (next: { s?: string | null; tab?: SectionId }) => {
      const q = new URLSearchParams(params.toString());
      if (next.s !== undefined) {
        if (next.s) q.set("s", next.s);
        else q.delete("s");
        if (!next.tab) q.set("tab", "summary");
      }
      if (next.tab) q.set("tab", next.tab);
      if (!q.get("s")) q.delete("tab");
      router.push(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const selectSymbol = (s: string) => {
    setContext(null);
    navigate({ s });
  };
  const onContext = useCallback(
    (filters: Record<string, unknown>, visible: Record<string, unknown>) => setContext({ section, filters, visible }),
    [section],
  );
  const ask = useCallback((q: string) => chatRef.current?.ask(q), []);

  const info = company.data;
  const Section = SECTION_COMPONENTS[section];

  return (
    <div className="shell">
      <main className={`main${symbol ? "" : " home"}`}>
        <div className="masthead">
          <div className="masthead-top">
            <h1 className="title">
              <a href="/" style={{ color: "inherit", textDecoration: "none" }} onClick={(e) => { e.preventDefault(); navigate({ s: null }); }}>
                Equity Screener <em>Powered by AI</em>
              </a>
            </h1>
            <span className="masthead-right">
              <span className="dateline">{today()}</span>
              <ThemeToggle />
            </span>
          </div>
          <SearchBox onSelect={selectSymbol} autoFocus={!symbol} />
          <TickerStrip current={symbol} onSelect={selectSymbol} />
        </div>

        {!symbol ? (
          <>
            <div className="empty-home">
              <p>
                Search any listed company above, or choose a featured name, to open its research page: price and trading data, valuation, financial
                statements, ownership and news, with an AI analyst on the right that follows along as you read.
              </p>
            </div>
            <MarketOverview />
            <MarketNews />
          </>
        ) : (
          <>
            {info ? (
              <CompanyHeader info={info} />
            ) : company.loading ? (
              <div style={{ padding: "22px 0" }}><Loading lines={2} /></div>
            ) : (
              <div style={{ paddingTop: 20 }}>
                <Notice kind="error" onRetry={company.reload}>
                  Could not load {symbol}. Check the ticker or try again shortly.{company.error ? ` (${company.error})` : ""}
                </Notice>
              </div>
            )}
            <nav className="tabs" aria-label="Sections">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button" className={s.id === section ? "on" : ""} aria-current={s.id === section ? "page" : undefined} onClick={() => navigate({ tab: s.id })}>
                  {s.label}
                </button>
              ))}
            </nav>
            <Section key={`${symbol}-${section}`} symbol={symbol} info={info} onContext={onContext} ask={ask} />
          </>
        )}
        <footer className="footer">Market data may be delayed. Calculated figures are derived from reported values. Nothing on this site is investment advice.</footer>
      </main>
      <ChatPanel ref={chatRef} symbol={symbol} info={info} onOpenCompany={(s) => { setContext(null); navigate({ s }); }} context={symbol ? context ?? { section, filters: {}, visible: {} } : null} />
    </div>
  );
}
