import type { ArancelCommission } from '@/lib/aranceles/types';

/**
 * Identidad de cada operación en el historial.
 *
 * - Con número (boleto GMA / ID IEB): la clave es ALYC + familia de planilla + número normalizado.
 *   Ese número es único por ALYC; si vuelve a llegar con los mismos datos es un duplicado y si llega
 *   con datos distintos es un conflicto (no se pisa ni se duplica: se informa).
 * - Sin número: se compara el contenido completo y se cuentan ocurrencias (dos filas idénticas en una
 *   planilla pueden ser legítimas; al reimportar se descuentan las que ya están).
 */

type Identifiable = Pick<
  ArancelCommission,
  | 'alyc'
  | 'segment'
  | 'op_number'
  | 'client_key'
  | 'client_external_id'
  | 'trade_date'
  | 'operation'
  | 'instrument'
  | 'quantity'
  | 'amount'
  | 'commission'
  | 'currency'
>;

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Nombres viejos de una ALYC → nombre actual. */
const ALYC_RENAMES: Record<string, string> = { esco: 'GMA' };

/** "GMA", "Gma ", "G.M.A." → "gma" (y los nombres viejos, p. ej. "ESCO", a la clave del actual). */
export function alycKey(alyc: string): string {
  const k = fold(alyc) || 'sinalyc';
  const renamed = ALYC_RENAMES[k];
  return renamed ? fold(renamed) : k;
}

/** Nombre actual de la ALYC si se guardó con un nombre viejo ("ESCO" → "GMA"). */
export function currentAlycName(alyc: string): string {
  return ALYC_RENAMES[fold(alyc)] ?? alyc;
}

/** El dólar cable de GMA ("USD_C") y el dólar exterior de IEB son la misma moneda: USD (EXT). */
const CURRENCY_RENAMES: Record<string, string> = { USD_C: 'USD_EXT' };

export function currentCurrency(currency: string): string {
  return CURRENCY_RENAMES[currency] ?? currency;
}

/** "76170", 76170, "76170.0", "076170", "76.170" → "76170". */
export function normalizeOpNumber(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+[.,]0+$/.test(s)) s = s.replace(/[.,]0+$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  if (/^\d+$/.test(s)) return s.replace(/^0+(?=\d)/, '');
  return s.toUpperCase();
}

/**
 * Los IDs de IEB son de tablas distintas según la planilla (aranceles vs ACDI, etc.); público y privado
 * salen de la misma tabla de aranceles, así que comparten espacio de IDs.
 */
export function idScope(segment: string | null | undefined): string {
  if (!segment) return '';
  if (segment.startsWith('aranceles')) return 'aranceles';
  return segment;
}

export function operationKey(c: Pick<Identifiable, 'alyc' | 'segment' | 'op_number'>): string | null {
  const op = normalizeOpNumber(c.op_number);
  if (!op) return null;
  return `${alycKey(c.alyc)}|${idScope(c.segment)}|${op}`;
}

const text = (v: string | null | undefined) => (v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const money = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : v.toFixed(2));
const qty = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '' : String(Math.round(v * 10_000) / 10_000);

function clientId(c: Pick<Identifiable, 'client_external_id' | 'client_key'>): string {
  const ext = normalizeOpNumber(c.client_external_id);
  return ext ? `#${ext}` : c.client_key;
}

const FINGERPRINT_FIELDS: { label: string; value: (c: Identifiable) => string }[] = [
  { label: 'cliente/cuenta', value: clientId },
  { label: 'fecha', value: (c) => c.trade_date },
  { label: 'operación', value: (c) => text(c.operation) },
  { label: 'instrumento', value: (c) => text(c.instrument) },
  { label: 'cantidad', value: (c) => qty(c.quantity) },
  { label: 'bruto', value: (c) => money(c.amount) },
  { label: 'arancel', value: (c) => money(c.commission) },
  { label: 'moneda', value: (c) => text(c.currency) },
];

/** Contenido de la operación tal como vino del archivo (no incluye datos que recalcula el análisis). */
export function contentFingerprint(c: Identifiable): string {
  return FINGERPRINT_FIELDS.map((f) => f.value(c)).join('|');
}

export function fingerprintDifferences(a: Identifiable, b: Identifiable): string[] {
  return FINGERPRINT_FIELDS.filter((f) => f.value(a) !== f.value(b)).map((f) => f.label);
}

/** Clave para filas sin número de operación. */
export function contentKey(c: Identifiable): string {
  return `${alycKey(c.alyc)}|${idScope(c.segment)}|${contentFingerprint(c)}`;
}

export type DedupConflict = {
  op_number: string;
  client: string;
  trade_date: string;
  /** Campos que difieren entre lo que ya estaba y lo que llegó. */
  differences: string[];
  existing_commission: number;
  incoming_commission: number;
  existing_import_id: string;
};

export type DuplicateGroup = { key: string; op_number: string | null; ids: string[] };

/**
 * Operaciones repetidas en el historial: misma ALYC + número + contenido. Debe dar siempre vacío;
 * se verifica antes de cada guardado.
 */
export function findDuplicateGroups(commissions: readonly ArancelCommission[]): DuplicateGroup[] {
  const map = new Map<string, DuplicateGroup>();
  for (const c of commissions) {
    const op = operationKey(c);
    if (!op) continue;
    const key = `${op}|${contentFingerprint(c)}`;
    const g = map.get(key) ?? { key, op_number: c.op_number, ids: [] };
    g.ids.push(c.id);
    map.set(key, g);
  }
  return [...map.values()].filter((g) => g.ids.length > 1);
}

/** Un mismo n° de operación usado por operaciones con datos distintos (no debería pasar nunca). */
export function findSharedIdGroups(commissions: readonly ArancelCommission[]): DuplicateGroup[] {
  const map = new Map<string, { group: DuplicateGroup; fps: Set<string> }>();
  for (const c of commissions) {
    const op = operationKey(c);
    if (!op) continue;
    const e = map.get(op) ?? { group: { key: op, op_number: c.op_number, ids: [] }, fps: new Set<string>() };
    e.group.ids.push(c.id);
    e.fps.add(contentFingerprint(c));
    map.set(op, e);
  }
  return [...map.values()].filter((e) => e.fps.size > 1).map((e) => e.group);
}

export type IntegrityReport = {
  operations: number;
  withId: number;
  withoutId: number;
  duplicateGroups: DuplicateGroup[];
  sharedIdGroups: DuplicateGroup[];
};

export function integrityReport(commissions: readonly ArancelCommission[]): IntegrityReport {
  const withId = commissions.filter((c) => operationKey(c) != null).length;
  return {
    operations: commissions.length,
    withId,
    withoutId: commissions.length - withId,
    duplicateGroups: findDuplicateGroups(commissions),
    sharedIdGroups: findSharedIdGroups(commissions),
  };
}
