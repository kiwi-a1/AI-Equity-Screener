"use client";
/** Summary: price, valuation, quote and trading, earnings and dividends, and the business profile. */
import { useEffect, useState } from "react";

import { fmtDate, fmtInt, fmtLarge, fmtNumber, fmtPct, NA, toNum } from "@/lib/format";
import { field } from "@/lib/statistics";
import type { CompanyInfo, History } from "@/lib/types";

import { Sparkline } from "../charts";
import { CALC_TITLE, DataState, Kicker, Ledger, Notice, RangeBar, Seg } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

const RANGES = ["1M", "6M", "YTD", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

type Row = { label: string; value: string; derived?: boolean };

/** Plain-language profile built from reported fields, used when the source has no business description. */
export function profileSentence(info: CompanyInfo): string {
  const name = info.name ?? info.symbol;
  const parts = [`${name} (${info.symbol})`];
  const kind = info.quoteType ? info.quoteType.toLowerCase().replace("equity", "publicly traded company") : "listed security";
  let s = `${parts[0]} is a ${kind}`;
  if (info.exchange) s += ` listed on ${info.exchange}`;
  if (info.industry) s += `, operating in the ${info.industry} industry`;
  if (info.sector) s += ` within the ${info.sector} sector`;
  if (info.country) s += `, based in ${info.country}`;
  s += ".";
  const cap = toNum(info.fields.marketCap);
  if (cap !== null) s += ` Its market value is about ${fmtLarge(cap)} ${info.currency ?? ""}.`.replace(" .", ".");
  if (info.price !== null) s += ` The latest price is ${fmtNumber(info.price)} ${info.currency ?? ""}.`.replace(" .", ".");
  return s;
}

export default function Summary({ symbol, info, onContext }: SectionProps) {
  const [period, setPeriod] = useState<Range>("1Y");
  const hist = useApi<History>(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${period}&interval=${period === "5Y" ? "1wk" : "1d"}`);

  const derived = new Set(info?.derived ?? []);
  const n = (...keys: string[]) => {
    for (const k of keys) {
      const v = info ? toNum(field(info, k)) : null;
      if (v !== null) return { v, d: derived.has(k) };
    }
    return { v: null, d: false };
  };
  const row = (label: string, keys: string[], fmt: (v: number | null) => string): Row => {
    const { v, d } = n(...keys);
    return { label, value: fmt(v), derived: d };
  };
  const rangeRow = (label: string, lo: string[], hi: string[]): Row => {
    const a = n(...lo);
    const b = n(...hi);
    return { label, value: a.v === null || b.v === null ? NA : `${fmtNumber(a.v)} to ${fmtNumber(b.v)}`, derived: a.d || b.d };
  };
  const bidAsk = (label: string, p: string, size: string): Row => {
    const a = n(p).v;
    const sz = n(size).v;
    return { label, value: a === null || a === 0 ? NA : `${fmtNumber(a)}${sz ? ` x ${fmtInt(sz)}` : ""}` };
  };

  const quoteRows: Row[] = [
    row("Previous Close", ["regularMarketPreviousClose", "previousClose"], fmtNumber),
    row("Open", ["regularMarketOpen", "open"], fmtNumber),
    rangeRow("Day's Range", ["regularMarketDayLow", "dayLow"], ["regularMarketDayHigh", "dayHigh"]),
    rangeRow("52-Week Range", ["fiftyTwoWeekLow"], ["fiftyTwoWeekHigh"]),
    row("Volume", ["regularMarketVolume", "volume"], fmtInt),
    row("Average Volume (3M)", ["averageVolume", "averageDailyVolume3Month"], fmtInt),
    bidAsk("Bid", "bid", "bidSize"),
    bidAsk("Ask", "ask", "askSize"),
  ];
  const valuationRows: Row[] = [
    row("Market Cap", ["marketCap"], fmtLarge),
    row("Enterprise Value", ["enterpriseValue"], fmtLarge),
    row("P/E (ttm)", ["trailingPE"], fmtNumber),
    row("Forward P/E", ["forwardPE"], fmtNumber),
    row("PEG Ratio", ["pegRatio", "trailingPegRatio"], fmtNumber),
    row("Price to Sales (ttm)", ["priceToSalesTrailing12Months"], fmtNumber),
    row("Price to Book", ["priceToBook"], fmtNumber),
    row("EV to Revenue", ["enterpriseToRevenue"], fmtNumber),
    row("EV to EBITDA", ["enterpriseToEbitda"], fmtNumber),
    row("Profit Margin", ["profitMargins"], (v) => fmtPct(v)),
  ];
  const rate = n("dividendRate", "trailingAnnualDividendRate");
  const yld = n("dividendYield", "trailingAnnualDividendYield");
  const dateRow = (label: string, keys: string[], fallbackLabel: Record<string, string> = {}): Row => {
    for (const k of keys) {
      const v = info ? field(info, k) : null;
      if (v) return { label: fallbackLabel[k] ?? label, value: fmtDate(v), derived: derived.has(k) };
    }
    return { label, value: NA };
  };
  const otherRows: Row[] = [
    row("EPS (ttm)", ["trailingEps"], fmtNumber),
    row("Forward EPS", ["forwardEps"], fmtNumber),
    dateRow("Next Earnings Date", ["earningsDate", "earningsTimestamp"]),
    { label: "Dividend and Yield", value: rate.v === null && yld.v === null ? "None in the last year" : `${fmtNumber(rate.v)} (${fmtPct(yld.v)})`, derived: rate.d || yld.d },
    dateRow("Ex-Dividend Date", ["exDividendDate", "calendarExDividendDate", "lastDividendDate"], { lastDividendDate: "Last Ex-Dividend Date" }),
    row("Beta", ["beta"], fmtNumber),
    row("1Y Target Estimate", ["targetMeanPrice"], fmtNumber),
    dateRow("Most Recent Quarter", ["mostRecentQuarter"]),
  ];

  useEffect(() => {
    const visible: Record<string, string> = {};
    for (const r of [...quoteRows, ...valuationRows, ...otherRows]) visible[r.label] = r.value;
    onContext({ chart_range: period }, visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, period]);

  const bars = hist.data?.bars ?? [];
  const firstClose = bars.find((b) => b.close !== null)?.close ?? null;
  const lastClose = [...bars].reverse().find((b) => b.close !== null)?.close ?? null;
  const ret = firstClose && lastClose ? (lastClose - firstClose) / firstClose : null;
  const anyCalc = [...quoteRows, ...valuationRows, ...otherRows].some((r) => r.derived && r.value !== NA);
  const hi = n("fiftyTwoWeekHigh").v;
  const lo = n("fiftyTwoWeekLow").v;

  return (
    <div>
      {info?.partial ? (
        <Notice kind="warn">
          The detailed company profile was limited right now, so several figures below were calculated from reported statements and prices.
        </Notice>
      ) : null}
      <div className="cols cols-3-2">
        <div>
          <section className="block">
            <Kicker aside={ret !== null ? <span className={ret >= 0 ? "up" : "down"}>{fmtPct(ret, { signed: true })} over {period}</span> : null}>Price</Kicker>
            <Seg value={period} onChange={setPeriod} options={RANGES.map((r) => ({ value: r, label: r }))} />
            <DataState loading={hist.loading} error={hist.error} hasData={bars.length > 0} what="price history" onRetry={hist.reload}>
              <Sparkline bars={bars} height={230} />
            </DataState>
            <RangeBar low={lo} high={hi} value={info?.price ?? null} format={(v) => fmtNumber(v)} />
          </section>
          <section className="block plain">
            <Kicker>Valuation</Kicker>
            <Ledger rows={valuationRows} twoColumn />
          </section>
        </div>
        <div>
          <section className="block plain">
            <Kicker>Quote and Trading</Kicker>
            <Ledger rows={quoteRows} />
          </section>
          <section className="block plain">
            <Kicker>Earnings and Dividends</Kicker>
            <Ledger rows={otherRows} />
          </section>
        </div>
      </div>
      <section className="block plain" style={{ marginTop: 16 }}>
        <Kicker aside={[info?.industry, info?.country].filter(Boolean).join(", ") || info?.exchange || null}>About {info?.name ?? symbol}</Kicker>
        <p className="lede dropcap">{info?.description ?? (info ? profileSentence(info) : `${symbol} is a listed security.`)}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {info?.employees ? `${fmtInt(info.employees)} full-time employees. ` : ""}
          {info?.website ? (
            <a href={info.website} target="_blank" rel="noopener noreferrer">
              {info.website.replace(/^https?:\/\//, "")}
            </a>
          ) : null}
          {anyCalc ? <span title={CALC_TITLE}> Figures marked calc are calculated from reported statements and prices.</span> : null}
        </p>
      </section>
    </div>
  );
}
