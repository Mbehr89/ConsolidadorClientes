'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OperationsTable } from '@/components/aranceles/operations-table';
import {
  EMPTY_SEGMENT_FILTERS,
  MonthRangeSelects,
  SegmentFilterSelects,
  type SegmentFilterValues,
} from '@/components/aranceles/report-filters';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Stat,
  TotalsStack,
  inputClass,
  readJson,
} from '@/components/aranceles/shared';
import { formatDate, formatMonth, formatNumber, formatTotals } from '@/lib/aranceles/format';
import { cn } from '@/lib/utils';
import type { ArancelesSummary, BreakdownRow } from '@/lib/aranceles/history';
import {
  SEGMENT_DIMENSIONS,
  SEGMENT_LABEL,
  type SegmentDimension,
  type SegmentOptions,
  type SegmentedCommission,
} from '@/lib/aranceles/segments';
import type { ArancelesStorageInfo } from '@/lib/aranceles/store';
import { FEE_STATUS_LABEL, type ArancelImport } from '@/lib/aranceles/types';

type SummaryResponse = {
  storage: ArancelesStorageInfo;
  updatedAt: string;
  lastImport: ArancelImport | null;
  importCount: number;
  alycs: { name: string; rows: number }[];
  clients: { key: string; name: string }[];
  months: string[];
  segmentOptions: SegmentOptions;
  summary: ArancelesSummary;
  segments: Record<SegmentDimension, BreakdownRow[]>;
  total: number;
  rows: SegmentedCommission[];
  measure: Measure;
  withoutNet: { rows: number; totals: Record<string, number> } | null;
};

type Measure = 'gross' | 'net';

type Filters = SegmentFilterValues & {
  alyc: string;
  client: string;
  from: string;
  to: string;
  q: string;
  status: string;
};
const EMPTY_FILTERS: Filters = {
  ...EMPTY_SEGMENT_FILTERS,
  alyc: '',
  client: '',
  from: '',
  to: '',
  q: '',
  status: '',
};

function toQuery(f: Filters, measure: Measure): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim());
  p.set('limit', '200');
  if (measure === 'net') p.set('measure', 'net');
  return p.toString();
}

