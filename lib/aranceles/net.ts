import { alycKey } from '@/lib/aranceles/dedup';
import { feeTypeOf } from '@/lib/aranceles/fee-types';
import { periodKey, sortCurrencies, type PeriodGranularity } from '@/lib/aranceles/reports';
import {
  DEFAULT_NET_RULES,
  NET_BUCKETS,
  NET_BUCKET_LABEL,
  agreementFor,
  currentRule,
  defaultSettings,
  producerLabel,
  producerOf,
  ruleFor,
  type ArancelesSettings,
  type NetBucket,
  type NetRuleVersion,
} from '@/lib/aranceles/settings';
import type { ArancelCommission } from '@/lib/aranceles/types';

export { NET_BUCKETS, NET_BUCKET_LABEL, type NetBucket };

/**
 * Liquidación neta de aranceles, operación por operación, con la versión de alícuotas vigente a su fecha.
 *
 * IEB (planilla "calculadora aranceles IEB"):
 *   bruto ajustado = bruto + notas (las notas traen signo: + débito al cliente, − crédito)
 *   IIBB           = bruto ajustado × alícuota IIBB
 *   comisión neta  = bruto ajustado − IIBB
 *   a pagar        = comisión neta × distribución ÷ IVA
 *   Un arreglo comercial del productor pisa la distribución.
 *
 * GMA: a pagar = bruto × porcentaje GMA.
 */

export type NetAlyc = 'IEB' | 'GMA';
export const NET_ALYCS: readonly NetAlyc[] = ['IEB', 'GMA'];

/** IEB usa los tipos de la planilla; GMA, públicos / privados / SENEBI y además cauciones. */
export type NetLineKey = NetBucket | 'caucion';
export const NET_LINE_LABEL: Record<NetLineKey, string> = { ...NET_BUCKET_LABEL, caucion: 'Cauciones' };

export function netAlycOf(alyc: string): NetAlyc | null {
  const k = alycKey(alyc);
  return k === 'ieb' ? 'IEB' : k === 'gma' ? 'GMA' : null;
}

/** Hoja de la planilla IEB: pesos para ARS, dólares para cualquier otra moneda (USD, USD exterior). */
export type NetSheet = 'pesos' | 'dolares';

export function netSheet(currency: string): NetSheet {
  return currency === 'ARS' ? 'pesos' : 'dolares';
}

export function ivaDivisor(bucket: NetBucket, currency: string, rule: NetRuleVersion = DEFAULT_NET_RULES): number {
  const b = rule.buckets[bucket];
  return netSheet(currency) === 'pesos' ? b.iva_pesos : b.iva_dolares;
}

export type NetExclusion = 'nota_sin_especie' | 'fci_sin_clasificar' | 'otro';

export const NET_EXCLUSION_LABEL: Record<NetExclusion, string> = {
  nota_sin_especie: 'Notas sin especie PUBLICO / PRIVADO',
  fci_sin_clasificar: 'ACDI sin tipo de fondo reconocible',
  otro: 'Otros sin regla de liquidación',
};

export type NetPlacement =
  | { bucket: NetLineKey; kind: 'bruto' | 'nota' }
  | { bucket: null; excluded: NetExclusion }
  | null;

