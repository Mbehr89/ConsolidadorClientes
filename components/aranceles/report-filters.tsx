'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { inputClass, readJson } from '@/components/aranceles/shared';
import { formatMonthLong } from '@/lib/aranceles/format';
import type { PeriodGranularity, ReportGroupBy } from '@/lib/aranceles/reports';
import {
  SEGMENT_DIMENSIONS,
  SEGMENT_LABEL,
  SIN_ASIGNAR,
  SIN_ASIGNAR_LABEL,
  joinExclusions,
  personaBrokerLabel,
  splitExclusions,
  type PersonaBrokerOption,
  type SegmentDimension,
  type SegmentOptions,
} from '@/lib/aranceles/segments';
import { cn } from '@/lib/utils';

/** `excluir`: pares productor/manager × broker serializados con `joinExclusions`. */
export type SegmentFilterValues = Record<SegmentDimension, string> & { excluir: string };

export const EMPTY_SEGMENT_FILTERS: SegmentFilterValues = {
  tipo: '',
  manager: '',
  advisor: '',
  grupo_asesor: '',
  excluir: '',
};

export type ReportFilters = SegmentFilterValues & {
  alyc: string;
  client: string;
  from: string;
  to: string;
  granularity: PeriodGranularity;
  groupBy: ReportGroupBy;
};

export const EMPTY_REPORT_FILTERS: ReportFilters = {
  ...EMPTY_SEGMENT_FILTERS,
  alyc: '',
  client: '',
  from: '',
  to: '',
  granularity: 'month',
  groupBy: 'alyc',
};

export type ReportResponse<T> = {
  importCount: number;
  alycs: { name: string; rows: number }[];
  clients: { key: string; name: string }[];
  months: string[];
  segmentOptions: SegmentOptions;
  granularity: PeriodGranularity;
  groupBy: ReportGroupBy;
  report: T;
};

const GRANULARITY_LABEL: Record<PeriodGranularity, string> = {
  month: 'Mensual',
  quarter: 'Trimestral',
  year: 'Anual',
};

export function setSegmentParams(p: URLSearchParams, f: SegmentFilterValues) {
  for (const d of SEGMENT_DIMENSIONS) if (f[d]) p.set(d, f[d]);
  if (f.excluir) p.set('excluir', f.excluir);
}

export function useArancelesReport<T>(view: 'broker' | 'client' | 'net', filters: ReportFilters) {
  const [data, setData] = useState<ReportResponse<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ view, granularity: filters.granularity });
      if (view === 'broker') p.set('groupBy', filters.groupBy);
      if (filters.alyc) p.set('alyc', filters.alyc);
      if (filters.client) p.set('client', filters.client);
      if (filters.from) p.set('from', filters.from);
      if (filters.to) p.set('to', filters.to);
      setSegmentParams(p, filters);
      const res = await fetch(`/api/aranceles/reports?${p.toString()}`, { cache: 'no-store' });
      const json = await readJson<ReportResponse<T>>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al armar el reporte');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [view, filters]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return { data, loading, error, reload: load };
}

/**
 * Desde / Hasta por meses enteros (las liquidaciones son mensuales). Elegir "Desde" lleva "Hasta" al
 * mismo mes; para ver varios meses se cambia "Hasta" a mano.
 */
