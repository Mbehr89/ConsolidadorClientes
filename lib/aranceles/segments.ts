import { compareFeeTypeLabels, feeTypeLabel } from '@/lib/aranceles/fee-types';
import { breakdown, type BreakdownRow } from '@/lib/aranceles/history';
import {
  defaultSettings,
  personAlias,
  producerLabel,
  producerOf,
  type ArancelesSettings,
} from '@/lib/aranceles/settings';
import type { ArancelCommission } from '@/lib/aranceles/types';
import type { MappingCuentasStore } from '@/lib/config-store/types';
import { normalizeGrupoAsesor } from '@/lib/grupo-asesor';
import type { BrokerCode } from '@/lib/schema';

/**
 * Categorías de cada operación: tipo de arancel (sale del archivo de origen), productor / manager
 * (del archivo; si falta, del mapping) y advisor / grupo asesor (de Admin → Mapping cuentas, por cuenta comitente).
 * Si la operación tiene un arancel cargado a mano (`manual_commission`), los reportes usan ese importe.
 */
export type SegmentDimension = 'tipo' | 'manager' | 'advisor' | 'grupo_asesor';

export const SEGMENT_DIMENSIONS: readonly SegmentDimension[] = ['tipo', 'manager', 'advisor', 'grupo_asesor'];

export const SEGMENT_LABEL: Record<SegmentDimension, string> = {
  tipo: 'Tipo de arancel',
  manager: 'Productor / Manager',
  advisor: 'Advisor',
  grupo_asesor: 'Grupo asesor',
};

/** Valor de filtro para cuentas sin la categoría asignada en el mapping. */
export const SIN_ASIGNAR = '__sin_asignar__';
export const SIN_ASIGNAR_LABEL = 'Sin asignar';

export type ArancelSegment = Record<SegmentDimension, string | null>;
export type SegmentedCommission = ArancelCommission & ArancelSegment;
/** `excluir`: pares productor/manager × broker a sacar del reporte (ver `joinExclusions`). */
export type SegmentFilters = Partial<Record<SegmentDimension, string | null>> & { excluir?: string | null };
export type PersonaBrokerOption = { key: string; label: string };
export type SegmentOptions = Record<SegmentDimension, string[]> & { excluir: PersonaBrokerOption[] };

const EXCLUSION_SEP = ';';
const PAIR_SEP = '|';

export function personaBrokerKey(alyc: string, persona: string | null): string {
  return `${alyc}${PAIR_SEP}${persona ?? SIN_ASIGNAR}`;
}

export function personaBrokerLabel(key: string): string {
  const i = key.indexOf(PAIR_SEP);
  const persona = key.slice(i + 1);
  return `${persona === SIN_ASIGNAR ? SIN_ASIGNAR_LABEL : persona} – ${key.slice(0, i)}`;
}

export function splitExclusions(raw: string | null | undefined): string[] {
  return (raw ?? '').split(EXCLUSION_SEP).filter((k) => k.includes(PAIR_SEP));
}

export function joinExclusions(keys: readonly string[]): string {
  return keys.join(EXCLUSION_SEP);
}

/** Las planillas de aranceles de GMA usan los mismos comitentes que las tenencias GMA ("esco": nombre viejo). */
const ALYC_TO_BROKER: Record<string, BrokerCode> = {
  esco: 'GMA',
  gma: 'GMA',
  ieb: 'IEB',
};

export function mappingBrokerForAlyc(alyc: string): BrokerCode | null {
  return ALYC_TO_BROKER[alyc.trim().toLowerCase()] ?? null;
}

