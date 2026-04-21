'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Printer, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetrics, teaToTnaMonthly } from '@/lib/bonds/metrics';
import { issuerByTickerFromEvents, uniqueTickers } from '@/lib/bonds/parse-calendar';
import { issuerLabel, uniqueIssuers } from '@/lib/bonds/issuers';

const PORTFOLIO_LS = 'consolidador-bond-portfolio-v1';

type PortfolioLine = { ticker: string; weightPct: number };

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

function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}

export default function BonosPage() {
  const [events, setEvents] = useState<BondPaymentEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const [valuationDate, setValuationDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [dirtyPrice, setDirtyPrice] = useState('85');
  const [nominal, setNominal] = useState('100');
  const [usdArsFx, setUsdArsFx] = useState('1200');

  const [issuerFilter, setIssuerFilter] = useState<string>('__all__');
  const [durMin, setDurMin] = useState('');
  const [durMax, setDurMax] = useState('');

  const [portfolio, setPortfolio] = useState<PortfolioLine[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PORTFOLIO_LS);
      if (raw) {
        const parsed = JSON.parse(raw) as PortfolioLine[];
        if (Array.isArray(parsed)) setPortfolio(parsed);
      }
    } catch {
      /* noop */
    }
  }, []);

  const persistPortfolio = useCallback((next: PortfolioLine[]) => {
    setPortfolio(next);
    try {
      localStorage.setItem(PORTFOLIO_LS, JSON.stringify(next));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/bonds/calendar', { cache: 'no-store' });
        const data = (await res.json()) as {
          events?: Array<Record<string, unknown>>;
          configured?: boolean;
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        setConfigured(data.configured !== false);
        if (data.error) {
          setLoadError(data.error);
          setEvents([]);
        } else if (data.events) {
          setEvents(reviveEvents(data.events));
          setLoadError(data.message ?? null);
        }
      } catch {
        if (!cancelled) setLoadError('No se pudo cargar el calendario.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tickers = useMemo(() => uniqueTickers(events), [events]);
  const issuerByTicker = useMemo(() => issuerByTickerFromEvents(events), [events]);
  const issuers = useMemo(() => uniqueIssuers(tickers, issuerByTicker), [tickers, issuerByTicker]);

  const valuationAsDate = useMemo(() => {
    const [y, m, d] = valuationDate.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  }, [valuationDate]);

  const nominalN = useMemo(() => {
    const n = Number(nominal.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 100;
  }, [nominal]);

  const dirtyN = useMemo(() => {
    const n = Number(dirtyPrice.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [dirtyPrice]);

  const fx = useMemo(() => {
    const n = Number(usdArsFx.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [usdArsFx]);

  const rows = useMemo(() => {
    const out: Array<{
      ticker: string;
      issuer: string;
      metrics: ReturnType<typeof computeBondYieldMetrics>;
    }> = [];
    for (const t of tickers) {
      const m = computeBondYieldMetrics(events, t, valuationAsDate, dirtyN, nominalN, fx);
      out.push({ ticker: t, issuer: issuerLabel(t, issuerByTicker.get(t)), metrics: m });
    }
    return out;
  }, [events, tickers, issuerByTicker, valuationAsDate, dirtyN, nominalN, fx]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (issuerFilter !== '__all__') {
      list = list.filter((r) => r.issuer === issuerFilter);
    }
    const minD = durMin.trim() ? Number(durMin.replace(',', '.')) : null;
    const maxD = durMax.trim() ? Number(durMax.replace(',', '.')) : null;
    if (minD != null && Number.isFinite(minD)) {
      list = list.filter((r) => {
        const d = r.metrics.modifiedDuration;
        return d != null && d >= minD;
      });
    }
    if (maxD != null && Number.isFinite(maxD)) {
      list = list.filter((r) => {
        const d = r.metrics.modifiedDuration;
        return d != null && d <= maxD;
      });
    }
    return list;
  }, [rows, issuerFilter, durMin, durMax]);

  const metricsByTicker = useMemo(() => {
    const m = new Map<string, (typeof rows)[0]['metrics']>();
    for (const r of rows) m.set(r.ticker, r.metrics);
    return m;
  }, [rows]);

  const portfolioWeightSum = useMemo(
    () => portfolio.reduce((s, l) => s + (Number.isFinite(l.weightPct) ? l.weightPct : 0), 0),
    [portfolio]
  );

  const portfolioAgg = useMemo(() => {
    const lines = portfolio.filter((l) => l.weightPct > 0);
    const sumW = lines.reduce((s, l) => s + l.weightPct, 0);
    if (sumW <= 0) return null;
    let wMod = 0;
    let wYtm = 0;
    for (const l of lines) {
      const w = l.weightPct / sumW;
      const met = metricsByTicker.get(l.ticker);
      if (!met?.modifiedDuration || met.ytmAnnualEffective == null) continue;
      wMod += w * met.modifiedDuration;
      wYtm += w * met.ytmAnnualEffective;
    }
    return {
      modifiedDuration: wMod,
      ytm: wYtm,
      weightsNormalized: true,
    };
  }, [portfolio, metricsByTicker]);

  const addToPortfolio = (ticker: string) => {
    if (portfolio.some((p) => p.ticker === ticker)) return;
    const next = [...portfolio, { ticker, weightPct: 0 }];
    persistPortfolio(next);
  };

  const removeLine = (ticker: string) => {
    persistPortfolio(portfolio.filter((p) => p.ticker !== ticker));
  };

  const updateWeight = (ticker: string, pct: number) => {
    persistPortfolio(portfolio.map((p) => (p.ticker === ticker ? { ...p, weightPct: pct } : p)));
  };

  return (
    <div className="page-shell print:max-w-none">
      <div className="page-header print:hidden">
        <div>
          <p className="page-title flex items-center gap-2">
            <Landmark className="h-5 w-5 text-navy-700" aria-hidden />
            Bonos — calculadora y carteras
          </p>
          <p className="page-subtitle">
            Métricas (TIR anual efectiva, Macaulay, duration modificada, convexidad) a partir del calendario de
            pagos y un precio sucio por 100. Filtrá por emisor y duration; armá carteras para presentar a clientes.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando calendario…</p>}
      {!loading && !configured && (
        <Card className="border-amber-200 bg-amber-50/80">
          <CardHeader>
            <CardTitle className="text-base">Calendario no configurado</CardTitle>
            <CardDescription>
              Agregá en Vercel la variable <code className="font-mono text-xs">BOND_PAYMENTS_URL</code> con la URL de
              export CSV del Google Sheet (mismo formato que describe BOND_PAYMENTS_ENGINE_README.md).
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 print:hidden">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parámetros de valuación</CardTitle>
            <CardDescription>
              Un mismo precio sucio (por 100) y nominal se aplican a todos los bonos de la tabla para comparar. Ajustá
              el tipo USD/ARS si hay cupones en pesos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-label mb-1 block">Fecha de valuación</label>
              <input
                type="date"
                value={valuationDate}
                onChange={(e) => setValuationDate(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-label mb-1 block">Precio sucio (por 100 VN)</label>
              <input
                value={dirtyPrice}
                onChange={(e) => setDirtyPrice(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-label mb-1 block">Nominal (unidades)</label>
              <input
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-label mb-1 block">USD/ARS (para cupones en pesos)</label>
              <input
                value={usdArsFx}
                onChange={(e) => setUsdArsFx(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
                inputMode="decimal"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
            <CardDescription>Duration modificada según el precio y fecha arriba.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="text-label mb-1 block">Emisor</label>
              <select
                value={issuerFilter}
                onChange={(e) => setIssuerFilter(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="__all__">Todos</option>
                {issuers.map((iss) => (
                  <option key={iss} value={iss}>
                    {iss}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-label mb-1 block">Dur. modif. mín (años)</label>
              <input
                value={durMin}
                onChange={(e) => setDurMin(e.target.value)}
                placeholder="ej. 2"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-label mb-1 block">Dur. modif. máx (años)</label>
              <input
                value={durMax}
                onChange={(e) => setDurMax(e.target.value)}
                placeholder="ej. 8"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="print:pb-2">
          <CardTitle className="text-base">Tabla de bonos</CardTitle>
          <CardDescription className="print:text-foreground">
            {filteredRows.length} especies · TEA = TIR efectiva anual · TNA (nominal mensual) opcional
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="data-table-wrap max-h-[min(70vh,560px)] overflow-auto">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Bono</th>
                  <th className="px-3 py-2">Emisor</th>
                  <th className="px-3 py-2 text-right">Flujos fut.</th>
                  <th className="px-3 py-2 text-right">TEA (YTM)</th>
                  <th className="px-3 py-2 text-right">TNA*</th>
                  <th className="px-3 py-2 text-right">Macaulay</th>
                  <th className="px-3 py-2 text-right">Dur. mod.</th>
                  <th className="px-3 py-2 text-right">Convexidad</th>
                  <th className="px-3 py-2 print:hidden">Cartera</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const y = r.metrics.ytmAnnualEffective;
                  const tna = y != null ? teaToTnaMonthly(y) : null;
                  return (
                    <tr key={r.ticker} className="border-b border-border/60">
                      <td className="px-3 py-2 font-mono text-sm font-medium">{r.ticker}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{r.issuer}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm">{r.metrics.futureFlowsCount}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm">{fmtPct(y)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                        {tna != null ? `${tna.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-sm">{fmtNum(r.metrics.macaulayYears)}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm">{fmtNum(r.metrics.modifiedDuration)}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm">{fmtNum(r.metrics.convexity, 4)}</td>
                      <td className="px-3 py-2 print:hidden">
                        <Button type="button" variant="outline" size="sm" onClick={() => addToPortfolio(r.ticker)}>
                          Agregar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredRows.length === 0 && !loading && (
              <p className="p-6 text-sm text-muted-foreground">No hay bonos que cumplan los filtros.</p>
            )}
          </div>
          <p className="px-4 py-2 text-[11px] text-muted-foreground print:px-0">
            *TNA aproximada con capitalización mensual equivalente a la TEA mostrada. No es asesoramiento financiero.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4 print:mt-6 print:border-0 print:shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Cartera modelo</CardTitle>
          <CardDescription>
            Asigná pesos (%) que sumen 100. La duration y TIR de cartera son aproximación ponderada por las métricas
            de la tabla (mismo precio y fecha para todos).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {portfolio.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Suma de pesos:{' '}
              <span className="font-mono font-medium text-foreground">{portfolioWeightSum.toFixed(1)}%</span>
              {Math.abs(portfolioWeightSum - 100) > 0.5 && (
                <span className="text-amber-700"> — idealmente 100% para interpretar el resumen como cartera cerrada.</span>
              )}
            </p>
          )}
          {portfolio.length === 0 && (
            <p className="text-sm text-muted-foreground">Agregá bonos desde la tabla. Los pesos se guardan en este
              navegador.</p>
          )}
          {portfolio.map((line) => {
            const met = metricsByTicker.get(line.ticker);
            return (
              <div
                key={line.ticker}
                className="flex flex-wrap items-end gap-3 border-b border-border/50 pb-3 last:border-0"
              >
                <div className="min-w-[120px]">
                  <p className="text-label mb-1">Bono</p>
                  <p className="font-mono text-sm font-semibold">{line.ticker}</p>
                </div>
                <div className="w-28">
                  <label className="text-label mb-1 block">Peso %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={line.weightPct || ''}
                    onChange={(e) => updateWeight(line.ticker, Number(e.target.value))}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  Dur. mod. {fmtNum(met?.modifiedDuration)} · TEA {fmtPct(met?.ytmAnnualEffective)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="print:hidden"
                  aria-label={`Quitar ${line.ticker}`}
                  onClick={() => removeLine(line.ticker)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          {portfolioAgg && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-caption mb-2">Resumen cartera (ponderado)</p>
              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="text-label">Duration modificada</span>
                  <p className="text-kpi">{fmtNum(portfolioAgg.modifiedDuration)} años</p>
                </div>
                <div>
                  <span className="text-label">TIR cartera (aprox.)</span>
                  <p className="text-kpi">{fmtPct(portfolioAgg.ytm)}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
