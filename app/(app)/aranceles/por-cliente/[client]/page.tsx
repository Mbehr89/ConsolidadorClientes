'use client';

import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OperationsTable } from '@/components/aranceles/operations-table';
import { setSegmentParams, type SegmentFilterValues } from '@/components/aranceles/report-filters';
import {
  ErrorBlock,
  LoadingBlock,
  Stat,
  TotalsStack,
  inputClass,
  readJson,
} from '@/components/aranceles/shared';
import { operationCategoryLabel } from '@/lib/aranceles/categories';
import { downloadClientExcel, downloadClientPdf } from '@/lib/aranceles/export-client';
import { buildClientExport } from '@/lib/aranceles/export-model';
import { compareFeeTypeLabels } from '@/lib/aranceles/fee-types';
import { isAnomaly } from '@/lib/aranceles/fees';
import { formatDate, formatMonth, formatMonthLong, formatNumber } from '@/lib/aranceles/format';
import { clientKey, type ArancelesSummary } from '@/lib/aranceles/history';
import {
  SEGMENT_DIMENSIONS,
  SEGMENT_LABEL,
  SIN_ASIGNAR,
  SIN_ASIGNAR_LABEL,
  personaBrokerLabel,
  segmentLabel,
  splitExclusions,
  type SegmentDimension,
  type SegmentedCommission,
} from '@/lib/aranceles/segments';
import { FEE_STATUS_LABEL, type FeeStatus } from '@/lib/aranceles/types';

const MAX_ROWS = 1000;

