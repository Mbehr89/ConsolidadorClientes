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
  /** Si este tipo descuenta la alícuota de IIBB de la ALYC. Ausente = sí, para no cambiar liquidaciones ya guardadas. */
  aplica_iibb?: boolean;
  /**
   * Sólo GMA. El archivo trae el arancel sin IVA. Si es true, la columna «con IVA» multiplica por 1,21.
   * No cambia el importe leído ni el neto a pagar.
   */
  lleva_iva?: boolean;
};

/** `false` sólo cuando el tipo está marcado como sin IIBB. */
export function appliesIibb(rule: Pick<BucketRule, 'aplica_iibb'> | undefined): boolean {
  return rule?.aplica_iibb !== false;
}

/** Categorías en que se liquida GMA. */
export type GmaBucket = 'privado' | 'publico' | 'diferencia' | 'caucion';

export const GMA_BUCKETS: readonly GmaBucket[] = ['privado', 'publico', 'diferencia', 'caucion'];

export const GMA_BUCKET_LABEL: Record<GmaBucket, string> = {
  privado: NET_BUCKET_LABEL.privado,
  publico: NET_BUCKET_LABEL.publico,
  diferencia: NET_BUCKET_LABEL.diferencia,
  caucion: 'Cauciones',
};

/** Alícuota de IVA para pasar el bruto sin IVA de GMA a la columna con IVA. */
export const GMA_IVA_FACTOR = 1.21;

/**
 * GMA: a pagar = (bruto − IIBB) × retrocesión ÷ IVA.
 * El Excel siempre trae el arancel sin IVA. `lleva_iva` de cada tipo dice si ese instrumento
 * se muestra también con IVA (importe × 1,21) en el resumen. No cambia la lectura ni el neto.
 */
export type GmaRules = {
  iibb_rate: number;
  buckets: Record<GmaBucket, BucketRule>;
};

