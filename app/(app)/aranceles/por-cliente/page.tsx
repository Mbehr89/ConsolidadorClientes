'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyBlock, ErrorBlock, LoadingBlock, inputClass } from '@/components/aranceles/shared';
import {
  EMPTY_REPORT_FILTERS,
  ReportFiltersBar,
  useArancelesReport,
  type ReportFilters,
} from '@/components/aranceles/report-filters';
import { clientKey } from '@/lib/aranceles/history';
import { currencyLabel, formatMoney, formatNumber, formatPeriod } from '@/lib/aranceles/format';
import { parseGranularity, runningTotals, type ClientPeriodReport } from '@/lib/aranceles/reports';

type Totals = Record<string, number>;
type Mode = 'period' | 'running';
type SortBy = 'total' | 'name';

const ALL_CURRENCIES = '';

/** Filtros que viajan en la URL al detalle del cliente y de vuelta. */
const DETAIL_PARAMS = [
  'alyc',
  'from',
  'to',
  'granularity',
  'tipo',
  'manager',
  'advisor',
  'grupo_asesor',
  'excluir',
] as const;

function TotalsCell({ totals, currency, currencies }: { totals: Totals | undefined; currency: string; currencies: string[] }) {
  if (currency) {
    const v = totals?.[currency];
    return <>{v ? formatNumber(v) : '—'}</>;
  }
  const present = currencies.filter((cur) => totals?.[cur]);
  if (present.length === 0) return <>—</>;
  return (
    <>
      {present.map((cur) => (
        <div key={cur} className="whitespace-nowrap">
          {formatMoney(totals?.[cur] ?? 0, cur)}
        </div>
      ))}
    </>
  );
}

