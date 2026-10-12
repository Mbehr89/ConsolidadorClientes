import {
  agreementFor,
  fileProducerOf,
  producerOf,
  type ArancelesSettings,
  type ProducerAgreement,
} from '@/lib/aranceles/settings';
import type { ArancelCommission } from '@/lib/aranceles/types';

function isIeb(c: Pick<ArancelCommission, 'alyc'>): boolean {
  return c.alyc.trim().toUpperCase() === 'IEB';
}

export type ProducerAccount = {
  cuenta: string;
  cliente: string;
  operaciones: number;
  desde: string;
  hasta: string;
};

export type ProducerSummary = {
  numero: string;
  /** Nombres con que aparece en los archivos (columna Productor). */
  nombresEnArchivos: string[];
  codigo: string | null;
  nombre: string | null;
  notas: string | null;
  operaciones: number;
  desde: string | null;
  hasta: string | null;
  /** Arancel bruto por moneda. */
  bruto: Record<string, number>;
  cuentas: ProducerAccount[];
  acuerdoVigente: ProducerAgreement | null;
  /** Configurado pero sin operaciones en el historial. */
  sinDatos: boolean;
};

/** Productores IEB con sus cuentas, según el productor efectivo de cada operación. */
export function summarizeProducers(
  commissions: readonly ArancelCommission[],
  settings: ArancelesSettings,
  today = new Date().toISOString().slice(0, 10)
): ProducerSummary[] {
  type Acc = {
    nombres: Set<string>;
    operaciones: number;
    desde: string | null;
    hasta: string | null;
    bruto: Record<string, number>;
    cuentas: Map<string, ProducerAccount>;
  };
  const map = new Map<string, Acc>();
  for (const c of commissions) {
    if (!isIeb(c)) continue;
    const numero = producerOf(c, settings);
    if (!numero) continue;
    const a =
      map.get(numero) ??
      ({
        nombres: new Set<string>(),
        operaciones: 0,
        desde: null,
        hasta: null,
        bruto: {} as Record<string, number>,
        cuentas: new Map<string, ProducerAccount>(),
      } as Acc);
    if (c.details?.productor && fileProducerOf(c) === numero) a.nombres.add(c.details.productor);
    a.operaciones += 1;
    if (!a.desde || c.trade_date < a.desde) a.desde = c.trade_date;
    if (!a.hasta || c.trade_date > a.hasta) a.hasta = c.trade_date;
    const cur = c.commission_currency || c.currency;
    a.bruto[cur] = (a.bruto[cur] ?? 0) + c.commission;
    const cuenta = c.client_external_id ?? '—';
    const acc = a.cuentas.get(cuenta) ?? { cuenta, cliente: c.client, operaciones: 0, desde: c.trade_date, hasta: c.trade_date };
    acc.operaciones += 1;
    if (c.trade_date < acc.desde) acc.desde = c.trade_date;
    if (c.trade_date > acc.hasta) acc.hasta = c.trade_date;
    a.cuentas.set(cuenta, acc);
    map.set(numero, a);
  }

  const numeros = new Set([...map.keys(), ...settings.producers.map((p) => p.numero)]);
  return [...numeros]
    .map((numero) => {
      const a = map.get(numero);
      const info = settings.producers.find((p) => p.numero === numero);
      return {
        numero,
        nombresEnArchivos: a ? [...a.nombres].sort((x, y) => x.localeCompare(y, 'es')) : [],
        codigo: info?.codigo ?? null,
        nombre: info?.nombre ?? null,
        notas: info?.notas ?? null,
        operaciones: a?.operaciones ?? 0,
        desde: a?.desde ?? null,
        hasta: a?.hasta ?? null,
        bruto: a?.bruto ?? {},
        cuentas: a ? [...a.cuentas.values()].sort((x, y) => x.cliente.localeCompare(y.cliente, 'es')) : [],
        acuerdoVigente: agreementFor(settings, numero, today),
        sinDatos: !a,
      };
    })
    .sort((x, y) => y.operaciones - x.operaciones || x.numero.localeCompare(y.numero, 'es', { numeric: true }));
}

export type AccountProducerChange = {
  cuenta: string;
  cliente: string;
  desdeProductor: string | null;
  haciaProductor: string;
  /** Primera operación con el productor nuevo. */
  fecha: string;
  origen: 'archivo' | 'registrado';
  notas: string | null;
};

/**
 * Cambios de productor por cuenta: los que se ven en los archivos (la misma cuenta aparece con otro
 * numeroProductor) y los registrados a mano en Configuración.
 */
export function detectAccountChanges(
  commissions: readonly ArancelCommission[],
  settings: ArancelesSettings
): AccountProducerChange[] {
  const byAccount = new Map<string, ArancelCommission[]>();
  for (const c of commissions) {
    if (!isIeb(c) || !c.client_external_id || !fileProducerOf(c)) continue;
    byAccount.set(c.client_external_id, [...(byAccount.get(c.client_external_id) ?? []), c]);
  }
  const out: AccountProducerChange[] = [];
  for (const [cuenta, rows] of byAccount) {
    const sorted = [...rows].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    let prev: string | null = null;
    for (const c of sorted) {
      const p = fileProducerOf(c)!;
      if (prev && p !== prev) {
        out.push({ cuenta, cliente: c.client, desdeProductor: prev, haciaProductor: p, fecha: c.trade_date, origen: 'archivo', notas: null });
      }
      prev = p;
    }
  }
  for (const t of settings.account_transfers) {
    const rows = byAccount.get(t.cuenta) ?? [];
    const before = rows
      .filter((c) => c.trade_date < t.valid_from)
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date))[0];
    out.push({
      cuenta: t.cuenta,
      cliente: rows[0]?.client ?? '—',
      desdeProductor: before ? fileProducerOf(before) : null,
      haciaProductor: t.productor_numero,
      fecha: t.valid_from,
      origen: 'registrado',
      notas: t.notas,
    });
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Cuentas IEB con operaciones pero sin productor en el archivo. */
export function accountsWithoutProducer(commissions: readonly ArancelCommission[], settings: ArancelesSettings): number {
  const set = new Set<string>();
  for (const c of commissions) {
    if (isIeb(c) && c.client_external_id && !producerOf(c, settings)) set.add(c.client_external_id);
  }
  return set.size;
}