/** Alícuotas vigentes desde `valid_from` (hasta la versión siguiente). */
export type NetRuleVersion = {
  id: string;
  valid_from: string;
  /** IEB: IIBB sobre el bruto. */
  iibb_rate: number;
  /** IEB: distribución e IVA por tipo de arancel. */
  buckets: Record<NetBucket, BucketRule>;
  /** GMA: IIBB, y retrocesión e IVA por categoría. */
  gma: GmaRules;
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

/** % del arancel de un manager, por segmento. Lo que no está cargado usa el estándar. */
export type ManagerShares = {
  /** Alias de la persona (MILI) o, si no tiene alias, el número de productor. */
  manager: string;
  ieb: Partial<Record<NetBucket, number>>;
  gma: Partial<Record<GmaBucket, number>>;
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
  /** % del arancel por manager y segmento. Un casillero vacío usa el estándar de la alícuota. */
  manager_shares: ManagerShares[];
  account_transfers: AccountTransfer[];
  person_aliases: PersonAlias[];
};

/** Los nombres cortos que ya usa GMA. */
export const DEFAULT_PERSON_ALIASES: PersonAlias[] = [
  { alias: 'MILI', nombres: ['Milagros Behr'] },
  { alias: 'MARTIN', nombres: ['Martin Behr'] },
  { alias: 'CLAUDIO', nombres: ['Claudio Behr'] },
];

/** La misma retrocesión en todas las categorías, sin IIBB ni IVA. */
export function gmaRulesWithShare(share: number): GmaRules {
  return {
    iibb_rate: 0,
    buckets: Object.fromEntries(
      GMA_BUCKETS.map((b) => [b, { share, iva_pesos: 1, iva_dolares: 1, aplica_iibb: true, lleva_iva: false }])
    ) as Record<GmaBucket, BucketRule>,
  };
}

export const DEFAULT_NET_RULES: NetRuleVersion = {
  id: 'planilla-ieb',
  valid_from: '2000-01-01',
  iibb_rate: 0.055,
  buckets: {
    privado: { share: 0.65, iva_pesos: 1, iva_dolares: 1, aplica_iibb: true },
    publico: { share: 0.65, iva_pesos: 1, iva_dolares: 1, aplica_iibb: true },
    licitacion: { share: 0.65, iva_pesos: 1, iva_dolares: 1, aplica_iibb: true },
    diferencia: { share: 0.65, iva_pesos: 1.21, iva_dolares: 1, aplica_iibb: true },
    fci_terceros: { share: 0.65, iva_pesos: 1.21, iva_dolares: 1.21, aplica_iibb: true },
    fci_ieb: { share: 0.7, iva_pesos: 1, iva_dolares: 1, aplica_iibb: true },
  },
  gma: gmaRulesWithShare(0.6),
  notes: 'IEB: planilla "calculadora aranceles IEB" (licitaciones con las reglas de títulos públicos). GMA: 60% del bruto.',
  created_at: '2026-10-12T00:00:00.000Z',
};

export function defaultSettings(): ArancelesSettings {
  return {
    net_rules: [DEFAULT_NET_RULES],
    producers: [],
    agreements: [],
    manager_shares: [],
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
  const rules = arr<NetRuleVersion & { gma_share?: unknown }>(r.net_rules).map(({ gma_share, ...v }) => {
    const gmaBase = gmaRulesWithShare(typeof gma_share === 'number' ? gma_share : 0.6);
    const legacyLlevaIva = (v.gma as { lleva_iva?: unknown } | undefined)?.lleva_iva === true;
    return {
      ...v,
      gma: {
        iibb_rate: typeof v.gma?.iibb_rate === 'number' ? v.gma.iibb_rate : gmaBase.iibb_rate,
        buckets: Object.fromEntries(
          GMA_BUCKETS.map((b) => {
            const saved = v.gma?.buckets?.[b];
            const lleva_iva = typeof saved?.lleva_iva === 'boolean' ? saved.lleva_iva : legacyLlevaIva;
            return [b, { ...gmaBase.buckets[b], ...saved, lleva_iva }];
          })
        ) as Record<GmaBucket, BucketRule>,
      },
      buckets: Object.fromEntries(
        NET_BUCKETS.map((b) => [b, { ...DEFAULT_NET_RULES.buckets[b], ...(v.buckets?.[b] ?? {}) }])
      ) as Record<NetBucket, BucketRule>,
    };
  });
  return {
    net_rules: rules.length ? sortRules(rules) : [DEFAULT_NET_RULES],
    producers: arr(r.producers),
    agreements: arr(r.agreements),
    manager_shares: coerceManagerShares(r.manager_shares),
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

function pickRates<K extends string>(raw: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'number' && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

function coerceManagerShares(raw: unknown): ManagerShares[] {
  const byKey = new Map<string, ManagerShares>();
  for (const item of arr<Partial<ManagerShares>>(raw)) {
    const manager = typeof item?.manager === 'string' ? item.manager.trim() : '';
    if (!manager) continue;
    const ieb = pickRates(item.ieb, NET_BUCKETS);
    const gma = pickRates(item.gma, GMA_BUCKETS);
    if (!Object.keys(ieb).length && !Object.keys(gma).length) continue;
    const prev = byKey.get(personKey(manager));
    byKey.set(personKey(manager), {
      manager: prev?.manager || manager,
      ieb: { ...prev?.ieb, ...ieb },
      gma: { ...prev?.gma, ...gma },
    });
  }
  return [...byKey.values()];
}

type ShareSource = Pick<ArancelCommission, 'alyc' | 'client_external_id' | 'trade_date' | 'details' | 'account_officer'>;

/**
 * % cargado para el manager de esta operación en un segmento.
 * IEB se reconoce por el número de productor, su código o su nombre (alias).
 * GMA, por el oficial de cuenta. `undefined` = usar el estándar.
 */
export function managerShareFor(
  settings: ArancelesSettings,
  c: ShareSource,
  scope: 'ieb' | 'gma',
  bucket: string
): number | undefined {
  const raw: string[] = [];
  if (c.alyc.trim().toUpperCase() === 'IEB') {
    const n = producerOf(c, settings);
    if (n) {
      raw.push(n);
      const p = settings.producers.find((x) => x.numero === n);
      if (p?.codigo) raw.push(p.codigo);
      if (p?.nombre) raw.push(p.nombre);
    }
    if (c.details?.productor) raw.push(c.details.productor);
  }
  if (c.account_officer) raw.push(c.account_officer);
  const keys = new Set(raw.map((v) => personKey(personAlias(v, settings) || v)));
  const row = settings.manager_shares.find((s) => keys.has(personKey(s.manager)));
  if (!row) return undefined;
  const table = (scope === 'ieb' ? row.ieb : row.gma) as Record<string, number | undefined>;
  const v = table[bucket];
  return typeof v === 'number' ? v : undefined;
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
