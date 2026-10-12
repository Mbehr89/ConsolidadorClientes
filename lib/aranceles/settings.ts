import type { ArancelCommission } from '@/lib/aranceles/types';

/** Tipos de arancel que se liquidan (columnas de la planilla "calculadora aranceles IEB"). */
export type NetBucket = 'privado' | 'publico' | 'licitacion' | 'diferencia' | 'fci_terceros' | 'fci_ieb';

export const NET_BUCKETS: readonly NetBucket[] = [
  'privado',
  'publico',
  'licitacion',
  'diferencia',
  'fci_terceros',
  'fci_ieb',
];

export const NET_BUCKET_LABEL: Record<NetBucket, string> = {
  privado: 'Títulos privados',
  publico: 'Títulos públicos',
  licitacion: 'Licitaciones',
  diferencia: 'Dif. precios (SENEBI)',
  fci_terceros: 'Fondos de terceros',
  fci_ieb: 'FCI IEB',
};

export type BucketRule = {
  /** Distribución: parte de la comisión neta que se paga. */
  share: number;
  /** Divisor de IVA en la hoja pesos (1 = sin IVA, 1.21 = se descuenta IVA). */
  iva_pesos: number;
  /** Divisor de IVA en la hoja dólares (USD y USD exterior). */
  iva_dolares: number;
};

/** Alícuotas vigentes desde `valid_from` (hasta la versión siguiente). */
export type NetRuleVersion = {
  id: string;
  valid_from: string;
  /** IEB: IIBB sobre el bruto. */
  iibb_rate: number;
  /** IEB: distribución e IVA por tipo de arancel. */
  buckets: Record<NetBucket, BucketRule>;
  /** GMA: se paga este porcentaje directo sobre el bruto (sin IIBB ni IVA). */
  gma_share: number;
  notes: string | null;
  created_at: string;
};

export type ProducerInfo = {
  /** numeroProductor de los archivos IEB. */
  numero: string;
  /** Código corto (AP), p. ej. "MB". */
  codigo: string | null;
  nombre: string | null;
  notas: string | null;
};

/** Distribución distinta a la estándar para un productor en un rango de fechas. */
export type ProducerAgreement = {
  id: string;
  productor_numero: string;
  valid_from: string;
  valid_to: string | null;
  /** Sólo los tipos con arreglo; el resto usa la alícuota estándar. */
  shares: Partial<Record<NetBucket, number>>;
  notas: string | null;
  created_at: string;
};

/** Una cuenta pasa a otro productor desde una fecha (pisa lo que diga el archivo). */
export type AccountTransfer = {
  id: string;
  cuenta: string;
  productor_numero: string;
  valid_from: string;
  notas: string | null;
  created_at: string;
};

/** Nombre con que se muestra a una persona (productor, manager, advisor, oficial) en todas las ALYC. */
export type PersonAlias = {
  alias: string;
  /** Cómo puede venir escrito en los archivos o el mapping ("Milagros Behr", "Behr, Milagros"). */
  nombres: string[];
};

export type ArancelesSettings = {
  net_rules: NetRuleVersion[];
  producers: ProducerInfo[];
  agreements: ProducerAgreement[];
  account_transfers: AccountTransfer[];
  person_aliases: PersonAlias[];
};

/** Los nombres cortos que ya usa GMA. */
export const DEFAULT_PERSON_ALIASES: PersonAlias[] = [
  { alias: 'MILI', nombres: ['Milagros Behr'] },
  { alias: 'MARTIN', nombres: ['Martin Behr'] },
  { alias: 'CLAUDIO', nombres: ['Claudio Behr'] },
];

export const DEFAULT_NET_RULES: NetRuleVersion = {
  id: 'planilla-ieb',
  valid_from: '2000-01-01',
  iibb_rate: 0.055,
  buckets: {
    privado: { share: 0.65, iva_pesos: 1, iva_dolares: 1 },
    publico: { share: 0.65, iva_pesos: 1, iva_dolares: 1 },
    licitacion: { share: 0.65, iva_pesos: 1, iva_dolares: 1 },
    diferencia: { share: 0.65, iva_pesos: 1.21, iva_dolares: 1 },
    fci_terceros: { share: 0.65, iva_pesos: 1.21, iva_dolares: 1.21 },
    fci_ieb: { share: 0.7, iva_pesos: 1, iva_dolares: 1 },
  },
  gma_share: 0.6,
  notes: 'IEB: planilla "calculadora aranceles IEB" (licitaciones con las reglas de títulos públicos). GMA: 60% del bruto.',
  created_at: '2026-10-12T00:00:00.000Z',
};

