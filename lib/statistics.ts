/**
 * Key-statistics groups (spec section 4.3), defined once and used by the Statistics section,
 * the Summary section and the AI tools. Field names are the flattened company `fields` keys.
 */
import { fmtValue, toNum, type ValueKind } from "./format";
import type { CompanyInfo } from "./types";

export type StatDef = [label: string, field: string, kind: ValueKind];

export const STAT_GROUPS: Record<string, StatDef[]> = {
  "Valuation Measures": [
    ["Market Cap", "marketCap", "large"],
    ["Enterprise Value", "enterpriseValue", "large"],
    ["Trailing P/E", "trailingPE", "ratio"],
    ["Forward P/E", "forwardPE", "ratio"],
    ["PEG Ratio", "pegRatio", "ratio"],
    ["Price to Sales (ttm)", "priceToSalesTrailing12Months", "ratio"],
    ["Price to Book (mrq)", "priceToBook", "ratio"],
    ["Enterprise Value to Revenue", "enterpriseToRevenue", "ratio"],
    ["Enterprise Value to EBITDA", "enterpriseToEbitda", "ratio"],
    ["Trailing EPS (ttm)", "trailingEps", "price"],
    ["Forward EPS", "forwardEps", "price"],
  ],
  Profitability: [
    ["Profit Margin", "profitMargins", "pct"],
    ["Gross Margin", "grossMargins", "pct"],
    ["Operating Margin (ttm)", "operatingMargins", "pct"],
    ["EBITDA Margin", "ebitdaMargins", "pct"],
  ],
  "Management Effectiveness": [
    ["Return on Assets (ttm)", "returnOnAssets", "pct"],
    ["Return on Equity (ttm)", "returnOnEquity", "pct"],
  ],
  "Financial Highlights": [
    ["Fiscal Year Ends", "lastFiscalYearEnd", "date"],
    ["Most Recent Quarter", "mostRecentQuarter", "date"],
    ["Revenue (ttm)", "totalRevenue", "large"],
    ["Revenue per Share (ttm)", "revenuePerShare", "price"],
    ["Quarterly Revenue Growth (yoy)", "revenueGrowth", "pct"],
    ["Gross Profit (ttm)", "grossProfits", "large"],
    ["EBITDA", "ebitda", "large"],
    ["Net Income to Common (ttm)", "netIncomeToCommon", "large"],
    ["Quarterly Earnings Growth (yoy)", "earningsQuarterlyGrowth", "pct"],
    ["Operating Cash Flow (ttm)", "operatingCashflow", "large"],
    ["Levered Free Cash Flow (ttm)", "freeCashflow", "large"],
  ],
  "Balance Sheet Health": [
    ["Total Cash (mrq)", "totalCash", "large"],
    ["Total Cash per Share (mrq)", "totalCashPerShare", "price"],
    ["Total Debt (mrq)", "totalDebt", "large"],
    ["Total Debt to Equity (mrq)", "debtToEquity", "pctPoints"],
    ["Current Ratio (mrq)", "currentRatio", "ratio"],
    ["Quick Ratio (mrq)", "quickRatio", "ratio"],
    ["Book Value per Share (mrq)", "bookValue", "price"],
  ],
  "Trading Information": [
    ["Beta (5Y Monthly)", "beta", "ratio"],
    ["52-Week Change", "52WeekChange", "pct"],
    ["S&P 500 52-Week Change", "SandP52WeekChange", "pct"],
    ["52-Week High", "fiftyTwoWeekHigh", "price"],
    ["52-Week Low", "fiftyTwoWeekLow", "price"],
    ["50-Day Moving Average", "fiftyDayAverage", "price"],
    ["200-Day Moving Average", "twoHundredDayAverage", "price"],
    ["Average Volume (3 month)", "averageVolume", "large"],
    ["Average Volume (10 day)", "averageVolume10days", "large"],
  ],
  "Share Statistics": [
    ["Shares Outstanding", "sharesOutstanding", "large"],
    ["Implied Shares Outstanding", "impliedSharesOutstanding", "large"],
    ["Float", "floatShares", "large"],
    ["Held by Insiders", "heldPercentInsiders", "pct"],
    ["Held by Institutions", "heldPercentInstitutions", "pct"],
    ["Shares Short", "sharesShort", "large"],
    ["Short Interest Date", "dateShortInterest", "date"],
    ["Shares Short (prior month)", "sharesShortPriorMonth", "large"],
    ["Short Ratio", "shortRatio", "ratio"],
    ["Short % of Float", "shortPercentOfFloat", "pct"],
    ["Short % of Shares Outstanding", "sharesPercentSharesOut", "pct"],
  ],
  "Dividends and Splits": [
    ["Forward Annual Dividend Rate", "dividendRate", "price"],
    ["Forward Annual Dividend Yield", "dividendYield", "pct"],
    ["Trailing Annual Dividend Rate", "trailingAnnualDividendRate", "price"],
    ["Trailing Annual Dividend Yield", "trailingAnnualDividendYield", "pct"],
    ["5 Year Average Dividend Yield", "fiveYearAvgDividendYield", "pctPoints"],
    ["Payout Ratio", "payoutRatio", "pct"],
    ["Dividend Date", "dividendDate", "date"],
    ["Ex-Dividend Date", "exDividendDate", "date"],
    ["Last Split Factor", "lastSplitFactor", "text"],
    ["Last Split Date", "lastSplitDate", "date"],
  ],
};

export const STAT_GROUP_NAMES = Object.keys(STAT_GROUPS);

export interface StatRow {
  label: string;
  field: string;
  kind: ValueKind;
  value: number | string | null;
  display: string;
}

export function field(info: Pick<CompanyInfo, "fields">, key: string): number | string | null {
  const v = info.fields[key];
  return v === undefined ? null : v;
}

export function groupRows(info: Pick<CompanyInfo, "fields">, group: string): StatRow[] {
  return (STAT_GROUPS[group] ?? []).map(([label, key, kind]) => {
    const raw = field(info, key);
    const value = kind === "date" || kind === "text" ? raw : toNum(raw);
    return { label, field: key, kind, value, display: fmtValue(value, kind) };
  });
}

/** Compact {label: value} for the AI, with unit hints on percent fields and null for unavailable. */
export function groupForAi(info: Pick<CompanyInfo, "fields">, group: string): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  for (const r of groupRows(info, group)) {
    const unit = r.kind === "pct" ? " (ratio, 0.10 = 10%)" : r.kind === "pctPoints" ? " (percent)" : "";
    out[r.label + unit] = typeof r.value === "number" ? Number(r.value.toPrecision(8)) : r.value;
  }
  return out;
}