export default function ArancelesPorClientePage({
  searchParams,
}: {
  searchParams: Partial<Record<(typeof DETAIL_PARAMS)[number], string>>;
}) {
  const [filters, setFilters] = useState<ReportFilters>(() => ({
    ...EMPTY_REPORT_FILTERS,
    alyc: searchParams.alyc ?? '',
    from: searchParams.from ?? '',
    to: searchParams.to ?? '',
    tipo: searchParams.tipo ?? '',
    manager: searchParams.manager ?? '',
    advisor: searchParams.advisor ?? '',
    grupo_asesor: searchParams.grupo_asesor ?? '',
    excluir: searchParams.excluir ?? '',
    granularity: parseGranularity(searchParams.granularity),
  }));
  const [currency, setCurrency] = useState<string>(ALL_CURRENCIES);
  const [mode, setMode] = useState<Mode>('period');
  const [sortBy, setSortBy] = useState<SortBy>('total');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useArancelesReport<ClientPeriodReport>('client', filters);
  const report = data?.report;

  const rows = useMemo(() => {
    if (!report) return [];
    const q = clientKey(search);
    const list = report.clients.filter(
      (c) => (!q || c.key.includes(q)) && (!currency || (c.total[currency] ?? 0) !== 0)
    );
    const rankCurrencies = currency ? [currency] : report.currencies;
    return list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'es');
      for (const cur of rankCurrencies) {
        const diff = (b.total[cur] ?? 0) - (a.total[cur] ?? 0);
        if (diff !== 0) return diff;
      }
      return a.name.localeCompare(b.name, 'es');
    });
  }, [report, search, sortBy, currency]);

  const periodTotals = useMemo(() => {
    if (!report) return {};
    return mode === 'running' ? runningTotals(report.periods, report.periodTotals) : report.periodTotals;
  }, [report, mode]);

  const detailQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of DETAIL_PARAMS) {
      const v = filters[k];
      if (v && v !== EMPTY_REPORT_FILTERS[k]) p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [filters]);

  const isEmpty = data != null && data.importCount === 0;
  const currencies = report?.currencies ?? [];

  return (
    <div className="space-y-6">
      <ReportFiltersBar
        filters={filters}
        onChange={setFilters}
        alycs={data?.alycs ?? []}
        months={data?.months}
        clients={data?.clients ?? []}
        segmentOptions={data?.segmentOptions}
      >
        <label className="space-y-1 text-xs text-muted-foreground">
          Moneda del arancel
          <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value={ALL_CURRENCIES}>Todas</option>
            {currencies.map((cur) => (
              <option key={cur} value={cur}>
                {currencyLabel(cur)}
              </option>
            ))}
          </select>
        </label>
      </ReportFiltersBar>

      {loading && !data && <LoadingBlock label="Armando el reporte…" />}
      {error && <ErrorBlock message={error} onRetry={() => void reload()} />}

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

      {report && !isEmpty && (
        <Card className={loading ? 'opacity-60 transition-opacity' : undefined}>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle className="text-lg">Aranceles por cliente y período</CardTitle>
              <p className="text-sm text-muted-foreground">
                {mode === 'running'
                  ? 'Cada columna muestra lo acumulado desde el primer período del rango.'
                  : 'Cada columna muestra lo cobrado en el período; la última, el acumulado del rango.'}
                {currency ? ` Montos en ${currencyLabel(currency)}.` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-border p-0.5">
                {(
                  [
                    ['period', 'Del período'],
                    ['running', 'Acumulado'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={mode === value ? 'secondary' : 'ghost'}
                    className="h-7"
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <select
                className={`${inputClass} w-auto`}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                aria-label="Orden"
              >
                <option value="total">Mayor acumulado</option>
                <option value="name">Nombre</option>
              </select>
              <input
                className={`${inputClass} w-56`}
                placeholder="Buscar cliente…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">{formatNumber(rows.length)} clientes</span>
            </div>
          </CardHeader>
          <CardContent>
            {report.periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin operaciones en este corte.</p>
            ) : (
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-20 border-b bg-card text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="sticky left-0 z-10 min-w-[200px] bg-card p-2 text-left font-medium">Cliente</th>
                      {report.periods.map((p) => (
                        <th key={p} className="whitespace-nowrap p-2 text-right font-medium">
                          {formatPeriod(p)}
                        </th>
                      ))}
                      <th className="whitespace-nowrap border-l p-2 text-right font-medium">Acumulado</th>
                      <th className="p-2 text-right font-medium">Op.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const cells = mode === 'running' ? runningTotals(report.periods, c.byPeriod) : c.byPeriod;
                      return (
                        <tr key={c.key} className="group border-b border-border/50 hover:bg-muted/40">
                          <td className="sticky left-0 bg-card p-2 group-hover:bg-muted">
                            <Link
                              href={`/aranceles/por-cliente/${encodeURIComponent(c.key)}${detailQuery}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {c.name}
                            </Link>
                          </td>
                          {report.periods.map((p) => (
                            <td key={p} className="p-2 text-right align-top tabular-nums">
                              <TotalsCell totals={cells[p]} currency={currency} currencies={currencies} />
                            </td>
                          ))}
                          <td className="border-l p-2 text-right align-top font-medium tabular-nums">
                            <TotalsCell totals={c.total} currency={currency} currencies={currencies} />
                          </td>
                          <td className="p-2 text-right align-top tabular-nums text-muted-foreground">
                            {formatNumber(c.rows)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 bg-card">
                    <tr className="border-t-2 font-semibold">
                      <td className="sticky left-0 bg-card p-2">
                        {mode === 'running' ? 'Total acumulado' : 'Total del período'}
                      </td>
                      {report.periods.map((p) => (
                        <td key={p} className="p-2 text-right align-top tabular-nums">
                          <TotalsCell totals={periodTotals[p]} currency={currency} currencies={currencies} />
                        </td>
                      ))}
                      <td className="border-l p-2 text-right align-top tabular-nums">
                        <TotalsCell totals={report.totals} currency={currency} currencies={currencies} />
                      </td>
                      <td className="p-2 text-right align-top tabular-nums">
                        {formatNumber(report.clients.reduce((s, c) => s + c.rows, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
