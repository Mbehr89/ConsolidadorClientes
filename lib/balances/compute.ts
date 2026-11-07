import {
  EXPENSE_KIND_LABEL,
  EXPENSE_KINDS,
  type BalanceCurrency,
  type BalanceExpense,
  type BalancePartner,
  type BalancesConfig,
  type ExpenseKind,
  type MonthFx,
} from '@/lib/balances/config';

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

export type FlowLine = {
  id: string;
  label: string;
  level: 0 | 1;
  strong: boolean;
  /** Negativo en sueldos y gastos, para que la columna sume el resultado. */
  total: number;
  partners: Record<string, number>;
  unassigned: number;
};

export type FlowPartner = {
  key: string;
  name: string;
  /** null si el mismo socio tiene distintos porcentajes en los grupos elegidos. */
  equity: number | null;
  profit: number | null;
};

export type CompanyFlow = {
  partners: FlowPartner[];
  lines: FlowLine[];
  result: number | null;
  /** Grupos elegidos que no tienen socios: su resultado queda en Sin asignar. */
  groupsWithoutPartners: (string | null)[];
  /** Mes y grupo que no entraron porque faltaba el tipo de cambio. */
  omitted: { month: string; grupo: string | null }[];
};

type Bucket = {
  total: number;
  byPartner: Map<string, number>;
  unassigned: number;
};

function emptyBucket(): Bucket {
  return { total: 0, byPartner: new Map(), unassigned: 0 };
}

function pour(bucket: Bucket, amount: number, members: readonly { key: string; profit: number }[]) {
  bucket.total += amount;
  let assigned = 0;
  for (const member of members) {
    bucket.byPartner.set(member.key, (bucket.byPartner.get(member.key) ?? 0) + amount * member.profit);
    assigned += amount * member.profit;
  }
  bucket.unassigned += amount - assigned;
}

function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sameNumber(values: number[]): number | null {
  if (!values.length) return null;
  const first = values[0]!;
  return values.every((v) => Math.abs(v - first) < 1e-9) ? first : null;
}

/**
 * Estado de resultados de uno o más grupos en un período.
 * Cada línea se reparte con el % de beneficio del socio en su grupo. El mismo nombre en dos grupos es una sola columna.
 */