type SummaryResponse = {
  summary: ArancelesSummary;
  total: number;
  rows: SegmentedCommission[];
  clients: { key: string; name: string }[];
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function ArancelesClienteDetallePage({
  params,
  searchParams,
}: {
  params: { client: string };
  searchParams: Partial<Record<'alyc' | 'from' | 'to' | 'granularity' | 'excluir' | SegmentDimension, string>>;
}) {
  const key = safeDecode(params.client);
  const { alyc = '', from = '', to = '', granularity = '', excluir = '' } = searchParams;
  const segmentKey = SEGMENT_DIMENSIONS.map((d) => searchParams[d] ?? '').join('\u0000');
  const segments = useMemo(() => {
    const values = segmentKey.split('\u0000');
    return {
      ...Object.fromEntries(SEGMENT_DIMENSIONS.map((d, i) => [d, values[i] ?? ''])),
      excluir,
    } as SegmentFilterValues;
  }, [segmentKey, excluir]);

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ client: key, limit: String(MAX_ROWS) });
      if (alyc) p.set('alyc', alyc);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      setSegmentParams(p, segments);
      const res = await fetch(`/api/aranceles/summary?${p.toString()}`, { cache: 'no-store' });
      const json = await readJson<SummaryResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar las operaciones');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [key, alyc, from, to, segments]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = data?.clients.find((c) => c.key === key)?.name ?? data?.rows[0]?.client ?? key;

  const visibleRows = useMemo(() => {
    const q = clientKey(search);
    return (data?.rows ?? []).filter((r) => {
      if (status === 'anomaly' && !isAnomaly(r.fee_status)) return false;
      if (status && status !== 'anomaly' && r.fee_status !== status) return false;
      if (!q) return true;
      const hay = clientKey(
        [r.instrument, r.operation, operationCategoryLabel(r.operation), r.op_number, r.alyc, r.client_external_id]
          .filter(Boolean)
          .join(' ')
      );
      return hay.includes(q);
    });
  }, [data, search, status]);

  const backQuery = new URLSearchParams(
    Object.entries({ alyc, from, to, granularity, ...segments }).filter(([, v]) => v) as [string, string][]
  ).toString();
  const excluded = splitExclusions(excluir);
  const segmentNote = [
    ...SEGMENT_DIMENSIONS.filter((d) => segments[d]).map(
      (d) => `${SEGMENT_LABEL[d]}: ${segments[d] === SIN_ASIGNAR ? SIN_ASIGNAR_LABEL : segments[d]}`
    ),
    ...(excluded.length > 0 ? [`Sin ${excluded.map(personaBrokerLabel).join(', ')}`] : []),
  ];
  const bound = (v: string) => (v.length === 7 ? formatMonthLong(v) : formatDate(v));
  const range =
    from && to && from === to ? bound(from) : [from && `desde ${bound(from)}`, to && `hasta ${bound(to)}`].filter(Boolean).join(' ');
  const rangeLabel = [alyc, range, ...segmentNote]
    .filter(Boolean)
    .join(' · ');

  const clientSegments = useMemo(() => {
    const rows = data?.rows ?? [];
    return SEGMENT_DIMENSIONS.map((d) => ({
      dimension: d,
      values: [...new Set(rows.map((r) => segmentLabel(r[d])))].sort((a, b) =>
        d === 'tipo' ? compareFeeTypeLabels(a, b) : a.localeCompare(b, 'es')
      ),
    }));
  }, [data]);

  const exportData = async (kind: 'xlsx' | 'pdf') => {
    setExporting(kind);
    setExportError(null);
    try {
      const notes = [
        rangeLabel,
        status && `Estado: ${status === 'anomaly' ? 'sólo a revisar' : FEE_STATUS_LABEL[status as FeeStatus]}`,
        search.trim() && `Búsqueda: "${search.trim()}"`,
      ]
        .filter(Boolean)
        .join(' · ');
      const payload = buildClientExport(name, visibleRows, notes);
      if (kind === 'xlsx') await downloadClientExcel(payload);
      else await downloadClientPdf(payload);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'No se pudo generar el archivo');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/aranceles/por-cliente${backQuery ? `?${backQuery}` : ''}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a clientes
          </Link>
          <h3 className="text-xl font-semibold">{name}</h3>
          {data && data.rows.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {clientSegments.map((s) => (
                <span key={s.dimension}>
                  <span className="text-muted-foreground">{SEGMENT_LABEL[s.dimension]}:</span> {s.values.join(', ')}
                </span>
              ))}
            </p>
          )}
          {rangeLabel && <p className="text-sm text-muted-foreground">{rangeLabel}</p>}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!data || visibleRows.length === 0 || exporting != null}
            onClick={() => void exportData('xlsx')}
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {exporting === 'xlsx' ? 'Generando…' : 'Excel'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data || visibleRows.length === 0 || exporting != null}
            onClick={() => void exportData('pdf')}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {exporting === 'pdf' ? 'Generando…' : 'PDF'}
          </Button>
        </div>
      </div>
      {exportError && <ErrorBlock message={exportError} />}

      {loading && !data && <LoadingBlock label="Cargando operaciones…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Aranceles"
              value={<TotalsStack totals={data.summary.totals} align="start" className="text-base" />}
            />
            <Stat label="Operaciones" value={formatNumber(data.summary.rowCount)} />
            <Stat label="ALYCs" value={formatNumber(data.summary.alycCount)} />
            <Stat
              label="A revisar"
              value={formatNumber(data.summary.anomalyCount)}
              hint={data.summary.anomalyCount > 0 ? 'Sin arancel o por debajo de la tarifa' : undefined}
            />
          </div>

          {data.summary.byMonth.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Por mes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border/70">
                  {data.summary.byMonth.map((m) => (
                    <li key={m.key} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                      <div>
                        <div className="font-medium capitalize">{formatMonth(m.label)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(m.rows)} op.</div>
                      </div>
                      <TotalsStack totals={m.totals} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="space-y-3">
              <CardTitle className="text-lg">
                Operaciones ({formatNumber(visibleRows.length)}
                {data.total > data.rows.length ? ` de las últimas ${formatNumber(data.rows.length)}` : ''})
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClass} w-64`}
                  placeholder="Instrumento, operación, boleto…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  className={`${inputClass} w-auto`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Estado"
                >
                  <option value="">Todos los estados</option>
                  <option value="anomaly">Sólo a revisar</option>
                  <option value="ok">OK</option>
                  <option value="skipped">{FEE_STATUS_LABEL.skipped}</option>
                  <option value="missing">{FEE_STATUS_LABEL.missing}</option>
                  <option value="zero">{FEE_STATUS_LABEL.zero}</option>
                  <option value="below_expected">{FEE_STATUS_LABEL.below_expected}</option>
                  <option value="min_on_large">{FEE_STATUS_LABEL.min_on_large}</option>
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {visibleRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin operaciones con estos filtros.</p>
              ) : (
                <OperationsTable rows={visibleRows} showClient={false} maxHeightClass="max-h-[640px]" />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