export function MonthRangeSelects({
  from,
  to,
  months,
  onChange,
}: {
  from: string;
  to: string;
  months: readonly string[] | undefined;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const f = from.slice(0, 7);
  const t = to.slice(0, 7);
  const all = [...new Set([...(months ?? []), ...[f, t].filter(Boolean)])].sort((a, b) => b.localeCompare(a));
  return (
    <>
      <label className="space-y-1 text-xs text-muted-foreground">
        Desde
        <select className={inputClass} value={f} onChange={(e) => onChange({ from: e.target.value, to: e.target.value })}>
          <option value="">Todos los meses</option>
          {all.map((m) => (
            <option key={m} value={m}>
              {formatMonthLong(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Hasta
        <select className={inputClass} value={t} onChange={(e) => onChange({ from: f, to: e.target.value })}>
          <option value="">{f ? 'Último mes' : 'Todos los meses'}</option>
          {all
            .filter((m) => !f || m >= f)
            .map((m) => (
              <option key={m} value={m}>
                {formatMonthLong(m)}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}

/** Lista desplegable con casillas para sacar del reporte varios pares productor/manager × broker. */
export function ExcludePersonaBroker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly PersonaBrokerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected = splitExclusions(value);
  const toggle = (key: string) =>
    onChange(joinExclusions(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]));
  const summary =
    selected.length === 0
      ? 'Ninguno'
      : selected.length <= 2
        ? selected.map(personaBrokerLabel).join(', ')
        : `${selected.length} excluidos`;

  return (
    <div ref={ref} className="relative space-y-1 text-xs text-muted-foreground">
      <span className="block">Excluir productor – broker</span>
      <button
        type="button"
        className={cn(inputClass, 'flex items-center justify-between gap-2 text-left', selected.length > 0 && 'text-foreground')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-panel">
          {options.length === 0 && <p className="px-2 py-1.5 text-muted-foreground">Sin productores</p>}
          {options.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={selected.includes(o.key)}
                onChange={() => toggle(o.key)}
              />
              {o.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="mt-1 w-full rounded border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              onClick={() => onChange('')}
            >
              Quitar exclusiones
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Selects de Productor / Manager, Advisor, Grupo asesor y exclusión de productor – broker. */
export function SegmentFilterSelects({
  value,
  onChange,
  options,
}: {
  value: SegmentFilterValues;
  onChange: (patch: Partial<SegmentFilterValues>) => void;
  options: SegmentOptions | undefined;
}) {
  return (
    <>
      {SEGMENT_DIMENSIONS.map((d) => (
        <label key={d} className="space-y-1 text-xs text-muted-foreground">
          {SEGMENT_LABEL[d]}
          <select className={inputClass} value={value[d]} onChange={(e) => onChange({ [d]: e.target.value })}>
            <option value="">Todos</option>
            {(options?.[d] ?? []).map((o) => (
              <option key={o} value={o}>
                {o === SIN_ASIGNAR ? SIN_ASIGNAR_LABEL : o}
              </option>
            ))}
          </select>
        </label>
      ))}
      <ExcludePersonaBroker
        value={value.excluir}
        options={options?.excluir ?? []}
        onChange={(excluir) => onChange({ excluir })}
      />
    </>
  );
}

export function ReportFiltersBar({
  filters,
  onChange,
  alycs,
  clients,
  months,
  segmentOptions,
  children,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  alycs: { name: string }[];
  months: readonly string[] | undefined;
  clients?: { key: string; name: string }[];
  segmentOptions: SegmentOptions | undefined;
  children?: React.ReactNode;
}) {
  const set = (patch: Partial<ReportFilters>) => onChange({ ...filters, ...patch });
  const hasFilters = (Object.keys(EMPTY_REPORT_FILTERS) as (keyof ReportFilters)[]).some(
    (k) => filters[k] !== EMPTY_REPORT_FILTERS[k]
  );

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="space-y-1 text-xs text-muted-foreground">
          Período
          <select
            className={inputClass}
            value={filters.granularity}
            onChange={(e) => set({ granularity: e.target.value as PeriodGranularity })}
          >
            {(Object.keys(GRANULARITY_LABEL) as PeriodGranularity[]).map((g) => (
              <option key={g} value={g}>
                {GRANULARITY_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          ALYC
          <select className={inputClass} value={filters.alyc} onChange={(e) => set({ alyc: e.target.value })}>
            <option value="">Todas</option>
            {alycs.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {clients && (
          <label className="space-y-1 text-xs text-muted-foreground">
            Cliente
            <select className={inputClass} value={filters.client} onChange={(e) => set({ client: e.target.value })}>
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <MonthRangeSelects from={filters.from} to={filters.to} months={months} onChange={set} />
        <SegmentFilterSelects value={filters} onChange={set} options={segmentOptions} />
        {children}
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-6">
            <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_REPORT_FILTERS)}>
              Limpiar filtros
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
