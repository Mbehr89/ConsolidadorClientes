'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Stat,
  StatusBadge,
  inputClass,
  readJson,
} from '@/components/aranceles/shared';
import { formatDate, formatMoney, formatMonth, formatNumber, formatTotals } from '@/lib/aranceles/format';
import type { ArancelesSummary, BreakdownRow } from '@/lib/aranceles/history';
import type { ArancelesStorageInfo } from '@/lib/aranceles/store';
import { FEE_STATUS_LABEL, type ArancelCommission, type ArancelImport } from '@/lib/aranceles/types';

type SummaryResponse = {
  storage: ArancelesStorageInfo;
  updatedAt: string;
  lastImport: ArancelImport | null;
  importCount: number;
  alycs: { name: string; rows: number }[];
  clients: { key: string; name: string }[];
  summary: ArancelesSummary;
  total: number;
  rows: ArancelCommission[];
};

type Filters = { alyc: string; client: string; from: string; to: string; q: string; status: string };
const EMPTY_FILTERS: Filters = { alyc: '', client: '', from: '', to: '', q: '', status: '' };

function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim());
  p.set('limit', '200');
  return p.toString();
}

export default function ArancelesResumenPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/aranceles/summary?${toQuery(filters)}`, { cache: 'no-store' });
      const json = await readJson<SummaryResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar el historial');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const hasFilters = Object.values(filters).some((v) => v.trim());
  const isEmpty = data != null && data.importCount === 0;

  return (
    <div className="space-y-6">
      {data && <StorageNote storage={data.storage} updatedAt={data.updatedAt} lastImport={data.lastImport} />}

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
          <label className="space-y-1 text-xs text-muted-foreground">
            Desde
            <input type="date" className={inputClass} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Hasta
            <input type="date" className={inputClass} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
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
              placeholder="Cliente, instrumento, cuenta…"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
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
            <Stat label="Aranceles" value={formatTotals(data.summary.totals)} />
            <Stat label="Operaciones" value={formatNumber(data.summary.rowCount)} />
            <Stat label="Clientes" value={formatNumber(data.summary.clientCount)} />
            <Stat label="ALYCs" value={formatNumber(data.summary.alycCount)} />
            <Stat
              label="A revisar"
              value={formatNumber(data.summary.anomalyCount)}
              hint={data.summary.anomalyCount > 0 ? 'Sin arancel o por debajo de la tarifa' : undefined}
            />
          </div>
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
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Detalle ({formatNumber(data.total)} operaciones{data.total > data.rows.length ? `, mostrando ${data.rows.length}` : ''})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="sticky top-0 border-b bg-card">
                    <tr className="text-xs uppercase text-muted-foreground">
                      <th className="p-2 text-left font-medium">Fecha</th>
                      <th className="p-2 text-left font-medium">Cliente</th>
                      <th className="p-2 text-left font-medium">ALYC</th>
                      <th className="p-2 text-left font-medium">Operación</th>
                      <th className="p-2 text-left font-medium">Instrumento</th>
                      <th className="p-2 text-right font-medium">Bruto</th>
                      <th className="p-2 text-right font-medium">Arancel</th>
                      <th className="p-2 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
                        <td className="whitespace-nowrap p-2">{formatDate(r.trade_date)}</td>
                        <td className="p-2">
                          <div>{r.client}</div>
                          {r.client_external_id && (
                            <div className="text-xs text-muted-foreground">Cta. {r.client_external_id}</div>
                          )}
                        </td>
                        <td className="p-2">{r.alyc}</td>
                        <td className="p-2 text-xs">{r.operation ?? '—'}</td>
                        <td className="p-2 font-mono text-xs text-muted-foreground">{r.instrument ?? '—'}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {r.amount != null ? formatNumber(r.amount) : '—'}
                        </td>
                        <td className="p-2 text-right font-medium tabular-nums">
                          {formatMoney(r.commission, r.currency)}
                          {r.commission_pct != null && (
                            <div className="text-xs font-normal text-muted-foreground">{formatNumber(r.commission_pct)}%</div>
                          )}
                        </td>
                        <td className="p-2">
                          <StatusBadge status={r.fee_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          <ul className="max-h-72 divide-y divide-border/70 overflow-auto">
            {rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {labelFormat ? labelFormat(r.label) : r.label}
                  <span className="ml-2 text-xs text-muted-foreground">{r.rows} op.</span>
                </span>
                <span className="shrink-0 text-right font-medium tabular-nums">{formatTotals(r.totals)}</span>
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
