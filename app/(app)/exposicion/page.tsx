'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { BROKERS } from '@/lib/brokers';
import type { BrokerCode } from '@/lib/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCompact, formatCurrency, formatPct } from '@/lib/utils';
import {
  aggregateByField,
  concentrationFlags,
  monedaDimensionKey,
  topClients,
  topInstrumentGroups,
  totalAumUsd,
  uniqueInstrumentsCount,
  type InstrumentGroupRow,
} from '@/lib/analysis/exposure';
import { ExportExcelButton } from '@/components/export-excel-button';
import { ExportPdfButton } from '@/components/export-pdf-button';
import { BROKER_CHART_HEX, CHART_BLUES } from '@/lib/chartConfig';

type ScopeFilter = 'all' | 'local' | 'offshore';

const BROKER_OPTIONS: (BrokerCode | 'all')[] = ['all', 'MS', 'NETX360', 'GMA', 'IEB'];

export default function ExposicionPage() {
  const { state } = useConsolidation();
  const [brokerFilter, setBrokerFilter] = useState<BrokerCode | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');

  const filtered = useMemo(() => {
    let p = state.allPositions;
    if (brokerFilter !== 'all') {
      p = p.filter((x) => x.broker === brokerFilter);
    }
    if (scopeFilter !== 'all') {
      p = p.filter((x) => BROKERS[x.broker].tipo === scopeFilter);
    }
    return p;
  }, [state.allPositions, brokerFilter, scopeFilter]);

  const total = useMemo(() => totalAumUsd(filtered), [filtered]);

  const kpis = useMemo(() => {
    const nPos = filtered.length;
    const nTitulares = new Set(filtered.map((p) => p.cliente_id)).size;
    const nInst = uniqueInstrumentsCount(filtered);
    let aumOff = 0;
    let aumLoc = 0;
    for (const p of filtered) {
      const v = p.valor_mercado_usd ?? 0;
      if (BROKERS[p.broker].tipo === 'offshore') aumOff += v;
      else aumLoc += v;
    }
    const pctOff = total > 0 ? (aumOff / total) * 100 : 0;
    const pctLoc = total > 0 ? (aumLoc / total) * 100 : 0;
    return {
      total,
      nPos,
      nTitulares,
      nInst,
      pctOff,
      pctLoc,
    };
  }, [filtered, total]);

  const byMoneda = useMemo(
    () => aggregateByField(filtered, monedaDimensionKey),
    [filtered]
  );
  const byPaisEmisor = useMemo(() => {
    const withP = filtered.filter((p) => p.pais_emisor != null && p.pais_emisor !== '');
    return aggregateByField(withP, (p) => p.pais_emisor!);
  }, [filtered]);
  const byClase = useMemo(() => aggregateByField(filtered, (p) => p.clase_activo), [filtered]);
  const byBrokerTipo = useMemo(
    () => aggregateByField(filtered, (p) => BROKERS[p.broker].tipo),
    [filtered]
  );
  const byFormaLegal = useMemo(
    () => aggregateByField(filtered, (p) => p.forma_legal ?? 'sin clasificar'),
    [filtered]
  );
  const byBroker = useMemo(() => aggregateByField(filtered, (p) => p.broker), [filtered]);

  const topInst = useMemo(
    () => topInstrumentGroups(filtered, 15, true),
    [filtered]
  );
  const topCli = useMemo(() => topClients(filtered, 15), [filtered]);

  const flags = useMemo(
    () => concentrationFlags(filtered, { positionPct: 5, clientPct: 20 }),
    [filtered]
  );

  const exportOpts = useMemo(() => {
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = brokerFilter === 'all' ? 'todos' : brokerFilter;
    return {
      filename: `consolidado_exposicion_${b}_${scopeFilter}_${ymd}.xlsx`,
    };
  }, [brokerFilter, scopeFilter]);

  const exportPdfOpts = useMemo(() => {
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = brokerFilter === 'all' ? 'todos' : brokerFilter;
    return {
      filename: `consolidado_exposicion_${b}_${scopeFilter}_${ymd}.pdf`,
    };
  }, [brokerFilter, scopeFilter]);

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Exposición</h2>
        <p className="text-muted-foreground mt-4">
          Subí y parseá archivos en{' '}
          <Link href="/upload" className="text-primary underline">
            Upload
          </Link>{' '}
          para ver el risk dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="page-title">Exposición & riesgo</h2>
          <p className="page-subtitle">
            Distribución del AUM por dimensión (book filtrado: {filtered.length} posiciones).
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-xs text-muted-foreground uppercase font-medium">Broker</label>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm min-w-[140px]"
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value as BrokerCode | 'all')}
          >
            {BROKER_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b === 'all' ? 'Todos' : `${b} — ${BROKERS[b as BrokerCode].nombre}`}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground uppercase font-medium ml-2">Ámbito</span>
          <div className="flex rounded-md border border-border p-0.5 bg-muted/40">
            <Button
              type="button"
              variant={scopeFilter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setScopeFilter('all')}
            >
              Todo
            </Button>
            <Button
              type="button"
              variant={scopeFilter === 'local' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setScopeFilter('local')}
            >
              Local
            </Button>
            <Button
              type="button"
              variant={scopeFilter === 'offshore' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setScopeFilter('offshore')}
            >
              Offshore
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportExcelButton positions={filtered} options={exportOpts} size="sm" />
            <ExportPdfButton positions={filtered} options={exportPdfOpts} size="sm" />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard label="AUM total USD" value={formatCompact(kpis.total)} />
        <KpiCard label="Posiciones" value={kpis.nPos} />
        <KpiCard label="Clientes" value={kpis.nTitulares} />
        <KpiCard label="Instrumentos únicos" value={kpis.nInst} />
        <KpiCard label="% Offshore" value={formatPct(kpis.pctOff)} />
        <KpiCard label="% Local" value={formatPct(kpis.pctLoc)} />
      </div>

      {flags.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Concentración — alertas</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {flags.map((f, i) => (
              <p key={i} className="text-muted-foreground">
                <span className="font-medium text-foreground">{f.type === 'position' ? 'Instrumento' : 'Cliente'}:</span>{' '}
                {f.description}{' '}
                <span className="text-amber-700 dark:text-amber-400">
                  ({formatPct(f.value)} &gt; {f.threshold}%)
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Breakdowns */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Breakdowns</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BreakdownCard title="Por moneda (y subtipo)" data={byMoneda} total={total} />
          <BreakdownCard
            title="Por país emisor"
            data={byPaisEmisor}
            total={total}
            emptyHint="Ninguna posición con país emisor cargado."
          />
          <BreakdownCard title="Por clase de activo" data={byClase} total={total} />
          <BreakdownCard title="Por tipo de broker (local / offshore)" data={byBrokerTipo} total={total} />
          <BreakdownCard title="Por forma legal" data={byFormaLegal} total={total} />
          <BreakdownCard title="Por broker" data={byBroker} total={total} labelFn={(k) => `${k} — ${BROKERS[k as BrokerCode]?.nombre ?? k}`} />
        </div>
      </div>

      {/* Tablas concentración */}
      <div className="space-y-6">
        <h3 className="text-lg font-semibold">Concentración</h3>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 15 instrumentos (excl. cash)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Descripción</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">Valor USD</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">N° titulares</th>
                  </tr>
                </thead>
                <tbody>
                  {topInst.map((row) => (
                    <InstrumentRow key={row.key} row={row} high={row.pct_book > 5} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 15 clientes por AUM</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Titular</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">AUM USD</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">N° brokers</th>
                  </tr>
                </thead>
                <tbody>
                  {topCli.map((c) => (
                    <tr key={c.cliente_id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="p-3">
                        <Link href={`/clientes/${encodeURIComponent(c.cliente_id)}`} className="font-medium text-primary hover:underline">
                          {c.titular}
                        </Link>
                      </td>
                      <td className="p-3 text-right font-mono">{formatCurrency(c.aum_usd)}</td>
                      <td className="p-3 text-right">
                        {c.pct > 20 ? (
                          <Badge variant="destructive" className="font-mono">
                            {formatPct(c.pct)}
                          </Badge>
                        ) : (
                          <span className="font-mono text-muted-foreground">{formatPct(c.pct)}</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{c.brokers_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InstrumentRow({ row, high }: { row: InstrumentGroupRow; high: boolean }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/50">
      <td className="p-3 font-mono">
        {high ? (
          <Badge variant="destructive" className="font-mono">
            {row.ticker ?? '—'}
          </Badge>
        ) : (
          row.ticker ?? '—'
        )}
      </td>
      <td className="p-3 text-muted-foreground max-w-[280px] truncate" title={row.descripcion}>
        {row.descripcion}
      </td>
      <td className="p-3">
        <Badge variant="secondary" className="text-xs">
          {row.clase_activo}
        </Badge>
      </td>
      <td className="p-3 text-right font-mono">{formatCurrency(row.valor_usd)}</td>
      <td className="p-3 text-right font-mono text-muted-foreground">{formatPct(row.pct_book)}</td>
      <td className="p-3 text-right">{row.titulares_count}</td>
    </tr>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value font-mono">{value}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  total,
  emptyHint,
  labelFn,
}: {
  title: string;
  data: Record<string, number>;
  total: number;
  emptyHint?: string;
  labelFn?: (key: string) => string;
}) {
  const barFill = (key: string): { backgroundColor: string } => {
    const direct = BROKER_CHART_HEX[key];
    if (direct) return { backgroundColor: direct };
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i)) % CHART_BLUES.length;
    return { backgroundColor: CHART_BLUES[hash]! };
  };

  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{emptyHint ?? 'Sin datos.'}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {sorted.map(([key, value]) => {
            const pct = total > 0 ? (value / total) * 100 : 0;
            const label = labelFn ? labelFn(key) : key;
            return (
              <div key={key}>
                <div className="flex justify-between text-sm gap-2">
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span className="font-mono shrink-0">
                    {formatCompact(value)}{' '}
                    <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill transition-all"
                    style={{ width: `${Math.min(pct, 100)}%`, ...barFill(key) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
