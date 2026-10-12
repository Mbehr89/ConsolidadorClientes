import { operationCategory } from '@/lib/aranceles/categories';
import { isAnomaly } from '@/lib/aranceles/fees';
import { tradingSide } from '@/lib/aranceles/trading';
import { FEE_STATUS_LABEL, type ArancelCommission, type FeeStatus } from '@/lib/aranceles/types';

/**
 * Qué muestra Control: las anomalías, las operaciones que el archivo trae sin arancel "esperado"
 * (p. ej. pata contado de la caución) y las que se cobraron con el mínimo. Las SENEBI sin arancel
 * van a un recuadro aparte para cargar a mano el importe a cobrar.
 */
export type ControlStatus = Exclude<FeeStatus, 'ok'> | 'min_fee';

export const CONTROL_STATUSES: readonly ControlStatus[] = [
  'missing',
  'zero',
  'min_on_large',
  'below_expected',
  'skipped',
  'min_fee',
];

export const CONTROL_STATUS_LABEL: Record<ControlStatus, string> = {
  missing: FEE_STATUS_LABEL.missing,
  zero: FEE_STATUS_LABEL.zero,
  below_expected: FEE_STATUS_LABEL.below_expected,
  min_on_large: FEE_STATUS_LABEL.min_on_large,
  skipped: FEE_STATUS_LABEL.skipped,
  min_fee: 'Arancel mínimo',
};

export function isControlStatus(v: string | null | undefined): v is ControlStatus {
  return CONTROL_STATUSES.includes(v as ControlStatus);
}

/** SENEBI que la ALYC no liquidó con arancel (o a la que ya se le cargó el importe a mano). */
export function isSenebiToCharge(c: Pick<ArancelCommission, 'operation' | 'commission' | 'manual_commission'>): boolean {
  return operationCategory(c.operation) === 'senebi' && (c.manual_commission != null || c.commission === 0);
}

export function controlStatus(c: ArancelCommission): ControlStatus | null {
  if (isSenebiToCharge(c)) return null;
  if (isAnomaly(c.fee_status) || c.fee_status === 'skipped') return c.fee_status as ControlStatus;
  if (c.is_min_fee) return 'min_fee';
  return null;
}

export type ControlSortKey = 'estado' | 'fecha' | 'boleto';
export type ControlSort = { by: ControlSortKey; dir: 'asc' | 'desc' };
export const CONTROL_SORT_KEYS: readonly ControlSortKey[] = ['estado', 'fecha', 'boleto'];

const opNumberCollator = new Intl.Collator('es', { numeric: true });

/** N° de boleto como número ("998" < "1002"); los que no tienen n° van siempre al final. */
function compareOpNumber(a: string | null, b: string | null, sign: number): number {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return sign * opNumberCollator.compare(a, b);
}

export type ControlRow<T extends ArancelCommission = ArancelCommission> = T & { control_status: ControlStatus };

export function listControlRows<T extends ArancelCommission>(
  rows: readonly T[],
  sort: ControlSort = { by: 'estado', dir: 'asc' },
  status: ControlStatus | null = null
): ControlRow<T>[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const out: ControlRow<T>[] = [];
  for (const c of rows) {
    const s = controlStatus(c);
    if (s && (!status || s === status)) out.push({ ...c, control_status: s });
  }
  return out.sort((a, b) => {
    if (sort.by === 'fecha') {
      return sign * a.trade_date.localeCompare(b.trade_date) || compareOpNumber(a.op_number, b.op_number, sign);
    }
    if (sort.by === 'boleto') {
      return compareOpNumber(a.op_number, b.op_number, sign) || sign * a.trade_date.localeCompare(b.trade_date);
    }
    return (
      CONTROL_STATUSES.indexOf(a.control_status) - CONTROL_STATUSES.indexOf(b.control_status) ||
      b.trade_date.localeCompare(a.trade_date)
    );
  });
}

export function controlSummary(rows: readonly ArancelCommission[]): { status: ControlStatus; count: number }[] {
  const counts = new Map<ControlStatus, number>();
  for (const c of rows) {
    const s = controlStatus(c);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return CONTROL_STATUSES.filter((s) => counts.has(s)).map((s) => ({ status: s, count: counts.get(s)! }));
}

export type TradingMember<T extends ArancelCommission = ArancelCommission> = T & {
  control_status: ControlStatus | null;
  side: 'buy' | 'sell' | null;
};

/** Grupo de posible trading con alguna pata a revisar, junto con las patas que sí cobraron arancel. */
export type TradingReview<T extends ArancelCommission = ArancelCommission> = {
  id: string;
  alyc: string;
  client: string;
  client_external_id: string | null;
  trade_date: string;
  currency: string;
  from: string;
  to: string;
  sells: number;
  buys: number;
  basis: 'importe' | 'cantidad';
  instrument: string | null;
  /** `false`: boletos del mismo día que no son seguidos. */
  consecutive: boolean;
  /** Arancel cobrado en todo el grupo, por moneda del arancel. */
  charged: Record<string, number>;
  members: TradingMember<T>[];
};

/**
 * Separa las operaciones de posible trading en grupos (con todas sus patas, aunque estén fuera del
 * filtro, para ver dónde se cobró el arancel) y devuelve el resto para la lista común.
 */
export function splitTradingReviews<T extends ArancelCommission>(
  scoped: readonly T[],
  all: readonly T[]
): { groups: TradingReview<T>[]; rest: T[] } {
  const flaggedIds = new Set<string>();
  for (const c of scoped) if (c.trading_group && controlStatus(c)) flaggedIds.add(c.trading_group.id);
  if (flaggedIds.size === 0) return { groups: [], rest: [...scoped] };

  const byGroup = new Map<string, T[]>();
  for (const c of all) {
    const id = c.trading_group?.id;
    if (!id || !flaggedIds.has(id)) continue;
    const list = byGroup.get(id) ?? [];
    list.push(c);
    byGroup.set(id, list);
  }

  const groups: TradingReview<T>[] = [];
  for (const [id, list] of byGroup) {
    const first = list[0]!;
    const g = first.trading_group!;
    const charged: Record<string, number> = {};
    for (const c of list) {
      if (c.commission) charged[c.commission_currency] = (charged[c.commission_currency] ?? 0) + c.commission;
    }
    groups.push({
      id,
      alyc: first.alyc,
      client: first.client,
      client_external_id: first.client_external_id,
      trade_date: first.trade_date,
      currency: first.currency,
      from: g.from,
      to: g.to,
      sells: g.sells,
      buys: g.buys,
      basis: g.basis ?? 'importe',
      instrument: g.instrument ?? null,
      consecutive: g.consecutive ?? true,
      charged,
      members: list
        .map((c) => ({ ...c, control_status: controlStatus(c), side: tradingSide(c.operation) }))
        .sort((a, b) => compareOpNumber(a.op_number, b.op_number, 1)),
    });
  }
  groups.sort((a, b) => b.trade_date.localeCompare(a.trade_date) || compareOpNumber(a.from, b.from, 1));
  return { groups, rest: scoped.filter((c) => !c.trading_group || !flaggedIds.has(c.trading_group.id)) };
}

export function listSenebiToCharge<T extends ArancelCommission>(rows: readonly T[]): T[] {
  return rows
    .filter(isSenebiToCharge)
    .sort((a, b) => b.trade_date.localeCompare(a.trade_date) || compareOpNumber(a.op_number, b.op_number, -1));
}
