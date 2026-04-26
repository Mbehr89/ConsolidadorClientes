'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { brokerColorClass, formatCompact, formatCurrency, formatPct, titularTipoClass } from '@/lib/utils';
import { BROKERS } from '@/lib/brokers';
import type { Position } from '@/lib/schema';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetrics } from '@/lib/bonds/metrics';
import { normalizeBondTicker } from '@/lib/bonds/ticker-normalize';
import { ExportExcelButton } from '@/components/export-excel-button';
import { ExportPdfButton } from '@/components/export-pdf-button';
import { exportExecutiveFlowReportPdf, exportFlowReportPdf } from '@/lib/export/flow-report';

function reviveEvents(raw: Array<Record<string, unknown>>): BondPaymentEvent[] {
  return raw.map((r) => ({
    asset: String(r.asset),
    issuer: r.issuer != null && String(r.issuer).trim() !== '' ? String(r.issuer).trim() : undefined,
    date: new Date(String(r.date)),
    currency: String(r.currency ?? 'USD'),
    flowPer100: Number(r.flowPer100),
    couponPer100: r.couponPer100 != null ? Number(r.couponPer100) : undefined,
    amortizationPer100: r.amortizationPer100 != null ? Number(r.amortizationPer100) : undefined,
    residualPctOfPar: r.residualPctOfPar != null ? Number(r.residualPctOfPar) : undefined,
  }));
}

