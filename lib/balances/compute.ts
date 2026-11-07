import type { BalanceCurrency, BalanceExpense, BalancePartner, BalancesConfig, MonthFx } from '@/lib/balances/config';

export type IncomeCell = {
  month: string;
  grupo: string | null;
  /** A pagar en pesos. */
  ars: number;
  /** A pagar en dólares billete. */
  usd: number;
  /** A pagar en dólar cable. Entra al mismo tipo de cambio que el billete. */
  cable: number;
};

export type DisplayCurrency = BalanceCurrency;

export type MonthBalance = {
  month: string;
  arsIncome: number;
  usdIncome: number;
  cableIncome: number;
  arsSalaries: number;
  usdSalaries: number;
  arsExpenses: number;
  usdExpenses: number;
  fx: number | null;
  income: number | null;
  salaries: number | null;
  expenses: number | null;
  result: number | null;
  missingFx: boolean;
  partners: PartnerShare[];
  unassignedProfit: number | null;
};

export type PartnerShare = {
  id: string;
  name: string;
  equity: number;
  profit: number;
  /** Resultado × % de beneficio. null si falta el tipo de cambio. */
  byProfit: number | null;
  /** Resultado × % de equity, para comparar los dos criterios. */
  byEquity: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pasa un flujo ya separado en pesos y dólares a la moneda elegida. 0 no exige tipo de cambio. */
export function unify(ars: number, usd: number, fx: number | null, display: DisplayCurrency): number | null {
  if (display === 'ARS') {
    if (usd === 0) return ars;
    if (fx === null) return null;
    return ars + usd * fx;
  }
  if (ars === 0) return usd;
  if (fx === null) return null;
  return usd + ars / fx;
}

function fxOf(fx: readonly MonthFx[], month: string): number | null {
  const row = fx.find((f) => f.month === month);
  return row && row.arsPerUsd > 0 ? row.arsPerUsd : null;
}

function inGroup(grupo: string | null, selected: string | null, all: boolean): boolean {
  return all || grupo === selected;
}

function sumKind(
  expenses: readonly BalanceExpense[],
  month: string,
  grupo: string | null,
  all: boolean,
  kind: 'salary' | 'expense'
): { ars: number; usd: number } {
  let ars = 0;
  let usd = 0;
  for (const e of expenses) {
    if (e.month !== month || !inGroup(e.grupo, grupo, all)) continue;
    const salary = e.kind === 'sueldo';
    if (kind === 'salary' ? !salary : salary) continue;
    if (e.currency === 'ARS') ars += e.amount;
    else usd += e.amount;
  }
  return { ars, usd };
}

/**
 * Balance mensual de un grupo (o de todos, si `grupo` es `'*'`).
 * El resultado se reparte por el % de beneficio. El % de equity queda al lado, sobre el mismo resultado.
 */
export function buildMonthBalances(
  income: readonly IncomeCell[],
  config: BalancesConfig,
  grupo: string | null | '*',
  display: DisplayCurrency
): MonthBalance[] {
  const all = grupo === '*';
  const selected = all ? null : grupo;
  const months = new Set<string>();
  for (const cell of income) {
    if (inGroup(cell.grupo, selected, all)) months.add(cell.month);
  }
  for (const e of config.expenses) {
    if (inGroup(e.grupo, selected, all)) months.add(e.month);
  }
  const partners = all ? [] : config.partners.filter((p) => p.grupo === selected);

  return [...months].sort().map((month) => monthBalance(income, config, month, selected, all, display, partners));
}

function monthBalance(
  income: readonly IncomeCell[],
  config: BalancesConfig,
  month: string,
  grupo: string | null,
  all: boolean,
  display: DisplayCurrency,
  partners: readonly BalancePartner[]
): MonthBalance {
  let arsIncome = 0;
  let usdIncome = 0;
  let cableIncome = 0;
  for (const cell of income) {
    if (cell.month !== month || !inGroup(cell.grupo, grupo, all)) continue;
    arsIncome += cell.ars;
    usdIncome += cell.usd + cell.cable;
    cableIncome += cell.cable;
  }
  const salaries = sumKind(config.expenses, month, grupo, all, 'salary');
  const expenses = sumKind(config.expenses, month, grupo, all, 'expense');
  const fx = fxOf(config.fx, month);
  const incomeUnified = unify(arsIncome, usdIncome, fx, display);
  const salariesUnified = unify(salaries.ars, salaries.usd, fx, display);
  const expensesUnified = unify(expenses.ars, expenses.usd, fx, display);
  const missingFx = incomeUnified === null || salariesUnified === null || expensesUnified === null;
  const result =
    incomeUnified === null || salariesUnified === null || expensesUnified === null
      ? null
      : incomeUnified - salariesUnified - expensesUnified;
  const profitSum = partners.reduce((s, p) => s + p.profit, 0);
  return {
    month,
    arsIncome,
    usdIncome,
    cableIncome,
    arsSalaries: salaries.ars,
    usdSalaries: salaries.usd,
    arsExpenses: expenses.ars,
    usdExpenses: expenses.usd,
    fx,
    income: incomeUnified,
    salaries: salariesUnified,
    expenses: expensesUnified,
    result,
    missingFx,
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      equity: p.equity,
      profit: p.profit,
      byProfit: result === null ? null : result * p.profit,
      byEquity: result === null ? null : result * p.equity,
    })),
    unassignedProfit: result === null ? null : result * (1 - profitSum),
  };
}

export function totalsOf(months: readonly MonthBalance[]): {
  income: number | null;
  salaries: number | null;
  expenses: number | null;
  result: number | null;
  openMonths: string[];
} {
  const openMonths = months.filter((m) => m.missingFx).map((m) => m.month);
  if (openMonths.length) return { income: null, salaries: null, expenses: null, result: null, openMonths };
  const sum = (pick: (m: MonthBalance) => number | null) => months.reduce((s, m) => s + (pick(m) ?? 0), 0);
  return {
    income: round2(sum((m) => m.income)),
    salaries: round2(sum((m) => m.salaries)),
    expenses: round2(sum((m) => m.expenses)),
    result: round2(sum((m) => m.result)),
    openMonths,
  };
}

/** Meses que tienen dólares (ingreso o egreso) y todavía no tienen tipo de cambio. */
export function monthsMissingFx(income: readonly IncomeCell[], config: BalancesConfig): string[] {
  const needs = new Set<string>();
  for (const cell of income) {
    if (cell.usd !== 0 || cell.cable !== 0) needs.add(cell.month);
  }
  for (const e of config.expenses) {
    if (e.currency === 'USD' && e.amount !== 0) needs.add(e.month);
  }
  for (const cell of income) {
    if (cell.ars !== 0) needs.add(cell.month);
  }
  for (const e of config.expenses) {
    if (e.currency === 'ARS' && e.amount !== 0) needs.add(e.month);
  }
  const have = new Set(config.fx.map((f) => f.month));
  return [...needs].filter((m) => !have.has(m)).sort();
}