function up(v: string | null | undefined): string {
  return (v ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

type Placeable = Pick<ArancelCommission, 'alyc' | 'segment' | 'operation' | 'instrument' | 'commission'>;

/** Dónde entra cada operación en la liquidación; `null` si la ALYC no tiene regla de neto. */
export function netPlacement(c: Placeable): NetPlacement {
  const alyc = netAlycOf(c.alyc);
  if (alyc === 'GMA') {
    const type = feeTypeOf(c);
    const bucket: NetLineKey =
      type === 'publico' || type === 'diferencia' || type === 'caucion' ? type : 'privado';
    return { bucket, kind: 'bruto' };
  }
  if (alyc !== 'IEB') return null;
  switch (feeTypeOf(c)) {
    case 'publico':
      return { bucket: 'publico', kind: 'bruto' };
    case 'privado':
      return { bucket: 'privado', kind: 'bruto' };
    case 'licitacion':
      return { bucket: 'licitacion', kind: 'bruto' };
    case 'diferencia':
      return { bucket: 'diferencia', kind: 'bruto' };
    case 'acdi': {
      const tipo = up(c.operation);
      if (tipo.includes('TERCERO')) return { bucket: 'fci_terceros', kind: 'bruto' };
      if (tipo.includes('IEB')) return { bucket: 'fci_ieb', kind: 'bruto' };
      return { bucket: null, excluded: 'fci_sin_clasificar' };
    }
    case 'nota_debito':
    case 'nota_credito': {
      const especie = up(c.instrument);
      if (especie === 'PUBLICO') return { bucket: 'publico', kind: 'nota' };
      if (especie === 'PRIVADO') return { bucket: 'privado', kind: 'nota' };
      return { bucket: null, excluded: 'nota_sin_especie' };
    }
    default:
      return { bucket: null, excluded: 'otro' };
  }
}

export type NetLine = {
  key: string;
  alyc: NetAlyc;
  /** IEB: productor; GMA: manager. null si no está asignado. */
  persona: string | null;
  bucket: NetLineKey;
  label: string;
  bruto: number;
  notas: number;
  brutoAjustado: number;
  iibb: number;
  neto: number;
  /** null si en el período conviven alícuotas distintas (cambio de versión o arreglo comercial). */
  share: number | null;
  ivaDivisor: number | null;
  iibbRate: number | null;
  aPagar: number;
  rows: number;
  /** Operaciones liquidadas con un arreglo comercial. */
  withAgreement: number;
};

export type NetTotals = {
  bruto: number;
  notas: number;
  brutoAjustado: number;
  iibb: number;
  neto: number;
  aPagar: number;
  /** a pagar ÷ bruto ajustado ("Alic. Neta" de la planilla). */
  alicuota: number | null;
};

type Excluded = { reason: NetExclusion; label: string; amount: number; rows: number }[];

export type NetBlock = {
  period: string;
  currency: string;
  /** Hoja de la planilla IEB que aplica a las líneas de IEB. */
  sheet: NetSheet;
  /** Una línea por broker × productor/manager × tipo de arancel. */
  lines: NetLine[];
  byAlyc: { alyc: NetAlyc; totals: NetTotals }[];
  totals: NetTotals;
  excluded: Excluded;
};

export type NetReport = {
  blocks: NetBlock[];
  /** Totales de todo el rango por ALYC y moneda. */
  totals: { alyc: NetAlyc; currency: string; sheet: NetSheet | null; totals: NetTotals; excluded: Excluded }[];
  /** Totales de todo el rango por moneda, sumando las ALYC. */
  byCurrency: { currency: string; bruto: number; aPagar: number }[];
  /** Operaciones de ALYC sin regla de neto. */
  otherAlycRows: number;
  currentRules: NetRuleVersion;
  ruleVersionsUsed: number;
  agreementRows: number;
};

/** Cálculo de una línea IEB con una sola alícuota (útil para verificar contra la planilla). */
export function computeNetLine(
  bucket: NetBucket,
  currency: string,
  bruto: number,
  notas: number,
  rows = 0,
  rule: NetRuleVersion = DEFAULT_NET_RULES
): NetLine {
  const brutoAjustado = bruto + notas;
  const iibb = brutoAjustado * rule.iibb_rate;
  const neto = brutoAjustado - iibb;
  const share = rule.buckets[bucket].share;
  const div = ivaDivisor(bucket, currency, rule);
  return {
    key: bucket,
    alyc: 'IEB',
    persona: null,
    bucket,
    label: NET_BUCKET_LABEL[bucket],
    bruto,
    notas,
    brutoAjustado,
    iibb,
    neto,
    share,
    ivaDivisor: div,
    iibbRate: rule.iibb_rate,
    aPagar: (neto * share) / div,
    rows,
    withAgreement: 0,
  };
}

export type NetRowCalc = {
  alyc: NetAlyc;
  bucket: NetLineKey;
  kind: 'bruto' | 'nota';
  amount: number;
  iibb: number;
  neto: number;
  aPagar: number;
  share: number;
  iva: number;
  iibbRate: number;
  agreement: boolean;
  ruleId: string;
};

export type NetRowResult = NetRowCalc | { excluded: NetExclusion } | null;

/** Neto de una operación: a pagar con la regla vigente a su fecha; `null` si su ALYC no tiene regla. */
export function netRow(c: ArancelCommission, settings: ArancelesSettings): NetRowResult {
  const placement = netPlacement(c);
  if (!placement) return null;
  if (placement.bucket == null) return { excluded: placement.excluded };
  const rule = ruleFor(settings, c.trade_date);
  const amount = c.commission;
  if (netAlycOf(c.alyc) === 'GMA') {
    return {
      alyc: 'GMA',
      ...placement,
      amount,
      iibb: 0,
      neto: amount,
      aPagar: amount * rule.gma_share,
      share: rule.gma_share,
      iva: 1,
      iibbRate: 0,
      agreement: false,
      ruleId: rule.id,
    };
  }
  const bucket = placement.bucket;
  if (bucket === 'caucion') return { excluded: 'otro' };
  const currency = c.commission_currency || c.currency;
  const agreement = agreementFor(settings, producerOf(c, settings), c.trade_date);
  const share = agreement?.shares[bucket] ?? rule.buckets[bucket].share;
  const iva = ivaDivisor(bucket, currency, rule);
  const iibb = amount * rule.iibb_rate;
  const neto = amount - iibb;
  return {
    alyc: 'IEB',
    ...placement,
    amount,
    iibb,
    neto,
    aPagar: (neto * share) / iva,
    share,
    iva,
    iibbRate: rule.iibb_rate,
    agreement: agreement?.shares[bucket] != null,
    ruleId: rule.id,
  };
}

/** A pagar de una operación, o `null` si no tiene regla de neto. */
export function netAmountOf(c: ArancelCommission, settings: ArancelesSettings): number | null {
  const r = netRow(c, settings);
  return r && 'aPagar' in r ? r.aPagar : null;
}

type LineAcc = {
  alyc: NetAlyc;
  persona: string | null;
  bucket: NetLineKey;
  bruto: number;
  notas: number;
  iibb: number;
  neto: number;
  aPagar: number;
  rows: number;
  withAgreement: number;
  shares: Set<number>;
  ivas: Set<number>;
  iibbRates: Set<number>;
};

type Acc = {
  lines: Map<string, LineAcc>;
  excluded: Map<NetExclusion, { amount: number; rows: number }>;
};

function emptyAcc(): Acc {
  return { lines: new Map(), excluded: new Map() };
}

function accumulate(acc: Acc, r: NetRowCalc, persona: string | null) {
  const key = `${r.alyc}|${persona ?? ''}|${r.bucket}`;
  const l: LineAcc = acc.lines.get(key) ?? {
    alyc: r.alyc,
    persona,
    bucket: r.bucket,
    bruto: 0,
    notas: 0,
    iibb: 0,
    neto: 0,
    aPagar: 0,
    rows: 0,
    withAgreement: 0,
    shares: new Set<number>(),
    ivas: new Set<number>(),
    iibbRates: new Set<number>(),
  };
  if (r.kind === 'nota') l.notas += r.amount;
  else l.bruto += r.amount;
  l.iibb += r.iibb;
  l.neto += r.neto;
  l.aPagar += r.aPagar;
  l.rows += 1;
  if (r.agreement) l.withAgreement += 1;
  l.shares.add(r.share);
  l.ivas.add(r.iva);
  l.iibbRates.add(r.iibbRate);
  acc.lines.set(key, l);
}

function exclude(acc: Acc, reason: NetExclusion, amount: number) {
  const e = acc.excluded.get(reason) ?? { amount: 0, rows: 0 };
  e.amount += amount;
  e.rows += 1;
  acc.excluded.set(reason, e);
}

function single(s: Set<number>): number | null {
  return s.size === 1 ? [...s][0]! : null;
}

const LINE_ORDER = new Map<NetLineKey, number>([...NET_BUCKETS, 'caucion' as const].map((b, i) => [b, i]));
const ALYC_ORDER = new Map(NET_ALYCS.map((a, i) => [a, i]));

function compareLines(a: LineAcc, b: LineAcc): number {
  return (
    (ALYC_ORDER.get(a.alyc) ?? 0) - (ALYC_ORDER.get(b.alyc) ?? 0) ||
    (a.persona == null ? 1 : 0) - (b.persona == null ? 1 : 0) ||
    (a.persona ?? '').localeCompare(b.persona ?? '', 'es', { numeric: true }) ||
    (LINE_ORDER.get(a.bucket) ?? 0) - (LINE_ORDER.get(b.bucket) ?? 0)
  );
}

export function sumNetLines(lines: readonly NetLine[]): NetTotals {
  const sum = (f: (l: NetLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const brutoAjustado = sum((l) => l.brutoAjustado);
  const aPagar = sum((l) => l.aPagar);
  return {
    bruto: sum((l) => l.bruto),
    notas: sum((l) => l.notas),
    brutoAjustado,
    iibb: sum((l) => l.iibb),
    neto: sum((l) => l.neto),
    aPagar,
    alicuota: brutoAjustado !== 0 ? aPagar / brutoAjustado : null,
  };
}

function finish(acc: Acc) {
  const lines: NetLine[] = [...acc.lines.values()].sort(compareLines).map((l) => ({
    key: `${l.alyc}|${l.persona ?? ''}|${l.bucket}`,
    alyc: l.alyc,
    persona: l.persona,
    bucket: l.bucket,
    label: NET_LINE_LABEL[l.bucket],
    bruto: l.bruto,
    notas: l.notas,
    brutoAjustado: l.bruto + l.notas,
    iibb: l.iibb,
    neto: l.neto,
    share: single(l.shares),
    ivaDivisor: single(l.ivas),
    iibbRate: single(l.iibbRates),
    aPagar: l.aPagar,
    rows: l.rows,
    withAgreement: l.withAgreement,
  }));
  const byAlyc = NET_ALYCS.filter((a) => lines.some((l) => l.alyc === a)).map((alyc) => ({
    alyc,
    totals: sumNetLines(lines.filter((l) => l.alyc === alyc)),
  }));
  const excluded = [...acc.excluded.entries()].map(([reason, e]) => ({
    reason,
    label: NET_EXCLUSION_LABEL[reason],
    amount: e.amount,
    rows: e.rows,
  }));
  return { lines, byAlyc, totals: sumNetLines(lines), excluded };
}

export type NetReportOptions = {
  /** Productor (IEB) o manager (GMA) de cada operación. Por defecto: productor IEB de la configuración. */
  personaOf?: (c: ArancelCommission, alyc: NetAlyc) => string | null;
};

export function buildNetReport(
  commissions: readonly ArancelCommission[],
  g: PeriodGranularity,
  settings: ArancelesSettings = defaultSettings(),
  opts: NetReportOptions = {}
): NetReport {
  const personaOf =
    opts.personaOf ??
    ((c: ArancelCommission, alyc: NetAlyc) => {
      if (alyc !== 'IEB') return null;
      const n = producerOf(c, settings);
      return n ? producerLabel(n, settings, c.details?.productor) : null;
    });
  const byBlock = new Map<string, { period: string; currency: string; acc: Acc }>();
  const byTotal = new Map<string, { alyc: NetAlyc; currency: string; acc: Acc }>();
  const versions = new Set<string>();
  let otherAlycRows = 0;
  let agreementRows = 0;

  for (const c of commissions) {
    const r = netRow(c, settings);
    const alyc = netAlycOf(c.alyc);
    if (!r || !alyc) {
      otherAlycRows += 1;
      continue;
    }
    const currency = c.commission_currency || c.currency;
    const period = periodKey(c.trade_date, g);
    const bk = `${period}|${currency}`;
    const block = byBlock.get(bk) ?? { period, currency, acc: emptyAcc() };
    byBlock.set(bk, block);
    const tk = `${alyc}|${currency}`;
    const total = byTotal.get(tk) ?? { alyc, currency, acc: emptyAcc() };
    byTotal.set(tk, total);

    if ('excluded' in r) {
      exclude(block.acc, r.excluded, c.commission);
      exclude(total.acc, r.excluded, c.commission);
      continue;
    }
    versions.add(r.ruleId);
    if (r.agreement) agreementRows += 1;
    const persona = personaOf(c, alyc);
    accumulate(block.acc, r, persona);
    accumulate(total.acc, r, persona);
  }

  const currencies = sortCurrencies(new Set([...byTotal.values()].map((t) => t.currency)));
  const currencyOrder = new Map(currencies.map((c, i) => [c, i]));
  const byCurrencyOrder = (a: string, b: string) => (currencyOrder.get(a) ?? 0) - (currencyOrder.get(b) ?? 0);

  const blocks: NetBlock[] = [...byBlock.values()]
    .sort((a, b) => b.period.localeCompare(a.period) || byCurrencyOrder(a.currency, b.currency))
    .map((b) => ({ period: b.period, currency: b.currency, sheet: netSheet(b.currency), ...finish(b.acc) }));

  const totals = [...byTotal.values()]
    .sort((a, b) => (ALYC_ORDER.get(a.alyc) ?? 0) - (ALYC_ORDER.get(b.alyc) ?? 0) || byCurrencyOrder(a.currency, b.currency))
    .map((t) => {
      const f = finish(t.acc);
      return {
        alyc: t.alyc,
        currency: t.currency,
        sheet: t.alyc === 'IEB' ? netSheet(t.currency) : null,
        totals: f.totals,
        excluded: f.excluded,
      };
    });

  const byCurrency = currencies.map((currency) => {
    const ts = totals.filter((t) => t.currency === currency);
    return {
      currency,
      bruto: ts.reduce((s, t) => s + t.totals.brutoAjustado, 0),
      aPagar: ts.reduce((s, t) => s + t.totals.aPagar, 0),
    };
  });

  return {
    blocks,
    totals,
    byCurrency,
    otherAlycRows,
    currentRules: currentRule(settings),
    ruleVersionsUsed: versions.size,
    agreementRows,
  };
}