export function buildCompanyFlow(
  income: readonly IncomeCell[],
  config: BalancesConfig,
  grupos: readonly (string | null)[],
  from: string,
  to: string,
  display: DisplayCurrency
): CompanyFlow {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const selected = new Set(grupos.map((g) => g ?? ''));
  const inRange = (month: string) => month >= start && month <= end;
  const chosen = (grupo: string | null) => selected.has(grupo ?? '');

  const names = new Map<string, { name: string; equity: number[]; profit: number[] }>();
  const membersOf = (grupo: string | null) => {
    const members: { key: string; profit: number }[] = [];
    for (const partner of config.partners) {
      if (partner.grupo !== grupo) continue;
      const key = foldName(partner.name);
      if (!key) continue;
      const known = names.get(key) ?? { name: partner.name.trim(), equity: [], profit: [] };
      known.equity.push(partner.equity);
      known.profit.push(partner.profit);
      names.set(key, known);
      members.push({ key, profit: partner.profit });
    }
    return members;
  };

  const incomeBucket = emptyBucket();
  const resultBucket = emptyBucket();
  const salaries = new Map<string, Bucket>();
  const expenses = new Map<ExpenseKind, Map<string, Bucket>>();
  const omitted: { month: string; grupo: string | null }[] = [];
  const groupsWithoutPartners = new Set<string>();
  let included = false;

  const months = new Set<string>();
  for (const cell of income) if (chosen(cell.grupo) && inRange(cell.month)) months.add(cell.month);
  for (const expense of config.expenses) if (chosen(expense.grupo) && inRange(expense.month)) months.add(expense.month);

  for (const month of [...months].sort()) {
    for (const grupo of grupos) {
      let arsIncome = 0;
      let usdIncome = 0;
      for (const cell of income) {
        if (cell.month !== month || cell.grupo !== grupo) continue;
        arsIncome += cell.ars;
        usdIncome += cell.usd + cell.cable;
      }
      const salaryRows = config.expenses.filter((e) => e.month === month && e.grupo === grupo && e.kind === 'sueldo');
      const expenseRows = config.expenses.filter((e) => e.month === month && e.grupo === grupo && e.kind !== 'sueldo');
      const hasMoney = arsIncome !== 0 || usdIncome !== 0 || salaryRows.some((e) => e.amount !== 0) || expenseRows.some((e) => e.amount !== 0);
      if (!hasMoney) continue;

      const fx = fxOf(config.fx, month);
      const incomeUnified = unify(arsIncome, usdIncome, fx, display);
      const salaryParts = salaryRows.map((row) => ({ row, amount: unify(row.currency === 'ARS' ? row.amount : 0, row.currency === 'USD' ? row.amount : 0, fx, display) }));
      const expenseParts = expenseRows.map((row) => ({ row, amount: unify(row.currency === 'ARS' ? row.amount : 0, row.currency === 'USD' ? row.amount : 0, fx, display) }));
      if (incomeUnified === null || salaryParts.some((p) => p.amount === null) || expenseParts.some((p) => p.amount === null)) {
        omitted.push({ month, grupo });
        continue;
      }

      const members = membersOf(grupo);
      if (!members.length) groupsWithoutPartners.add(grupo ?? '');
      included = true;
      pour(incomeBucket, incomeUnified, members);
      pour(resultBucket, incomeUnified, members);
      for (const part of salaryParts) {
        if (!part.amount) continue;
        const label = part.row.label.trim() || 'Sueldo';
        const bucket = salaries.get(label) ?? emptyBucket();
        pour(bucket, -(part.amount as number), members);
        pour(resultBucket, -(part.amount as number), members);
        salaries.set(label, bucket);
      }
      for (const part of expenseParts) {
        if (!part.amount) continue;
        const kind = part.row.kind;
        const byLabel = expenses.get(kind) ?? new Map<string, Bucket>();
        const label = part.row.label.trim() || EXPENSE_KIND_LABEL[kind];
        const bucket = byLabel.get(label) ?? emptyBucket();
        pour(bucket, -(part.amount as number), members);
        pour(resultBucket, -(part.amount as number), members);
        byLabel.set(label, bucket);
        expenses.set(kind, byLabel);
      }
    }
  }

  const partnerList: FlowPartner[] = [...names.entries()].map(([key, info]) => ({
    key,
    name: info.name,
    equity: sameNumber(info.equity),
    profit: sameNumber(info.profit),
  }));
  const keys = partnerList.map((p) => p.key);

  const toLine = (id: string, label: string, level: 0 | 1, strong: boolean, bucket: Bucket): FlowLine => {
    const shares: Record<string, number> = {};
    for (const key of keys) shares[key] = bucket.byPartner.get(key) ?? 0;
    return { id, label, level, strong, total: bucket.total, partners: shares, unassigned: bucket.unassigned };
  };

  const lines: FlowLine[] = [];
  if (included) {
    lines.push(toLine('income', 'Ingresos por aranceles', 0, true, incomeBucket));
    if (salaries.size) {
      const subtotal = emptyBucket();
      for (const bucket of salaries.values()) {
        subtotal.total += bucket.total;
        subtotal.unassigned += bucket.unassigned;
        for (const [key, value] of bucket.byPartner) subtotal.byPartner.set(key, (subtotal.byPartner.get(key) ?? 0) + value);
      }
      lines.push(toLine('salaries', 'Sueldos', 0, true, subtotal));
      for (const [label, bucket] of [...salaries.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
        if (salaries.size === 1 && foldName(label) === foldName('Sueldos')) continue;
        lines.push(toLine(`salary:${label}`, label, 1, false, bucket));
      }
    }
    for (const kind of EXPENSE_KINDS) {
      if (kind === 'sueldo') continue;
      const byLabel = expenses.get(kind);
      if (!byLabel?.size) continue;
      const subtotal = emptyBucket();
      for (const bucket of byLabel.values()) {
        subtotal.total += bucket.total;
        subtotal.unassigned += bucket.unassigned;
        for (const [key, value] of bucket.byPartner) subtotal.byPartner.set(key, (subtotal.byPartner.get(key) ?? 0) + value);
      }
      lines.push(toLine(`kind:${kind}`, EXPENSE_KIND_LABEL[kind], 0, true, subtotal));
      const details = [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
      const onlyEcho = details.length === 1 && foldName(details[0]![0]) === foldName(EXPENSE_KIND_LABEL[kind]);
      if (!onlyEcho) {
        for (const [label, bucket] of details) lines.push(toLine(`expense:${kind}:${label}`, label, 1, false, bucket));
      }
    }
    lines.push(toLine('result', 'Resultado del período', 0, true, resultBucket));
  }

  return {
    partners: partnerList,
    lines,
    result: included ? resultBucket.total : null,
    groupsWithoutPartners: [...groupsWithoutPartners].map((g) => (g ? g : null)),
    omitted,
  };
}