export default function ClienteDetailPage() {
  const params = useParams();
  const clienteId = params.id as string;
  const { state } = useConsolidation();
  const [bondEvents, setBondEvents] = useState<BondPaymentEvent[]>([]);
  const [sortBy, setSortBy] = useState<'valor_usd' | 'pct_portfolio' | 'clase'>('valor_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [cashExpanded, setCashExpanded] = useState(false);
  const [flowPdfSections, setFlowPdfSections] = useState({
    monthlyByBond: true,
    annualDualAxis: true,
    flowTable: true,
  });

  const positions = useMemo(
    () => state.allPositions.filter(p => p.cliente_id === clienteId),
    [state.allPositions, clienteId]
  );
  const exportFilename = useMemo(() => {
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const safe = clienteId.replace(/[^\w.-]+/g, '_').slice(0, 48);
    return `consolidado_cliente_${safe}_${ymd}.xlsx`;
  }, [clienteId]);
  const exportPdfFilename = useMemo(() => exportFilename.replace(/\.xlsx$/i, '.pdf'), [exportFilename]);

  const titular = positions[0]?.titular ?? '';
  const tipoTitular = positions[0]?.tipo_titular ?? 'persona';
  const grupoId = positions[0]?.grupo_id ?? null;
  const grupo = grupoId ? state.grupos.find((g) => g.id === grupoId) : null;
  const totalUsd = positions.reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0);

  // Breakdowns
  const byBroker = aggregate(positions, p => p.broker);
  const byClase = aggregate(positions, p => p.clase_activo);
  const byMoneda = aggregate(positions, p => p.moneda + (p.moneda_subtipo ? ` (${p.moneda_subtipo})` : ''));
  const byTipo = aggregate(positions, p => BROKERS[p.broker]?.tipo ?? 'unknown');
  const byFormaLegal = aggregate(positions, p => p.forma_legal ?? 'n/a');

  // Cuentas
  const cuentas = [...new Set(positions.map(p => `${p.broker} — ${p.cuenta}`))];

  // Warnings
  const allWarnings = positions.flatMap(p => p.warnings.map(w => ({ warning: w, ticker: p.ticker, broker: p.broker })));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/bonds/calendar', { cache: 'no-store' });
        const data = (await res.json()) as { events?: Array<Record<string, unknown>> };
        if (!cancelled && data.events) setBondEvents(reviveEvents(data.events));
      } catch {
        if (!cancelled) setBondEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bondMetricsByRow = useMemo(() => {
    const out = new Map<number, ReturnType<typeof computeBondYieldMetrics>>();
    const now = new Date();
    const valuationDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (const p of positions) {
      if (!(p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra')) continue;
      if (!p.ticker) continue;
      const nominal = Number.isFinite(p.cantidad) && p.cantidad > 0 ? p.cantidad : 100;
      const fxFromPosition =
        p.valor_mercado_usd != null && p.valor_mercado_usd > 0 && p.valor_mercado_local > 0
          ? p.valor_mercado_local / p.valor_mercado_usd
          : 1;
      const usdArsFxRate = Number.isFinite(fxFromPosition) && fxFromPosition > 0 ? fxFromPosition : 1;
      const unitPriceUsdFromStatement =
        p.precio_mercado != null && Number.isFinite(p.precio_mercado)
          ? (p.moneda === 'USD' ? p.precio_mercado : p.precio_mercado / usdArsFxRate)
          : null;
      const unitPriceUsdFromValuation =
        nominal > 0 && p.valor_mercado_usd != null && Number.isFinite(p.valor_mercado_usd)
          ? p.valor_mercado_usd / nominal
          : null;
      const unitPriceUsd = unitPriceUsdFromStatement ?? unitPriceUsdFromValuation;
      if (unitPriceUsd == null || !Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) continue;
      const dirtyPricePer100 = unitPriceUsd * 100;
      const metrics = computeBondYieldMetrics(
        bondEvents,
        normalizeBondTicker(p.ticker),
        valuationDate,
        dirtyPricePer100,
        nominal,
        usdArsFxRate
      );
      out.set(p.source_row, metrics);
    }
    return out;
  }, [positions, bondEvents]);

  const bondPortfolioAgg = useMemo(() => {
    const bondRows = positions.filter(
      (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
    );
    const rowsWithMetrics = bondRows
      .map((p) => ({ p, m: bondMetricsByRow.get(p.source_row) }))
      .filter(({ p, m }) => (p.valor_mercado_usd ?? 0) > 0 && m != null);

    const summarize = (subset: typeof rowsWithMetrics) => {
      const ytmRows = subset.filter(
        ({ m }) => m?.ytmAnnualEffective != null && Number.isFinite(m.ytmAnnualEffective)
      );
      const durRows = subset.filter(
        ({ m }) => m?.modifiedDuration != null && Number.isFinite(m.modifiedDuration)
      );
      const sumYtmUsd = ytmRows.reduce((s, x) => s + (x.p.valor_mercado_usd ?? 0), 0);
      const sumDurUsd = durRows.reduce((s, x) => s + (x.p.valor_mercado_usd ?? 0), 0);
      const ytm =
        sumYtmUsd > 0
          ? ytmRows.reduce(
              (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumYtmUsd) * (x.m!.ytmAnnualEffective as number),
              0
            )
          : null;
      const modDuration =
        sumDurUsd > 0
          ? durRows.reduce(
              (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumDurUsd) * (x.m!.modifiedDuration as number),
              0
            )
          : null;
      const covered = subset.filter(
        ({ m }) =>
          (m?.ytmAnnualEffective != null && Number.isFinite(m.ytmAnnualEffective)) ||
          (m?.modifiedDuration != null && Number.isFinite(m.modifiedDuration))
      ).length;
      return { ytm, modDuration, covered };
    };

    const paymentCurrencyByTicker = new Map<string, 'ARS' | 'USD'>();
    for (const ev of bondEvents) {
      const key = normalizeBondTicker(ev.asset);
      if (paymentCurrencyByTicker.has(key)) continue;
      const c = ev.currency.toUpperCase();
      paymentCurrencyByTicker.set(key, c.includes('ARS') || c.includes('PESO') ? 'ARS' : 'USD');
    }

    const arsEligible = rowsWithMetrics.filter(({ p }) => {
      const ticker = normalizeBondTicker(p.ticker);
      return paymentCurrencyByTicker.get(ticker) === 'ARS';
    });
    const usdEligible = rowsWithMetrics.filter(({ p }) => {
      const ticker = normalizeBondTicker(p.ticker);
      return paymentCurrencyByTicker.get(ticker) === 'USD';
    });
    const overall = summarize(rowsWithMetrics);
    return {
      overall,
      ars: summarize(arsEligible),
      usd: summarize(usdEligible),
      covered: overall.covered,
      totalBondRows: bondRows.length,
    };
  }, [positions, bondMetricsByRow, bondEvents]);

  const executivePortfolioMetrics = useMemo(() => {
    const bondRows = positions.filter(
      (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
    );
    const withMetrics = bondRows.map((p) => ({ p, m: bondMetricsByRow.get(p.source_row) }));
    const ytmRows = withMetrics.filter(
      ({ p, m }) =>
        (p.valor_mercado_usd ?? 0) > 0 &&
        m?.ytmAnnualEffective != null &&
        Number.isFinite(m.ytmAnnualEffective)
    );
    const durRows = withMetrics.filter(
      ({ p, m }) =>
        (p.valor_mercado_usd ?? 0) > 0 &&
        m?.modifiedDuration != null &&
        Number.isFinite(m.modifiedDuration)
    );
    const sumYtmUsd = ytmRows.reduce((s, x) => s + (x.p.valor_mercado_usd ?? 0), 0);
    const sumDurUsd = durRows.reduce((s, x) => s + (x.p.valor_mercado_usd ?? 0), 0);
    const ytm =
      sumYtmUsd > 0
        ? ytmRows.reduce(
            (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumYtmUsd) * (x.m!.ytmAnnualEffective as number),
            0
          )
        : null;
    const duration =
      sumDurUsd > 0
        ? durRows.reduce(
            (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumDurUsd) * (x.m!.modifiedDuration as number),
            0
          )
        : null;
    return { ytm, duration };
  }, [positions, bondMetricsByRow]);

  const mappedBondFlows = useMemo(() => {
    const bondPositions = positions.filter(
      (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
    );
    const nominalByTicker = new Map<string, number>();
    for (const p of bondPositions) {
      const t = normalizeBondTicker(p.ticker);
      if (!t) continue;
      const n = Number.isFinite(p.cantidad) ? p.cantidad : 0;
      nominalByTicker.set(t, (nominalByTicker.get(t) ?? 0) + n);
    }
    const portfolioBondTickers = new Set([...nominalByTicker.keys()]);
    const rows = bondEvents
      .filter((ev) => portfolioBondTickers.has(normalizeBondTicker(ev.asset)))
      .map((ev) => {
        const nominal = nominalByTicker.get(normalizeBondTicker(ev.asset)) ?? 0;
        const intereses = ((ev.couponPer100 ?? 0) / 100) * nominal;
        const amortizacion = ((ev.amortizationPer100 ?? 0) / 100) * nominal;
        return { ev, intereses, amortizacion };
      })
      .sort((a, b) => {
        const t = a.ev.asset.localeCompare(b.ev.asset);
        if (t !== 0) return t;
        return a.ev.date.getTime() - b.ev.date.getTime();
      });
    return {
      rows,
      mappedTickers: new Set(rows.map((r) => r.ev.asset)).size,
      totalTickers: portfolioBondTickers.size,
    };
  }, [positions, bondEvents]);

  const bondFlowDebug = useMemo(() => {
    const bondPositions = positions.filter(
      (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
    );
    const portfolioTickers = [...new Set(bondPositions.map((p) => normalizeBondTicker(p.ticker)).filter(Boolean))];
    const calendarTickers = new Set(bondEvents.map((ev) => normalizeBondTicker(ev.asset)).filter(Boolean));
    const missingTickers = portfolioTickers.filter((t) => !calendarTickers.has(t));
    const ytmCount = bondPositions.filter((p) => {
      const m = bondMetricsByRow.get(p.source_row);
      return m?.ytmAnnualEffective != null && Number.isFinite(m.ytmAnnualEffective);
    }).length;
    const durationCount = bondPositions.filter((p) => {
      const m = bondMetricsByRow.get(p.source_row);
      return m?.modifiedDuration != null && Number.isFinite(m.modifiedDuration);
    }).length;
    return {
      portfolioTickers: portfolioTickers.length,
      calendarTickers: calendarTickers.size,
      missingTickers,
      ytmCount,
      durationCount,
      totalBondRows: bondPositions.length,
    };
  }, [positions, bondEvents, bondMetricsByRow]);

  const flowTotalsByCurrency = useMemo(() => {
    const totals = new Map<string, { intereses: number; amortizacion: number }>();
    for (const r of mappedBondFlows.rows) {
      const c = r.ev.currency.toUpperCase();
      const prev = totals.get(c) ?? { intereses: 0, amortizacion: 0 };
      prev.intereses += r.intereses;
      prev.amortizacion += r.amortizacion;
      totals.set(c, prev);
    }
    return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappedBondFlows]);

  const bondCurrentValueUsd = useMemo(() => {
    return positions
      .filter((p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra')
      .reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0);
  }, [positions]);

  const bondFutureValueUsd = useMemo(() => {
    return mappedBondFlows.rows.reduce((s, r) => s + r.intereses + r.amortizacion, 0);
  }, [mappedBondFlows]);

  const sortedCashPositions = useMemo(() => {
    const list = positions.filter((p) => isCashLike(p));
    list.sort((a, b) => {
      const cashCmp = getCashBucketLabel(a).localeCompare(getCashBucketLabel(b));
      if (cashCmp !== 0) return cashCmp;
      return (b.valor_mercado_usd ?? 0) - (a.valor_mercado_usd ?? 0);
    });
    return list;
  }, [positions]);

  const sortedNonCashPositions = useMemo(() => {
    const list = positions.filter((p) => !isCashLike(p));
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'clase') {
        cmp = a.clase_activo.localeCompare(b.clase_activo);
      } else if (sortBy === 'pct_portfolio') {
        const pa = totalUsd > 0 ? ((a.valor_mercado_usd ?? 0) / totalUsd) * 100 : 0;
        const pb = totalUsd > 0 ? ((b.valor_mercado_usd ?? 0) / totalUsd) * 100 : 0;
        cmp = pa - pb;
      } else {
        cmp = (a.valor_mercado_usd ?? 0) - (b.valor_mercado_usd ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [positions, sortBy, sortDir, totalUsd]);

  const cashTotals = useMemo(() => {
    const count = sortedCashPositions.length;
    const usd = sortedCashPositions.reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0);
    const ars = sortedCashPositions.reduce((s, p) => s + getArsValuationNumber(p), 0);
    return { count, usd, ars };
  }, [sortedCashPositions]);

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="text-2xl font-bold">Cliente</h2>
        <p className="text-muted-foreground mt-4">
          Subí archivos en{' '}
          <Link href="/upload" className="text-primary underline">
            Upload
          </Link>{' '}
          primero.
        </p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">
          ← Volver a clientes
        </Link>
        <h2 className="text-2xl font-bold mt-4">Cliente no encontrado</h2>
        <p className="text-muted-foreground mt-2">ID: {clienteId}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">← Volver a clientes</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">{titular}</h2>
          <Badge variant="outline" className={titularTipoClass(tipoTitular)}>
              {tipoTitular === 'juridica' ? 'Jurídica' : 'Persona'}
            </Badge>
            {grupo && (
              <Link href={`/clientes/grupo/${encodeURIComponent(grupo.id)}`}>
                <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                  Grupo: {grupo.nombre}
                </Badge>
              </Link>
            )}
            {grupoId && !grupo && (
              <Badge variant="outline" title={grupoId}>
                Grupo (sin nombre en config)
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportExcelButton positions={positions} options={{ filename: exportFilename }} size="sm" />
            <ExportPdfButton
              positions={positions}
              clienteId={clienteId}
              options={{ filename: exportPdfFilename }}
              size="sm"
            />
          </div>
        </div>
        <p className="text-muted-foreground mt-1">
          {cuentas.length} cuenta{cuentas.length > 1 ? 's' : ''}: {cuentas.join(' · ')}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="AUM Total (USD)" value={formatCompact(totalUsd)} />
        <KpiCard label="Posiciones" value={positions.length} />
        <KpiCard label="Brokers" value={Object.keys(byBroker).length} />
        <KpiCard label="Warnings" value={allWarnings.length} variant={allWarnings.length > 0 ? 'warning' : 'default'} />
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Resumen bonos del portfolio (con flujo)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Bonos ARS — TIR agregada</p>
            <p className="font-mono text-lg">{formatYtmPct(bondPortfolioAgg.ars.ytm)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Duration: <span className="font-mono">{formatNumberOrDash(bondPortfolioAgg.ars.modDuration)}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bonos USD — TIR agregada</p>
            <p className="font-mono text-lg">{formatYtmPct(bondPortfolioAgg.usd.ytm)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Duration: <span className="font-mono">{formatNumberOrDash(bondPortfolioAgg.usd.modDuration)}</span>
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground">Cobertura de activos con flujo encontrado</p>
            <p className="font-mono text-lg">
              {bondPortfolioAgg.covered}/{bondPortfolioAgg.totalBondRows}
            </p>
            <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-mono">
                Debug · tickers cartera: {bondFlowDebug.portfolioTickers} · tickers calendario: {bondFlowDebug.calendarTickers}
                {' '}· TIR ok: {bondFlowDebug.ytmCount}/{bondFlowDebug.totalBondRows} · Duration ok: {bondFlowDebug.durationCount}/{bondFlowDebug.totalBondRows}
              </p>
              {bondFlowDebug.missingTickers.length > 0 && (
                <p className="mt-1 font-mono">
                  Sin match en calendario: {bondFlowDebug.missingTickers.slice(0, 12).join(', ')}
                  {bondFlowDebug.missingTickers.length > 12 ? ' ...' : ''}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownCard title="Por Broker" data={byBroker} total={totalUsd} />
        <BreakdownCard title="Por Clase de Activo" data={byClase} total={totalUsd} />
        <BreakdownCard title="Por Moneda" data={byMoneda} total={totalUsd} />
        <BreakdownCard title="Local vs Offshore" data={byTipo} total={totalUsd} />
        <BreakdownCard title="Por Forma Legal" data={byFormaLegal} total={totalUsd} />
      </div>

      {/* All positions */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Todas las posiciones ({positions.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Ordenar por</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'valor_usd' | 'pct_portfolio' | 'clase')}
                className="mt-1 h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="valor_usd">Valor USD</option>
                <option value="pct_portfolio">% Portfolio</option>
                <option value="clase">Clase</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dirección</label>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                className="mt-1 h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="desc">Descendente</option>
                <option value="asc">Ascendente</option>
              </select>
            </div>
          </div>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full min-w-[1700px] text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Broker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Cuenta</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Cant.</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Precio ARS</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Precio USD</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valor USD</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valor ARS</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Forma Legal</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">% Portfolio</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Moneda</th>
                  <th className="p-2 text-xs font-medium text-muted-foreground uppercase">⚠</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">TIR</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Dur. mod.</th>
                </tr>
              </thead>
              <tbody>
                {cashTotals.count > 0 && (
                  <tr className="border-b border-border/70 bg-muted/20">
                    <td className="p-2">
                      <Badge variant="outline" className="font-semibold">CASH</Badge>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">—</td>
                    <td className="p-2">
                      <button
                        type="button"
                        className="font-mono text-sm text-primary hover:underline"
                        onClick={() => setCashExpanded((v) => !v)}
                      >
                        {cashExpanded ? '▼' : '▶'} CASH agregado ({cashTotals.count} posiciones)
                      </button>
                    </td>
                    <td className="p-2">
                      <Badge variant="secondary" className="text-xs">cash</Badge>
                    </td>
                    <td className="p-2 text-right font-mono">—</td>
                    <td className="p-2 text-right font-mono">—</td>
                    <td className="p-2 text-right font-mono">—</td>
                    <td className="p-2 text-right font-mono font-medium">{formatCurrency(cashTotals.usd)}</td>
                    <td className="p-2 text-right font-mono">
                      {cashTotals.ars.toLocaleString('es-AR', {
                        style: 'currency',
                        currency: 'ARS',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">—</td>
                    <td className="p-2 text-right text-muted-foreground">
                      {totalUsd > 0 ? formatPct((cashTotals.usd / totalUsd) * 100) : '—'}
                    </td>
                    <td className="p-2 text-xs">Mixto</td>
                    <td className="p-2">—</td>
                    <td className="p-2 text-right font-mono">—</td>
                    <td className="p-2 text-right font-mono">—</td>
                  </tr>
                )}
                {cashExpanded && sortedCashPositions.map((p) => (
                  <tr key={`cash-${p.source_row}`} className="border-b border-border/40 bg-muted/10 hover:bg-muted/40">
                    <td className="p-2"><Badge variant="outline" className={brokerColorClass(p.broker)}>{p.broker}</Badge></td>
                    <td className="p-2 text-xs font-mono text-muted-foreground">{p.cuenta}</td>
                    <td className="p-2 font-mono">
                      CASH · <span className="text-xs text-muted-foreground">{getCashBucketLabel(p)}</span>
                    </td>
                    <td className="p-2"><Badge variant="secondary" className="text-xs">{p.clase_activo}</Badge></td>
                    <td className="p-2 text-right font-mono">{p.cantidad.toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{formatArsPrice(p)}</td>
                    <td className="p-2 text-right font-mono">{formatUsdPrice(p)}</td>
                    <td className="p-2 text-right font-mono font-medium">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
                    <td className="p-2 text-right font-mono">{formatArsValuation(p)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{p.forma_legal ?? '—'}</td>
                    <td className="p-2 text-right text-muted-foreground">
                      {totalUsd > 0 ? formatPct(((p.valor_mercado_usd ?? 0) / totalUsd) * 100) : '—'}
                    </td>
                    <td className="p-2 text-xs">{p.moneda}{p.moneda_subtipo ? ` (${p.moneda_subtipo})` : ''}</td>
                    <td className="p-2">{p.warnings.length > 0 && <span className="text-amber-500" title={p.warnings.join('\n')}>⚠ {p.warnings.length}</span>}</td>
                    <td className="p-2 text-right font-mono">{formatYtmPct(bondMetricsByRow.get(p.source_row)?.ytmAnnualEffective)}</td>
                    <td className="p-2 text-right font-mono">{formatNumberOrDash(bondMetricsByRow.get(p.source_row)?.modifiedDuration)}</td>
                  </tr>
                ))}
                {sortedNonCashPositions.map((p) => (
                  <tr key={p.source_row} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="p-2"><Badge variant="outline" className={brokerColorClass(p.broker)}>{p.broker}</Badge></td>
                    <td className="p-2 text-xs font-mono text-muted-foreground">{p.cuenta}</td>
                    <td className="p-2 font-mono">{p.ticker ?? '—'}</td>
                    <td className="p-2"><Badge variant="secondary" className="text-xs">{p.clase_activo}</Badge></td>
                    <td className="p-2 text-right font-mono">{p.cantidad.toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{formatArsPrice(p)}</td>
                    <td className="p-2 text-right font-mono">{formatUsdPrice(p)}</td>
                    <td className="p-2 text-right font-mono font-medium">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
                    <td className="p-2 text-right font-mono">{formatArsValuation(p)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{p.forma_legal ?? '—'}</td>
                    <td className="p-2 text-right text-muted-foreground">
                      {totalUsd > 0 ? formatPct(((p.valor_mercado_usd ?? 0) / totalUsd) * 100) : '—'}
                    </td>
                    <td className="p-2 text-xs">{p.moneda}{p.moneda_subtipo ? ` (${p.moneda_subtipo})` : ''}</td>
                    <td className="p-2">{p.warnings.length > 0 && <span className="text-amber-500" title={p.warnings.join('\n')}>⚠ {p.warnings.length}</span>}</td>
                    <td className="p-2 text-right font-mono">{formatYtmPct(bondMetricsByRow.get(p.source_row)?.ytmAnnualEffective)}</td>
                    <td className="p-2 text-right font-mono">{formatNumberOrDash(bondMetricsByRow.get(p.source_row)?.modifiedDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Flujo completo de bonos mapeados</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tickers mapeados: {mappedBondFlows.mappedTickers}/{mappedBondFlows.totalTickers}
          </p>
          <div>
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={flowPdfSections.monthlyByBond}
                  onChange={(e) => setFlowPdfSections((s) => ({ ...s, monthlyByBond: e.target.checked }))}
                />
                Grafico mensual por bono
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={flowPdfSections.annualDualAxis}
                  onChange={(e) => setFlowPdfSections((s) => ({ ...s, annualDualAxis: e.target.checked }))}
                />
                Vencimientos anuales (doble eje)
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={flowPdfSections.flowTable}
                  onChange={(e) => setFlowPdfSections((s) => ({ ...s, flowTable: e.target.checked }))}
                />
                Tabla de flujo
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!flowPdfSections.monthlyByBond && !flowPdfSections.annualDualAxis && !flowPdfSections.flowTable}
                onClick={() =>
                  exportFlowReportPdf({
                    title: `Flujo de bonos — ${titular}`,
                    rows: mappedBondFlows.rows.map((r) => ({
                      ticker: r.ev.asset,
                      date: fmtIsoDate(r.ev.date),
                      currency: r.ev.currency,
                      intereses: r.intereses,
                      amortizacion: r.amortizacion,
                    })),
                    totalsByCurrency: flowTotalsByCurrency,
                    portfolioMetrics: {
                      ytm: bondPortfolioAgg.overall.ytm,
                      duration: bondPortfolioAgg.overall.modDuration,
                      arsYtm: bondPortfolioAgg.ars.ytm,
                      arsDuration: bondPortfolioAgg.ars.modDuration,
                      usdYtm: bondPortfolioAgg.usd.ytm,
                      usdDuration: bondPortfolioAgg.usd.modDuration,
                    },
                    sections: flowPdfSections,
                  })
                }
              >
                Exportar flujo PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  exportExecutiveFlowReportPdf({
                    portfolioId: clienteId,
                    clientName: titular,
                    rows: mappedBondFlows.rows.map((r) => ({
                      ticker: r.ev.asset,
                      date: fmtIsoDate(r.ev.date),
                      currency: r.ev.currency,
                      intereses: r.intereses,
                      amortizacion: r.amortizacion,
                    })),
                    tirValue: executivePortfolioMetrics.ytm,
                    durationValue: executivePortfolioMetrics.duration,
                    arsTirValue: bondPortfolioAgg.ars.ytm,
                    arsDurationValue: bondPortfolioAgg.ars.modDuration,
                    usdTirValue: bondPortfolioAgg.usd.ytm,
                    usdDurationValue: bondPortfolioAgg.usd.modDuration,
                    currentValueUsd: bondCurrentValueUsd,
                    futureValueUsd: bondFutureValueUsd,
                  })
                }
              >
                Exportar PDF ejecutivo
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {flowTotalsByCurrency.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-4 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              {flowTotalsByCurrency.map(([currency, t]) => (
                <div key={currency} className="font-mono">
                  <span className="text-muted-foreground">{currency}</span> · Int. {formatPaymentAmount(t.intereses)} ·
                  Amort. {formatPaymentAmount(t.amortizacion)} · Total{' '}
                  {formatPaymentAmount(t.intereses + t.amortizacion)}
                </div>
              ))}
            </div>
          )}
          {flowTotalsByCurrency.length > 0 && (
            <div className="mb-4 space-y-4">
              {flowTotalsByCurrency.map(([currency]) => {
                const rows = mappedBondFlows.rows.filter((r) => r.ev.currency.toUpperCase() === currency.toUpperCase());
                const monthMap = new Map<string, { intereses: number; amortizacion: number }>();
                for (const r of rows) {
                  const month = fmtIsoDate(r.ev.date).slice(0, 7);
                  const prev = monthMap.get(month) ?? { intereses: 0, amortizacion: 0 };
                  prev.intereses += r.intereses;
                  prev.amortizacion += r.amortizacion;
                  monthMap.set(month, prev);
                }
                const monthlyRows = [...monthMap.entries()]
                  .map(([month, v]) => ({ month, ...v }))
                  .sort((a, b) => a.month.localeCompare(b.month));
                const max = Math.max(...monthlyRows.map((r) => r.intereses + r.amortizacion), 1);
                return (
                  <div key={currency} className="rounded-md border border-border/60 p-3">
                    <p className="mb-2 text-sm font-medium">Grafico mensual {currency}</p>
                    <div className="space-y-1">
                      {monthlyRows.slice(0, 40).map((r, i) => {
                        const total = r.intereses + r.amortizacion;
                        const wt = max > 0 ? (total / max) * 100 : 0;
                        const wi = total > 0 ? (r.intereses / total) * wt : 0;
                        const wa = total > 0 ? (r.amortizacion / total) * wt : 0;
                        const minSegment = 0.8;
                        const wii = r.intereses > 0 ? Math.max(wi, minSegment) : 0;
                        const waa = r.amortizacion > 0 ? Math.max(wa, minSegment) : 0;
                        const scale = wii + waa > 0 ? Math.min(1, wt / (wii + waa)) : 1;
                        return (
                          <div key={`${currency}-${i}`} className="grid grid-cols-[170px_1fr_120px] items-center gap-2 text-xs">
                            <span className="truncate text-muted-foreground">
                              {r.month}
                            </span>
                            <div className="flex h-2 overflow-hidden rounded bg-muted">
                              <div className="bg-blue-500" style={{ width: `${wii * scale}%` }} />
                              <div className="bg-emerald-500" style={{ width: `${waa * scale}%` }} />
                            </div>
                            <span className="text-right font-mono">{formatPaymentAmount(total)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Fecha</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Moneda pago</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Intereses recibidos</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Amortización recibida</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Total</th>
                </tr>
              </thead>
              <tbody>
                {mappedBondFlows.rows.map((row, i) => (
                  <tr key={`${row.ev.asset}-${row.ev.date.toISOString()}-${i}`} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="p-2 font-mono">{row.ev.asset}</td>
                    <td className="p-2">{fmtIsoDate(row.ev.date)}</td>
                    <td className="p-2">{row.ev.currency}</td>
                    <td className="p-2 text-right font-mono">{formatPaymentAmount(row.intereses)}</td>
                    <td className="p-2 text-right font-mono">{formatPaymentAmount(row.amortizacion)}</td>
                    <td className="p-2 text-right font-mono">{formatPaymentAmount(row.intereses + row.amortizacion)}</td>
                  </tr>
                ))}
                {mappedBondFlows.rows.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={6}>
                      No se encontraron flujos mapeados para bonos del portfolio.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helper components ──────────────────────────────────

function KpiCard({ label, value, variant = 'default' }: { label: string; value: string | number; variant?: 'default' | 'warning' }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <p className={`kpi-value font-mono ${variant === 'warning' ? 'text-amber-600' : ''}`}>{value}</p>
    </div>
  );
}

function BreakdownCard({ title, data, total }: { title: string; data: Record<string, number>; total: number }) {
  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map(([key, value]) => {
            const pct = total > 0 ? (value / total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-sm">
                  <span>{key}</span>
                  <span className="font-mono">{formatCompact(value)} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span></span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function aggregate(positions: Position[], keyFn: (p: Position) => string): Record<string, number> {
  return positions.reduce<Record<string, number>>((acc, p) => {
    const key = keyFn(p);
    acc[key] = (acc[key] ?? 0) + (p.valor_mercado_usd ?? 0);
    return acc;
  }, {});
}

function formatArsPrice(p: Position): string {
  if (p.moneda === 'ARS' && p.precio_mercado != null && Number.isFinite(p.precio_mercado)) {
    return `${p.precio_mercado.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })} ARS`;
  }
  if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || !Number.isFinite(p.valor_mercado_local)) return '—';
  const arsPrice = p.valor_mercado_local / p.cantidad;
  if (!Number.isFinite(arsPrice)) return '—';
  return `${arsPrice.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} ARS`;
}

function formatUsdPrice(p: Position): string {
  if (p.moneda === 'USD' && p.precio_mercado != null && Number.isFinite(p.precio_mercado)) {
    return `${p.precio_mercado.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })} USD`;
  }
  if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || p.valor_mercado_usd == null) return '—';
  const usdPrice = p.valor_mercado_usd / p.cantidad;
  if (!Number.isFinite(usdPrice)) return '—';
  return `${usdPrice.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USD`;
}

function formatArsValuation(p: Position): string {
  const arsValue = getArsValuationNumber(p);
  if (arsValue == null || !Number.isFinite(arsValue)) return '—';
  return arsValue.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getArsValuationNumber(p: Position): number {
  if (Number.isFinite(p.valor_mercado_local) && p.valor_mercado_local > 0 && p.moneda === 'ARS') {
    return p.valor_mercado_local;
  }
  if (
    p.valor_mercado_usd != null &&
    Number.isFinite(p.valor_mercado_usd) &&
    p.valor_mercado_usd > 0 &&
    Number.isFinite(p.valor_mercado_local) &&
    p.valor_mercado_local > 0
  ) {
    // Usa el FX implícito de la fila para llevar la valuación a ARS.
    const fx = p.valor_mercado_local / p.valor_mercado_usd;
    return p.valor_mercado_usd * fx;
  }
  if (p.valor_mercado_usd != null && Number.isFinite(p.valor_mercado_usd) && p.valor_mercado_usd > 0) {
    // Fallback conservador si no hay valuación local: asumir 1:1.
    return p.valor_mercado_usd;
  }
  return 0;
}

function isCashLike(p: Position): boolean {
  return p.clase_activo === 'cash' || (p.ticker ?? '').toUpperCase() === 'CASH';
}

function getCashBucketLabel(p: Position): string {
  if (!isCashLike(p)) return 'No cash';
  const sub = (p.moneda_subtipo ?? '').trim().toLowerCase();
  const desc = (p.descripcion ?? '').toLowerCase();

  // IEB / unificado: MM explícito por moneda (antes de ARS/USD genérico).
  if (sub === 'money_market_ars') return 'Money market ARS';
  if (sub === 'money_market_usd') return 'Money market USD';
  if (sub === 'ars') return 'ARS';
  if (sub === 'usd') return 'USD';
  if (sub === '7000' || /\b7000\b|dolar\s*7000|especie\s*7000/.test(desc)) return 'Especie 7000';
  if (sub === '10000' || /\b10000\b|dolar\s*10000|especie\s*10000/.test(desc)) return 'Especie 10000';
  if (sub === 'cable' || /cable|d[oó]lar\s*cable/.test(desc)) return 'Cable';
  if (sub === 'mep' || /\bmep\b|d[oó]lar\s*mep/.test(desc)) return 'USD MEP';
  if (sub === 'money_market' || sub === 'money market' || /money\s*market|\bmmf\b/.test(desc)) {
    if (p.moneda === 'ARS') return 'Money market ARS';
    if (p.moneda === 'USD') return 'Money market USD';
    return 'Money market';
  }
  if (sub === 'usd_cash' || sub === 'usd cash') return 'USD cash';
  if (sub === 'eur' || p.moneda === 'EUR') return 'EUR';
  if (p.moneda === 'ARS' && (!sub || sub === 'ars')) return 'ARS';
  if (p.moneda === 'USD') return 'USD';
  if (p.moneda === 'ARS') return 'ARS';
  return p.moneda || 'Cash';
}

function formatYtmPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatNumberOrDash(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatPaymentAmount(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
