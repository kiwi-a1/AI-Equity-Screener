/** Financial statement line-item definitions (spec section 4.5) and normalization. */
import { toNum } from "../format";
import type { Frequency, Statement, StatementKind, StatementLine } from "../types";

type Def = [key: string, label: string, isKey: boolean, kind?: StatementLine["kind"]];

export const STATEMENT_ITEMS: Record<StatementKind, Def[]> = {
  income: [
    ["totalRevenue", "Total Revenue", true],
    ["operatingRevenue", "Operating Revenue", false],
    ["costOfRevenue", "Cost of Revenue", true],
    ["grossProfit", "Gross Profit", true],
    ["operatingExpense", "Operating Expenses", true],
    ["researchAndDevelopment", "Research and Development", true],
    ["sellingGeneralAndAdministration", "Selling, General and Administrative", true],
    ["operatingIncome", "Operating Income", true],
    ["netNonOperatingInterestIncomeExpense", "Net Non-Operating Interest", true],
    ["interestIncome", "Interest Income", false],
    ["interestExpense", "Interest Expense", false],
    ["otherIncomeExpense", "Other Income or Expense", true],
    ["pretaxIncome", "Pretax Income", true],
    ["taxProvision", "Tax Provision", true],
    ["netIncome", "Net Income", true],
    ["netIncomeCommonStockholders", "Net Income to Common Stockholders", false],
    ["basicEPS", "Basic EPS", true, "perShare"],
    ["dilutedEPS", "Diluted EPS", true, "perShare"],
    ["basicAverageShares", "Basic Weighted Average Shares", true, "shares"],
    ["dilutedAverageShares", "Diluted Weighted Average Shares", true, "shares"],
    ["EBIT", "EBIT", false],
    ["EBITDA", "EBITDA", true],
    ["normalizedEBITDA", "Normalized EBITDA", false],
    ["totalExpenses", "Total Expenses", false],
  ],
  balance: [
    ["cashAndCashEquivalents", "Cash and Cash Equivalents", true],
    ["otherShortTermInvestments", "Short-Term Investments", true],
    ["cashCashEquivalentsAndShortTermInvestments", "Cash and Short-Term Investments", false],
    ["accountsReceivable", "Accounts Receivable", true],
    ["receivables", "Total Receivables", false],
    ["inventory", "Inventory", true],
    ["currentAssets", "Total Current Assets", true],
    ["netPPE", "Net Property, Plant and Equipment", true],
    ["goodwillAndOtherIntangibleAssets", "Goodwill and Intangibles", true],
    ["goodwill", "Goodwill", false],
    ["otherIntangibleAssets", "Other Intangible Assets", false],
    ["totalNonCurrentAssets", "Total Non-Current Assets", false],
    ["totalAssets", "Total Assets", true],
    ["accountsPayable", "Accounts Payable", true],
    ["payables", "Total Payables", false],
    ["currentLiabilities", "Total Current Liabilities", true],
    ["currentDebt", "Short-Term Debt", true],
    ["longTermDebt", "Long-Term Debt", true],
    ["totalDebt", "Total Debt", true],
    ["totalLiabilitiesNetMinorityInterest", "Total Liabilities", true],
    ["stockholdersEquity", "Stockholders' Equity", true],
    ["totalEquityGrossMinorityInterest", "Total Equity incl. Minority Interest", false],
    ["retainedEarnings", "Retained Earnings", true],
    ["workingCapital", "Working Capital", false],
    ["netDebt", "Net Debt", false],
    ["ordinarySharesNumber", "Ordinary Shares Outstanding", false, "shares"],
  ],
  cashflow: [
    ["netIncomeFromContinuingOperations", "Net Income from Continuing Operations", true],
    ["depreciationAndAmortization", "Depreciation and Amortization", true],
    ["stockBasedCompensation", "Stock-Based Compensation", true],
    ["changeInWorkingCapital", "Change in Working Capital", true],
    ["operatingCashFlow", "Operating Cash Flow", true],
    ["capitalExpenditure", "Capital Expenditure", true],
    ["investingCashFlow", "Investing Cash Flow", true],
    ["issuanceOfDebt", "Debt Issuance", true],
    ["repaymentOfDebt", "Debt Repayment", true],
    ["repurchaseOfCapitalStock", "Share Repurchases", true],
    ["cashDividendsPaid", "Dividends Paid", true],
    ["financingCashFlow", "Financing Cash Flow", true],
    ["changesInCash", "Net Change in Cash", true],
    ["endCashPosition", "End Cash Position", false],
    ["freeCashFlow", "Free Cash Flow", true],
  ],
};

export const STATEMENT_LABELS: Record<StatementKind, string> = {
  income: "Income Statement",
  balance: "Balance Sheet",
  cashflow: "Cash Flow",
};

const SKIP = new Set(["date", "TYPE", "periodType"]);

export function camelToTitle(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Turn per-period rows ({date, totalRevenue, ...}) into a Statement: canonical rows first in spec order,
 * any other reported rows after (alphabetical), periods newest first, empty periods dropped.
 */
export function normalizeStatement(
  symbol: string,
  kind: StatementKind,
  frequency: Frequency,
  rows: Array<Record<string, unknown>>,
): Statement {
  const withData = rows
    .map((r) => ({ date: r.date instanceof Date ? r.date.toISOString() : String(r.date ?? ""), row: r }))
    .filter(({ date, row }) => !Number.isNaN(new Date(date).getTime()) && Object.entries(row).some(([k, v]) => !SKIP.has(k) && toNum(v) !== null))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Collapse duplicate period dates, keeping the first non-null value per key.
  const byDate = new Map<string, Record<string, unknown>>();
  for (const { date, row } of withData) {
    const d = date.slice(0, 10);
    const existing = byDate.get(d) ?? {};
    for (const [k, v] of Object.entries(row)) if (existing[k] === undefined || existing[k] === null) existing[k] = v;
    byDate.set(d, existing);
  }
  const periods = [...byDate.keys()];
  const periodRows = periods.map((p) => byDate.get(p)!);

  const defs = STATEMENT_ITEMS[kind];
  const canonical = new Set(defs.map(([k]) => k));
  const present = (key: string) => periodRows.some((r) => toNum(r[key]) !== null);

  const lines: StatementLine[] = [];
  for (const [key, label, isKey, lineKind = "money"] of defs) {
    if (!present(key)) continue;
    lines.push({ key, label, isKey, kind: lineKind, values: periodRows.map((r) => toNum(r[key])) });
  }
  const extras = new Set<string>();
  for (const r of periodRows) for (const k of Object.keys(r)) if (!SKIP.has(k) && !canonical.has(k) && present(k)) extras.add(k);
  for (const key of [...extras].sort()) {
    const kindGuess: StatementLine["kind"] = /EPS/.test(key) ? "perShare" : /Shares/.test(key) ? "shares" : "money";
    lines.push({ key, label: camelToTitle(key), isKey: false, kind: kindGuess, values: periodRows.map((r) => toNum(r[key])) });
  }
  return { symbol, kind, frequency, periods: periods.map((p) => `${p}T00:00:00.000Z`), lines };
}

export function lineValue(stmt: Statement, key: string, periodIndex = 0): number | null {
  const line = stmt.lines.find((l) => l.key === key);
  return line ? line.values[periodIndex] ?? null : null;
}
