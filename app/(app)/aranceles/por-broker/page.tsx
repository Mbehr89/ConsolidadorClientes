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
import { currencyLabel, formatNumber, formatPeriod } from '@/lib/aranceles/format';
import {
  REPORT_GROUP_BY,
  REPORT_GROUP_LABEL,
  type BrokerPeriodReport,
  type ReportGroupBy,
} from '@/lib/aranceles/reports';

function amount(v: number | undefined): string {
  return v ? formatNumber(v) : '—';
}

function startsGroup(report: BrokerPeriodReport, i: number): boolean {
  return i === 0 || report.columns[i - 1]?.groupKey !== report.columns[i]?.groupKey;
}

function startsAlyc(report: BrokerPeriodReport, i: number): boolean {
  return startsGroup(report, i) || report.columns[i - 1]?.alyc !== report.columns[i]?.alyc;
}

/** Línea fuerte entre grupos y tenue entre ALYCs del mismo grupo. */
function colBorder(report: BrokerPeriodReport, i: number): string {
  if (startsGroup(report, i)) return 'border-l';
  if (startsAlyc(report, i)) return 'border-l border-border/40';
  return '';
}

type HeaderSpan = { key: string; label: string; span: number; start: number };

function spans(report: BrokerPeriodReport | undefined, keyOf: (i: number) => string, labelOf: (i: number) => string) {
  const out: HeaderSpan[] = [];
  (report?.columns ?? []).forEach((_, i) => {
    const last = out[out.length - 1];
    const key = keyOf(i);
    if (last && last.key === key) last.span += 1;
    else out.push({ key, label: labelOf(i), span: 1, start: i });
  });
  return out;
}

export default function ArancelesPorBrokerPage() {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS);
  const { data, loading, error, reload } = useArancelesReport<BrokerPeriodReport>('broker', filters);
  const report = data?.report;
  const groupLabel = REPORT_GROUP_LABEL[data?.groupBy ?? filters.groupBy];

  const splitByAlyc = report?.columns.some((c) => c.alyc != null) ?? false;
  const headerRows = splitByAlyc ? 3 : 2;

  const columnGroups = useMemo(
    () =>
      spans(
        report,
        (i) => report?.columns[i]?.groupKey ?? '',
        (i) => report?.columns[i]?.group ?? ''
      ),
    [report]
  );

  const alycGroups = useMemo(
    () =>
      spans(
        report,
        (i) => `${report?.columns[i]?.groupKey}|${report?.columns[i]?.alyc}`,
        (i) => report?.columns[i]?.alyc ?? ''
      ),
    [report]
  );

  const isEmpty = data != null && data.importCount === 0;

  return (
    <div className="space-y-6">
      <ReportFiltersBar
        filters={filters}
        onChange={setFilters}
        alycs={data?.alycs ?? []}
        months={data?.months}
        segmentOptions={data?.segmentOptions}
      >
        <label className="space-y-1 text-xs text-muted-foreground">
          Agrupar columnas por
          <select
            className={inputClass}
            value={filters.groupBy}
            onChange={(e) => setFilters({ ...filters, groupBy: e.target.value as ReportGroupBy })}
          >
            {REPORT_GROUP_BY.map((g) => (
              <option key={g} value={g}>
                {REPORT_GROUP_LABEL[g]}
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
          <CardHeader>
            <CardTitle className="text-lg">Aranceles por moneda, {groupLabel.toLowerCase()} y período</CardTitle>
            <p className="text-sm text-muted-foreground">
              Montos en la moneda en que se cobró el arancel. {formatNumber(report.rows)} operaciones.
              {data?.groupBy && data.groupBy !== 'alyc' && ' Manager, advisor y grupo salen de Admin → Mapping cuentas.'}
            </p>
          </CardHeader>
          <CardContent>
            {report.periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin operaciones en este corte.</p>
            ) : (
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
                    <tr>
                      <th rowSpan={headerRows} className="border-b p-2 text-left font-medium">
                        Período
                      </th>
                      {columnGroups.map((g) => (
                        <th
                          key={g.key}
                          colSpan={g.span}
                          className="whitespace-nowrap border-b border-l p-2 text-center font-medium"
                        >
                          {g.label}
                        </th>
                      ))}
                      <th
                        rowSpan={headerRows - 1}
                        colSpan={report.currencies.length}
                        className="border-b border-l p-2 text-center align-bottom font-medium"
                      >
                        Total
                      </th>
                      <th rowSpan={headerRows} className="border-b border-l p-2 text-right font-medium">
                        Op.
                      </th>
                    </tr>
                    {splitByAlyc && (
                      <tr>
                        {alycGroups.map((g) => (
                          <th
                            key={g.key}
                            colSpan={g.span}
                            className={`whitespace-nowrap border-b p-1.5 text-center font-medium normal-case text-foreground/80 ${colBorder(
                              report,
                              g.start
                            )}`}
                          >
                            {g.label}
                          </th>
                        ))}
                      </tr>
                    )}
                    <tr>
                      {report.columns.map((col, i) => (
                        <th
                          key={col.key}
                          className={`whitespace-nowrap border-b p-2 text-right font-medium ${colBorder(report, i)}`}
                        >
                          {currencyLabel(col.currency)}
                        </th>
                      ))}
                      {report.currencies.map((cur, i) => (
                        <th
                          key={cur}
                          className={`whitespace-nowrap border-b p-2 text-right font-medium ${i === 0 ? 'border-l' : ''}`}
                        >
                          {currencyLabel(cur)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.periods.map((row) => (
                      <tr key={row.period} className="border-b border-border/50 hover:bg-muted/40">
                        <td className="whitespace-nowrap p-2 capitalize">{formatPeriod(row.period)}</td>
                        {report.columns.map((col, i) => (
                          <td
                            key={col.key}
                            className={`p-2 text-right tabular-nums ${colBorder(report, i)}`}
                          >
                            {amount(row.cells[col.key])}
                          </td>
                        ))}
                        {report.currencies.map((cur, i) => (
                          <td
                            key={cur}
                            className={`p-2 text-right font-medium tabular-nums ${i === 0 ? 'border-l' : ''}`}
                          >
                            {amount(row.totals[cur])}
                          </td>
                        ))}
                        <td className="border-l p-2 text-right tabular-nums text-muted-foreground">
                          {formatNumber(row.rows)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-card">
                    <tr className="border-t-2 font-semibold">
                      <td className="p-2">Total</td>
                      {report.columns.map((col, i) => (
                        <td
                          key={col.key}
                          className={`p-2 text-right tabular-nums ${colBorder(report, i)}`}
                        >
                          {amount(report.columnTotals[col.key])}
                        </td>
                      ))}
                      {report.currencies.map((cur, i) => (
                        <td key={cur} className={`p-2 text-right tabular-nums ${i === 0 ? 'border-l' : ''}`}>
                          {amount(report.totals[cur])}
                        </td>
                      ))}
                      <td className="border-l p-2 text-right tabular-nums">{formatNumber(report.rows)}</td>
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