function MeasureToggle({ value, onChange }: { value: Measure; onChange: (m: Measure) => void }) {
  const options: { id: Measure; label: string }[] = [
    { id: 'gross', label: 'Bruto' },
    { id: 'net', label: 'Neto a pagar' },
  ];
  return (
    <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label="Ver bruto o neto">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-3 py-1 text-sm transition-colors',
            value === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ArancelesResumenPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [measure, setMeasure] = useState<Measure>('gross');
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/aranceles/summary?${toQuery(filters, measure)}`, { cache: 'no-store' });
      const json = await readJson<SummaryResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar el historial');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [filters, measure]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const hasFilters = Object.values(filters).some((v) => v.trim());
  const isEmpty = data != null && data.importCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data ? <StorageNote storage={data.storage} updatedAt={data.updatedAt} lastImport={data.lastImport} /> : <span />}
        <MeasureToggle value={measure} onChange={setMeasure} />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1 text-xs text-muted-foreground">
            ALYC
            <select className={inputClass} value={filters.alyc} onChange={(e) => set({ alyc: e.target.value })}>
              <option value="">Todas</option>
              {data?.alycs.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Cliente
            <select className={inputClass} value={filters.client} onChange={(e) => set({ client: e.target.value })}>
              <option value="">Todos</option>
              {data?.clients.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <MonthRangeSelects from={filters.from} to={filters.to} months={data?.months} onChange={set} />
          <label className="space-y-1 text-xs text-muted-foreground">
            Estado
            <select className={inputClass} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Todos</option>
              <option value="anomaly">Sólo a revisar</option>
              <option value="ok">OK</option>
              <option value="missing">{FEE_STATUS_LABEL.missing}</option>
              <option value="zero">{FEE_STATUS_LABEL.zero}</option>
              <option value="below_expected">{FEE_STATUS_LABEL.below_expected}</option>
              <option value="min_on_large">{FEE_STATUS_LABEL.min_on_large}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Buscar
            <input
              className={inputClass}
              placeholder="Cliente, instrumento, operación, boleto…"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
          <SegmentFilterSelects value={filters} onChange={set} options={data?.segmentOptions} />
          {hasFilters && (
            <div className="sm:col-span-2 lg:col-span-6">
              <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                Limpiar filtros
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && !data && <LoadingBlock label="Calculando comisiones…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {data && isEmpty && (
        <EmptyBlock
          title="Todavía no hay comisiones"
          description="Sincronizá la carpeta de Drive o subí un Excel de una ALYC para empezar a armar el historial."
          action={
            <Button asChild size="sm">
              <Link href="/aranceles/importar">Ir a importar</Link>
            </Button>
          }
        />
      )}

      {data && !isEmpty && (
        <div className={loading ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6'}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label={data.measure === 'net' ? 'Neto a pagar' : 'Aranceles brutos'}
              value={<TotalsStack totals={data.summary.totals} align="start" className="text-base" />}
            />
            <Stat label="Operaciones" value={formatNumber(data.summary.rowCount)} />
            <Stat label="Clientes" value={formatNumber(data.summary.clientCount)} />
            <Stat label="ALYCs" value={formatNumber(data.summary.alycCount)} />
            <Stat
              label="A revisar"
              value={formatNumber(data.summary.anomalyCount)}
              hint={data.summary.anomalyCount > 0 ? 'Sin arancel o por debajo de la tarifa' : undefined}
            />
          </div>
          {data.measure === 'net' && (
            <p className="text-sm text-muted-foreground">
              Todos los importes son el neto a pagar de cada operación, con las alícuotas de{' '}
              <Link href="/aranceles/configuracion" className="font-medium text-primary hover:underline">
                Configuración
              </Link>{' '}
              vigentes a su fecha (detalle por tipo en{' '}
              <Link href="/aranceles/neto" className="font-medium text-primary hover:underline">
                Neto
              </Link>
              ).
              {data.withoutNet && data.withoutNet.rows > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {' '}
                  {formatNumber(data.withoutNet.rows)} operaciones sin regla de neto quedan afuera (
                  {formatTotals(data.withoutNet.totals)} de bruto).
                </span>
              )}
            </p>
          )}
          {data.summary.anomalyCount > 0 && (
            <p className="text-sm text-muted-foreground">
              Hay operaciones sin arancel o por debajo de la tarifa sugerida.{' '}
              <Link href="/aranceles/control" className="font-medium text-primary hover:underline">
                Abrir control
              </Link>
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Breakdown title="Por ALYC" rows={data.summary.byAlyc} />
            <Breakdown title="Por mes" rows={data.summary.byMonth} labelFormat={formatMonth} />
            <Breakdown title="Top clientes" rows={data.summary.byClient.slice(0, 15)} />
            {SEGMENT_DIMENSIONS.map((d) => (
              <Breakdown key={d} title={`Por ${SEGMENT_LABEL[d].toLowerCase()}`} rows={data.segments[d]} />
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Manager, advisor y grupo asesor salen de{' '}
            <Link href="/admin/mapping-cuentas" className="text-primary hover:underline">
              Admin → Mapping cuentas
            </Link>{' '}
            según la cuenta comitente de cada operación.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Detalle ({formatNumber(data.total)} operaciones{data.total > data.rows.length ? `, mostrando ${data.rows.length}` : ''})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OperationsTable rows={data.rows} feeLabel={data.measure === 'net' ? 'Neto a pagar' : 'Arancel bruto'} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  labelFormat,
}: {
  title: string;
  rows: BreakdownRow[];
  labelFormat?: (label: string) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos en este corte.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border/70 overflow-auto pr-1">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium capitalize" title={r.label}>
                    {labelFormat ? labelFormat(r.label) : r.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{formatNumber(r.rows)} op.</div>
                </div>
                <TotalsStack totals={r.totals} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StorageNote({
  storage,
  updatedAt,
  lastImport,
}: {
  storage: ArancelesStorageInfo;
  updatedAt: string;
  lastImport: ArancelImport | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {storage.backend === 'drive' ? (
        <Badge variant="success">Historial en Drive · {storage.historyFilename}</Badge>
      ) : (
        <Badge variant="warning">Historial local (Drive no configurado)</Badge>
      )}
      {lastImport && (
        <span>
          Última importación: {lastImport.alyc} · {lastImport.filename} ({formatDate(lastImport.imported_at.slice(0, 10))})
        </span>
      )}
      <span>Actualizado {formatDate(updatedAt.slice(0, 10))}</span>
    </div>
  );
}
