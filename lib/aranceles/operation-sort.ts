import { FEE_STATUS_LABEL, type ArancelCommission } from '@/lib/aranceles/types';

/** Columnas del detalle de operaciones. */
export const OPERATION_SORT_KEYS = [
  'fecha',
  'boleto',
  'cliente',
  'alyc',
  'manager',
  'operacion',
  'instrumento',
  'bruto',
  'arancel',
  'arancel_iva',
  'estado',
] as const;

export type OperationSortKey = (typeof OPERATION_SORT_KEYS)[number];
export type OperationSort = { by: OperationSortKey; dir: 'asc' | 'desc' };

export const DEFAULT_OPERATION_SORT: OperationSort = { by: 'fecha', dir: 'desc' };

/** Primer clic: fechas y montos de mayor a menor; textos y boleto de la A a la Z. */
export const OPERATION_SORT_FIRST_DIR: Record<OperationSortKey, OperationSort['dir']> = {
  fecha: 'desc',
  boleto: 'asc',
  cliente: 'asc',
  alyc: 'asc',
  manager: 'asc',
  operacion: 'asc',
  instrumento: 'asc',
  bruto: 'desc',
  arancel: 'desc',
  arancel_iva: 'desc',
  estado: 'asc',
};

export function toggleOperationSort(prev: OperationSort, by: OperationSortKey): OperationSort {
  if (prev.by === by) return { by, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { by, dir: OPERATION_SORT_FIRST_DIR[by] };
}

export function parseOperationSort(by: string | null, dir: string | null): OperationSort {
  const key = OPERATION_SORT_KEYS.includes(by as OperationSortKey) ? (by as OperationSortKey) : 'fecha';
  const direction = dir === 'asc' || dir === 'desc' ? dir : key === 'fecha' ? 'desc' : OPERATION_SORT_FIRST_DIR[key];
  return { by: key, dir: direction };
}

export type OperationSortable = Pick<
  ArancelCommission,
  'id' | 'trade_date' | 'op_number' | 'client' | 'alyc' | 'operation' | 'instrument' | 'amount' | 'commission' | 'fee_status'
> & {
  commission_con_iva?: number;
  /** Productor / manager, cuando la fila ya está segmentada. */
  manager?: string | null;
  /** Tipo de arancel (etiqueta), desempate de la columna ALYC. */
  tipo?: string | null;
};

const textCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const opNumberCollator = new Intl.Collator('es', { numeric: true });

/** N° de boleto como número ("998" < "1002"). Los que no tienen n° van siempre al final. */
export function compareOpNumber(a: string | null, b: string | null, sign: number): number {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return sign * opNumberCollator.compare(a, b);
}

function compareText(a: string | null | undefined, b: string | null | undefined, sign: number): number {
  const ae = !a?.trim();
  const be = !b?.trim();
  if (ae || be) return Number(ae) - Number(be);
  return sign * textCollator.compare(a!.trim(), b!.trim());
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined, sign: number): number {
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return sign * (a - b);
}

function tieBreak(a: OperationSortable, b: OperationSortable): number {
  return (
    b.trade_date.localeCompare(a.trade_date) ||
    compareOpNumber(a.op_number, b.op_number, 1) ||
    a.id.localeCompare(b.id)
  );
}

export function compareOperations(a: OperationSortable, b: OperationSortable, sort: OperationSort): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  let primary = 0;
  switch (sort.by) {
    case 'fecha':
      primary = sign * a.trade_date.localeCompare(b.trade_date) || compareOpNumber(a.op_number, b.op_number, sign);
      break;
    case 'boleto':
      primary = compareOpNumber(a.op_number, b.op_number, sign) || sign * a.trade_date.localeCompare(b.trade_date);
      break;
    case 'cliente':
      primary = compareText(a.client, b.client, sign);
      break;
    case 'alyc':
      primary = compareText(a.alyc, b.alyc, sign) || compareText(a.tipo, b.tipo, sign);
      break;
    case 'manager':
      primary = compareText(a.manager, b.manager, sign);
      break;
    case 'operacion':
      primary = compareText(a.operation, b.operation, sign);
      break;
    case 'instrumento':
      primary = compareText(a.instrument, b.instrument, sign);
      break;
    case 'bruto':
      primary = compareNullableNumber(a.amount, b.amount, sign);
      break;
    case 'arancel':
      primary = sign * (a.commission - b.commission);
      break;
    case 'arancel_iva':
      primary = sign * ((a.commission_con_iva ?? a.commission) - (b.commission_con_iva ?? b.commission));
      break;
    case 'estado':
      primary = compareText(FEE_STATUS_LABEL[a.fee_status], FEE_STATUS_LABEL[b.fee_status], sign);
      break;
  }
  if (primary !== 0) return primary;
  if (sort.by === 'fecha' || sort.by === 'boleto') return a.id.localeCompare(b.id);
  return tieBreak(a, b);
}

export function sortOperations<T extends OperationSortable>(
  rows: readonly T[],
  sort: OperationSort = DEFAULT_OPERATION_SORT
): T[] {
  return [...rows].sort((a, b) => compareOperations(a, b, sort));
}
