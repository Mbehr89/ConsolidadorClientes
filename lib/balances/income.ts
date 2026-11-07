import { netAmountOf } from '@/lib/aranceles/net';
import type { ArancelesSettings } from '@/lib/aranceles/settings';
import type { ArancelCommission } from '@/lib/aranceles/types';
import type { IncomeCell } from '@/lib/balances/compute';

type Row = ArancelCommission & { grupo_asesor?: string | null };

/** Neto a pagar de cada grupo, mes y moneda. El dólar cable viaja aparte para poder mostrarlo. */
export function collectIncome(rows: readonly Row[], settings: ArancelesSettings): IncomeCell[] {
  const map = new Map<string, IncomeCell>();
  for (const row of rows) {
    const aPagar = netAmountOf(row, settings);
    if (aPagar === null || !row.trade_date) continue;
    const month = row.trade_date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const grupo = row.grupo_asesor?.trim() || null;
    const key = `${month}|${grupo ?? ''}`;
    const cell = map.get(key) ?? { month, grupo, ars: 0, usd: 0, cable: 0 };
    const currency = row.commission_currency || row.currency;
    if (currency === 'ARS') cell.ars += aPagar;
    else if (currency === 'USD_EXT') cell.cable += aPagar;
    else if (currency.startsWith('USD')) cell.usd += aPagar;
    map.set(key, cell);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month) || (a.grupo ?? '').localeCompare(b.grupo ?? ''));
}