export function defaultSettings(): ArancelesSettings {
  return {
    net_rules: [DEFAULT_NET_RULES],
    producers: [],
    agreements: [],
    account_transfers: [],
    person_aliases: DEFAULT_PERSON_ALIASES,
  };
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Completa lo que falte (p. ej. un tipo nuevo) con los valores de la planilla. */
export function coerceSettings(raw: unknown): ArancelesSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ArancelesSettings>;
  const rules = arr<NetRuleVersion>(r.net_rules).map((v) => ({
    ...v,
    gma_share: typeof v.gma_share === 'number' ? v.gma_share : DEFAULT_NET_RULES.gma_share,
    buckets: Object.fromEntries(
      NET_BUCKETS.map((b) => [b, { ...DEFAULT_NET_RULES.buckets[b], ...(v.buckets?.[b] ?? {}) }])
    ) as Record<NetBucket, BucketRule>,
  }));
  return {
    net_rules: rules.length ? sortRules(rules) : [DEFAULT_NET_RULES],
    producers: arr(r.producers),
    agreements: arr(r.agreements),
    account_transfers: arr(r.account_transfers),
    person_aliases: Array.isArray(r.person_aliases)
      ? arr<PersonAlias>(r.person_aliases).map((a) => ({ alias: a.alias, nombres: arr<string>(a.nombres) }))
      : DEFAULT_PERSON_ALIASES,
  };
}

/** "Behr, Milagros", "MILAGROS  BEHR", "Milagros Behr" → "behr milagros". */
export function personKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Nombre homogéneo de una persona: el alias configurado, o el nombre tal cual si no tiene alias. */
export function personAlias(name: string | null | undefined, settings: Pick<ArancelesSettings, 'person_aliases'>): string | null {
  const s = name?.trim();
  if (!s) return null;
  const k = personKey(s);
  for (const a of settings.person_aliases) {
    if (personKey(a.alias) === k || a.nombres.some((n) => personKey(n) === k)) return a.alias;
  }
  return s;
}

function sortRules(rules: NetRuleVersion[]): NetRuleVersion[] {
  return [...rules].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

/** Versión de alícuotas vigente en `date` (la primera si la fecha es anterior a todas). */
export function ruleFor(settings: ArancelesSettings, date: string): NetRuleVersion {
  const rules = sortRules(settings.net_rules);
  let current = rules[0] ?? DEFAULT_NET_RULES;
  for (const r of rules) if (r.valid_from <= date) current = r;
  return current;
}

export function currentRule(settings: ArancelesSettings): NetRuleVersion {
  return ruleFor(settings, new Date().toISOString().slice(0, 10));
}

function inRange(date: string, from: string, to: string | null): boolean {
  return from <= date && (!to || date <= to);
}

type ProducerSource = Pick<ArancelCommission, 'alyc' | 'client_external_id' | 'trade_date' | 'details'>;

/** Productor según el archivo (columna numeroProductor). */
export function fileProducerOf(c: ProducerSource): string | null {
  return c.details?.productor_numero?.trim() || null;
}

/** Productor efectivo: un cambio de cuenta registrado pisa lo que diga el archivo. */
export function producerOf(c: ProducerSource, settings: ArancelesSettings): string | null {
  if (c.alyc.trim().toUpperCase() === 'IEB' && c.client_external_id) {
    let transfer: AccountTransfer | null = null;
    for (const t of settings.account_transfers) {
      if (t.cuenta !== c.client_external_id || t.valid_from > c.trade_date) continue;
      if (!transfer || t.valid_from >= transfer.valid_from) transfer = t;
    }
    if (transfer) return transfer.productor_numero;
  }
  return fileProducerOf(c);
}

export function agreementFor(
  settings: ArancelesSettings,
  productor: string | null,
  date: string
): ProducerAgreement | null {
  if (!productor) return null;
  let found: ProducerAgreement | null = null;
  for (const a of settings.agreements) {
    if (a.productor_numero !== productor || !inRange(date, a.valid_from, a.valid_to)) continue;
    if (!found || a.valid_from >= found.valid_from) found = a;
  }
  return found;
}

/** Cómo se muestra un productor IEB: código AP, o su nombre homogeneizado (igual que en GMA), o el número. */
export function producerLabel(numero: string, settings: ArancelesSettings, fallbackName?: string | null): string {
  const p = settings.producers.find((x) => x.numero === numero);
  return p?.codigo || personAlias(p?.nombre || fallbackName, settings) || numero;
}

export function newSettingsId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
