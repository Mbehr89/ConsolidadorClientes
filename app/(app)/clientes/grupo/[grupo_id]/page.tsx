'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { brokerColorClass, formatCompact, formatCurrency, formatPct } from '@/lib/utils';
import { BROKERS } from '@/lib/brokers';
import type { Position } from '@/lib/schema';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetrics } from '@/lib/bonds/metrics';
import { Button } from '@/components/ui/button';
import { exportFlowReportPdf } from '@/lib/export/flow-report';

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

export default function GrupoDetailPage() {
  const params = useParams();
  const grupoId = params.grupo_id as string;
  const { state } = useConsolidation();
  const [bondEvents, setBondEvents] = useState<BondPaymentEvent[]>([]);
  const [sortBy, setSortBy] = useState<'valor_usd' | 'pct_portfolio' | 'clase'>('valor_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [flowPdfSections, setFlowPdfSections] = useState({
    monthlyByBond: true,
    annualDualAxis: true,
    flowTable: true,
  });

  const grupo = useMemo(
    () => state.grupos.find((g) => g.id === grupoId) ?? null,
    [state.grupos, grupoId]
  );

  const positions = useMemo(() => {
    return state.allPositions.filter((p) => {
      if (p.grupo_id === grupoId) return true;
      if (grupo?.cliente_ids.includes(p.cliente_id)) return true;
      return false;
    });
  }, [state.allPositions, grupoId, grupo]);

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="text-2xl font-bold">Grupo</h2>
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

  if (!grupo && positions.length === 0) {
    return (
      <div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">
          ← Volver a clientes
        </Link>
        <h2 className="text-2xl font-bold mt-4">Grupo no encontrado</h2>
        <p className="text-muted-foreground mt-2">ID: {grupoId}</p>
      </div>
    );
  }

  const nombre = grupo?.nombre ?? 'Grupo';
  const totalUsd = positions.reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0);

  const byBroker = aggregate(positions, (p) => p.broker);
  const byClase = aggregate(positions, (p) => p.clase_activo);
  const byMoneda = aggregate(positions, (p) => p.moneda + (p.moneda_subtipo ? ` (${p.moneda_subtipo})` : ''));
  const byTipo = aggregate(positions, (p) => BROKERS[p.broker]?.tipo ?? 'unknown');
  const byFormaLegal = aggregate(positions, (p) => p.forma_legal ?? 'n/a');

  const allWarnings = positions.flatMap((p) =>
    p.warnings.map((w) => ({ warning: w, ticker: p.ticker, broker: p.broker }))
  );

  const miembros = grupo?.cliente_ids ?? [...new Set(positions.map((p) => p.cliente_id))];

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
    for (const p of positions) {
      if (!(p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra')) continue;
      if (!p.ticker || p.precio_mercado == null || !Number.isFinite(p.precio_mercado)) continue;
      const nominal = Number.isFinite(p.cantidad) && p.cantidad > 0 ? p.cantidad : 100;
      const fxFromPosition =
        p.valor_mercado_usd != null && p.valor_mercado_usd > 0 && p.valor_mercado_local > 0
          ? p.valor_mercado_local / p.valor_mercado_usd
          : 1;
      const usdArsFxRate = Number.isFinite(fxFromPosition) && fxFromPosition > 0 ? fxFromPosition : 1;
      const unitPriceUsd =
        p.moneda === 'USD' ? p.precio_mercado : p.precio_mercado / usdArsFxRate;
      const dirtyPricePer100 = unitPriceUsd * 100;
      const valuationDate = new Date(`${p.fecha_reporte}T00:00:00Z`);
      const metrics = computeBondYieldMetrics(
        bondEvents,
        p.ticker.toUpperCase(),
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
    const eligible = bondRows
      .map((p) => ({ p, m: bondMetricsByRow.get(p.source_row) }))
      .filter(
        ({ p, m }) =>
          (p.valor_mercado_usd ?? 0) > 0 &&
          m != null &&
          m.ytmAnnualEffective != null &&
          m.modifiedDuration != null &&
          Number.isFinite(m.ytmAnnualEffective) &&
          Number.isFinite(m.modifiedDuration)
      );
    const summarize = (subset: typeof eligible) => {
      const sumUsd = subset.reduce((s, x) => s + (x.p.valor_mercado_usd ?? 0), 0);
      if (sumUsd <= 0) {
        return { ytm: null as number | null, modDuration: null as number | null, covered: subset.length };
      }
      const ytm = subset.reduce(
        (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumUsd) * (x.m!.ytmAnnualEffective as number),
        0
      );
      const modDuration = subset.reduce(
        (s, x) => s + ((x.p.valor_mercado_usd ?? 0) / sumUsd) * (x.m!.modifiedDuration as number),
        0
      );
      return { ytm, modDuration, covered: subset.length };
    };

    const paymentCurrencyByTicker = new Map<string, 'ARS' | 'USD'>();
    for (const ev of bondEvents) {
      const key = ev.asset.toUpperCase();
      if (paymentCurrencyByTicker.has(key)) continue;
      const c = ev.currency.toUpperCase();
      paymentCurrencyByTicker.set(key, c.includes('ARS') || c.includes('PESO') ? 'ARS' : 'USD');
    }

    const arsEligible = eligible.filter(({ p }) => {
      const ticker = (p.ticker ?? '').toUpperCase();
      return paymentCurrencyByTicker.get(ticker) === 'ARS';
    });
    const usdEligible = eligible.filter(({ p }) => {
      const ticker = (p.ticker ?? '').toUpperCase();
      return paymentCurrencyByTicker.get(ticker) === 'USD';
    });
    const overall = summarize(eligible);
    return {
      overall,
      ars: summarize(arsEligible),
      usd: summarize(usdEligible),
      covered: eligible.length,
      totalBondRows: bondRows.length,
    };
  }, [positions, bondMetricsByRow, bondEvents]);

  const mappedBondFlows = useMemo(() => {
    const bondPositions = positions.filter(
      (p) => p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra'
    );
    const nominalByTicker = new Map<string, number>();
    for (const p of bondPositions) {
      const t = (p.ticker ?? '').toUpperCase();
      if (!t) continue;
      const n = Number.isFinite(p.cantidad) ? p.cantidad : 0;
      nominalByTicker.set(t, (nominalByTicker.get(t) ?? 0) + n);
    }
    const portfolioBondTickers = new Set([...nominalByTicker.keys()]);
    const rows = bondEvents
      .filter((ev) => portfolioBondTickers.has(ev.asset.toUpperCase()))
      .map((ev) => {
        const nominal = nominalByTicker.get(ev.asset.toUpperCase()) ?? 0;
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

  const sortedPositions = useMemo(() => {
    const list = [...positions];
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

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">
          ← Volver a clientes
        </Link>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <h2 className="text-2xl font-bold tracking-tight">{nombre}</h2>
          <Badge variant="secondary">Grupo económico</Badge>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Miembros:{' '}
          {miembros.map((cid, i) => (
            <span key={cid}>
              {i > 0 ? ' · ' : ''}
              <Link href={`/clientes/${encodeURIComponent(cid)}`} className="text-primary hover:underline">
                {cid}
              </Link>
            </span>
          ))}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="AUM Total (USD)" value={formatCompact(totalUsd)} />
        <KpiCard label="Posiciones" value={positions.length} />
        <KpiCard label="Brokers" value={Object.keys(byBroker).length} />
        <KpiCard
          label="Warnings"
          value={allWarnings.length}
          variant={allWarnings.length > 0 ? 'warning' : 'default'}
        />
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
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownCard title="Por Broker" data={byBroker} total={totalUsd} />
        <BreakdownCard title="Por Clase de Activo" data={byClase} total={totalUsd} />
        <BreakdownCard title="Por Moneda" data={byMoneda} total={totalUsd} />
        <BreakdownCard title="Local vs Offshore" data={byTipo} total={totalUsd} />
        <BreakdownCard title="Por Forma Legal" data={byFormaLegal} total={totalUsd} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Todas las posiciones ({positions.length})</CardTitle>
        </CardHeader>
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
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Cliente</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Cant.</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Precio ARS</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Precio USD</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valor USD</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">% Portfolio</th>
                  <th className="p-2 text-xs font-medium text-muted-foreground uppercase">⚠</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valuación ARS</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">TIR</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Dur. mod.</th>
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((p, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="p-2">
                        <Badge variant="outline" className={brokerColorClass(p.broker)}>
                          {p.broker}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs font-mono text-muted-foreground">{p.cuenta}</td>
                      <td className="p-2 text-xs">
                        <Link href={`/clientes/${encodeURIComponent(p.cliente_id)}`} className="text-primary hover:underline">
                          {p.titular}
                        </Link>
                      </td>
                      <td className="p-2 font-mono">{p.ticker ?? '—'}</td>
                      <td className="p-2">
                        <Badge variant="secondary" className="text-xs">
                          {p.clase_activo}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-mono">{p.cantidad.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono">{formatArsPrice(p)}</td>
                      <td className="p-2 text-right font-mono">{formatUsdPrice(p)}</td>
                      <td className="p-2 text-right font-mono font-medium">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
                      <td className="p-2 text-right text-muted-foreground">
                        {totalUsd > 0 ? formatPct(((p.valor_mercado_usd ?? 0) / totalUsd) * 100) : '—'}
                      </td>
                      <td className="p-2">
                        {p.warnings.length > 0 && (
                          <span className="text-amber-500" title={p.warnings.join('\n')}>
                            ⚠ {p.warnings.length}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right font-mono">{formatArsValuation(p)}</td>
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!flowPdfSections.monthlyByBond && !flowPdfSections.annualDualAxis && !flowPdfSections.flowTable}
              onClick={() =>
                exportFlowReportPdf({
                  title: `Flujo de bonos — ${nombre}`,
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

function KpiCard({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  variant?: 'default' | 'warning';
}) {
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
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map(([key, value]) => {
            const pct = total > 0 ? (value / total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-sm">
                  <span>{key}</span>
                  <span className="font-mono">
                    {formatCompact(value)} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
                  </span>
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
  let arsValue: number | null = null;
  if (Number.isFinite(p.valor_mercado_local) && p.valor_mercado_local > 0 && p.moneda === 'ARS') {
    arsValue = p.valor_mercado_local;
  } else if (
    p.valor_mercado_usd != null &&
    Number.isFinite(p.valor_mercado_usd) &&
    p.valor_mercado_usd > 0 &&
    Number.isFinite(p.valor_mercado_local) &&
    p.valor_mercado_local > 0
  ) {
    const fx = p.valor_mercado_local / p.valor_mercado_usd;
    arsValue = p.valor_mercado_usd * fx;
  } else if (p.valor_mercado_usd != null && Number.isFinite(p.valor_mercado_usd) && p.valor_mercado_usd > 0) {
    arsValue = p.valor_mercado_usd;
  }
  if (arsValue == null || !Number.isFinite(arsValue)) return '—';
  return arsValue.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
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
