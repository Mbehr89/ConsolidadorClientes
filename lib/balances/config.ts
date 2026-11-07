/** Configuración del balance: socios, sueldos, gastos y tipo de cambio mensual. */

export const EXPENSE_KINDS = ['sueldo', 'alquiler', 'impuestos', 'sistemas', 'honorarios', 'otro'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_KIND_LABEL: Record<ExpenseKind, string> = {
  sueldo: 'Sueldo',
  alquiler: 'Alquiler',
  impuestos: 'Impuestos',
  sistemas: 'Sistemas',
  honorarios: 'Honorarios',
  otro: 'Otro',
};

export type BalanceCurrency = 'ARS' | 'USD';

export type BalancePartner = {
  id: string;
  name: string;
  /** Grupo asesor. null = cuentas sin grupo. */
  grupo: string | null;
  /** Participación en el capital, de 0 a 1. */
  equity: number;
  /** Participación en el resultado, de 0 a 1. */
  profit: number;
};

export type BalanceExpense = {
  id: string;
  grupo: string | null;
  kind: ExpenseKind;
  /** Concepto libre: "Sueldo de Martín", "Expensas". */
  label: string;
  /** YYYY-MM */
  month: string;
  currency: BalanceCurrency;
  /** Importe positivo. Se resta del ingreso. */
  amount: number;
};

export type MonthFx = {
  month: string;
  /** Pesos por dólar para valuar el devengado de ese mes. */
  arsPerUsd: number;
};

export type BalancesConfig = {
  partners: BalancePartner[];
  expenses: BalanceExpense[];
  fx: MonthFx[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function emptyBalances(): BalancesConfig {
  return { partners: [], expenses: [], fx: [] };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function share(v: unknown): number | null {
  const n = num(v);
  if (n === null || n < 0 || n > 1) return null;
  return n;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function grupoOf(v: unknown): string | null {
  const s = text(v, 80);
  return s || null;
}

function kindOf(v: unknown): ExpenseKind | null {
  return EXPENSE_KINDS.includes(v as ExpenseKind) ? (v as ExpenseKind) : null;
}

function currencyOf(v: unknown): BalanceCurrency | null {
  return v === 'ARS' || v === 'USD' ? v : null;
}

/** Descarta filas rotas. Un % fuera de 0–100 no se guarda. */
export function coerceBalances(raw: unknown): BalancesConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BalancesConfig>;
  const partners: BalancePartner[] = [];
  for (const row of Array.isArray(r.partners) ? r.partners : []) {
    const p = row as Partial<BalancePartner>;
    const equity = share(p.equity);
    const profit = share(p.profit);
    const name = text(p.name, 80);
    const id = text(p.id, 80);
    if (!id || !name || equity === null || profit === null) continue;
    partners.push({ id, name, grupo: grupoOf(p.grupo), equity, profit });
  }
  const expenses: BalanceExpense[] = [];
  for (const row of Array.isArray(r.expenses) ? r.expenses : []) {
    const e = row as Partial<BalanceExpense>;
    const amount = num(e.amount);
    const kind = kindOf(e.kind);
    const currency = currencyOf(e.currency);
    const month = text(e.month, 7);
    const id = text(e.id, 80);
    const label = text(e.label, 120);
    if (!id || !label || !kind || !currency || !MONTH.test(month) || amount === null || amount < 0) continue;
    expenses.push({ id, grupo: grupoOf(e.grupo), kind, label, month, currency, amount });
  }
  const fx: MonthFx[] = [];
  const seenMonth = new Set<string>();
  for (const row of Array.isArray(r.fx) ? r.fx : []) {
    const f = row as Partial<MonthFx>;
    const month = text(f.month, 7);
    const rate = num(f.arsPerUsd);
    if (!MONTH.test(month) || rate === null || rate <= 0 || seenMonth.has(month)) continue;
    seenMonth.add(month);
    fx.push({ month, arsPerUsd: rate });
  }
  return { partners, expenses, fx };
}