function clean(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

function compareValues(d: SegmentDimension, a: string, b: string): number {
  return d === 'tipo' ? compareFeeTypeLabels(a, b) : a.localeCompare(b, 'es');
}

/**
 * Productor / manager según el archivo de la ALYC: IEB trae el productor (numeroProductor), GMA el oficial
 * de cuenta. Si el archivo no lo trae, se usa el manager del mapping de cuentas.
 */
function personaFromFile(c: ArancelCommission, officer: string | null, settings: ArancelesSettings): string | null {
  const broker = mappingBrokerForAlyc(c.alyc);
  if (broker === 'IEB') {
    const n = producerOf(c, settings);
    return n ? producerLabel(n, settings, c.details?.productor) : null;
  }
  if (broker === 'GMA') return officer;
  return null;
}

export function segmentCommissions(
  commissions: readonly ArancelCommission[],
  store: MappingCuentasStore | null,
  settings: ArancelesSettings = defaultSettings()
): SegmentedCommission[] {
  return commissions.map((c) => {
    const broker = mappingBrokerForAlyc(c.alyc);
    const entry = broker && c.client_external_id ? store?.[broker]?.[c.client_external_id] : undefined;
    const obj = entry && typeof entry === 'object' ? entry : null;
    const officer = personAlias(c.account_officer, settings);
    const manual = c.manual_commission != null && c.commission === 0 ? c.manual_commission : null;
    return {
      ...c,
      ...(manual != null
        ? { commission: manual, commission_currency: c.currency, commission_fx: null, fee_status: 'ok' as const }
        : {}),
      account_officer: officer,
      tipo: feeTypeLabel(c),
      manager: personaFromFile(c, officer, settings) ?? personAlias(clean(obj?.productor), settings),
      advisor: personAlias(clean(obj?.advisor), settings),
      grupo_asesor: normalizeGrupoAsesor(obj?.grupo_asesor),
    };
  });
}

export function parseSegmentFilters(sp: URLSearchParams): SegmentFilters {
  return {
    ...(Object.fromEntries(SEGMENT_DIMENSIONS.map((d) => [d, sp.get(d) || null])) as SegmentFilters),
    excluir: sp.get('excluir') || null,
  };
}

function matches(value: string | null, filter: string | null | undefined): boolean {
  if (!filter) return true;
  if (filter === SIN_ASIGNAR) return value == null;
  return value === filter;
}

export function filterBySegment<T extends ArancelSegment & { alyc: string }>(rows: readonly T[], f: SegmentFilters): T[] {
  const excluded = new Set(splitExclusions(f.excluir));
  if (!SEGMENT_DIMENSIONS.some((d) => f[d]) && excluded.size === 0) return [...rows];
  return rows.filter(
    (r) =>
      SEGMENT_DIMENSIONS.every((d) => matches(r[d], f[d])) && !excluded.has(personaBrokerKey(r.alyc, r.manager))
  );
}

/**
 * Valores de cada categoría; `SIN_ASIGNAR` va al final sólo si alguna operación no la tiene. `excluir` lista
 * los pares productor/manager × broker que existen, ordenados por persona.
 */
export function segmentOptions(rows: readonly (ArancelSegment & { alyc: string })[]): SegmentOptions {
  const sets = Object.fromEntries(SEGMENT_DIMENSIONS.map((d) => [d, new Set<string>()])) as Record<
    SegmentDimension,
    Set<string>
  >;
  const missing = new Set<SegmentDimension>();
  const pairs = new Map<string, { alyc: string; persona: string | null }>();
  for (const r of rows) {
    for (const d of SEGMENT_DIMENSIONS) {
      const v = r[d];
      if (v) sets[d].add(v);
      else missing.add(d);
    }
    pairs.set(personaBrokerKey(r.alyc, r.manager), { alyc: r.alyc, persona: r.manager });
  }
  const excluir = [...pairs.entries()]
    .sort(
      ([, a], [, b]) =>
        Number(a.persona == null) - Number(b.persona == null) ||
        (a.persona ?? '').localeCompare(b.persona ?? '', 'es') ||
        a.alyc.localeCompare(b.alyc, 'es')
    )
    .map(([key]) => ({ key, label: personaBrokerLabel(key) }));
  return {
    ...(Object.fromEntries(
      SEGMENT_DIMENSIONS.map((d) => [
        d,
        [...[...sets[d]].sort((a, b) => compareValues(d, a, b)), ...(missing.has(d) ? [SIN_ASIGNAR] : [])],
      ])
    ) as Record<SegmentDimension, string[]>),
    excluir,
  };
}

export function segmentLabel(value: string | null): string {
  return value ?? SIN_ASIGNAR_LABEL;
}

/** Totales por tipo de arancel, manager, advisor y grupo asesor ("Sin asignar" al final). */
export function segmentBreakdowns(rows: readonly SegmentedCommission[]): Record<SegmentDimension, BreakdownRow[]> {
  const build = (d: SegmentDimension) =>
    breakdown(
      rows,
      (c) => c[d] ?? SIN_ASIGNAR,
      (c) => segmentLabel(c[d])
    ).sort((a, b) =>
      a.key === SIN_ASIGNAR ? 1 : b.key === SIN_ASIGNAR ? -1 : compareValues(d, a.label, b.label)
    );
  return Object.fromEntries(SEGMENT_DIMENSIONS.map((d) => [d, build(d)])) as Record<
    SegmentDimension,
    BreakdownRow[]
  >;
}
