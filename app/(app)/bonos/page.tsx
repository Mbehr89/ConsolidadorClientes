'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Printer, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetrics, teaToTnaMonthly } from '@/lib/bonds/metrics';
import { issuerByTickerFromEvents, uniqueTickers } from '@/lib/bonds/parse-calendar';
import { issuerLabel } from '@/lib/bonds/issuers';
import { filterBondEventsByViewMode, tickersWithBothRegimes, type BondFlowViewMode } from '@/lib/bonds/flow-regime';
import { reviveBondEventsFromApi } from '@/lib/bonds/revive';

const PORTFOLIO_LS = 'consolidador-bond-portfolio-v1';

type PortfolioLine = { ticker: string; weightPct: number };

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
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [dirtyPrice, setDirtyPrice] = useState('85');
  const [nominal, setNominal] = useState('100');
  const [usdArsFx, setUsdArsFx] = useState('1200');
  const [issuerFilter, setIssuerFilter] = useState<string>('__all__');
  const [durMin, setDurMin] = useState('');
  const [durMax, setDurMax] = useState('');

  const [portfolio, setPortfolio] = useState<PortfolioLine[]>([]);
  const [bondFlowViewMode, setBondFlowViewMode] = useState<BondFlowViewMode>('normal');

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
          setEvents(reviveBondEventsFromApi(data.events));
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

  const eventsView = useMemo(
    () => filterBondEventsByViewMode(events, bondFlowViewMode),
    [events, bondFlowViewMode]
  );
  const showFlowRegimeToggle = useMemo(() => tickersWithBothRegimes(events).length > 0, [events]);

  const tickers = useMemo(() => uniqueTickers(events), [events]);
  const issuerByTicker = useMemo(() => issuerByTickerFromEvents(events), [events]);

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
      const m = computeBondYieldMetrics(eventsView, t, valuationAsDate, dirtyN, nominalN, fx);
      out.push({ ticker: t, issuer: issuerLabel(t, issuerByTicker.get(t)), metrics: m });
    }
    return out;
  }, [eventsView, tickers, issuerByTicker, valuationAsDate, dirtyN, nominalN, fx]);

  const issuers = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.issuer);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (issuerFilter !== '__all__') {
      list = list.filter((r) => r.issuer === issuerFilter);
    }
    const minD = durMin.trim() ? Number(durMin.replace(',', '.')) : null;
    const maxD = durMax.trim() ? Number(durMax.replace(',', '.')) : null;
    if (minD != null && Number.isFinite(minD)) {
      list = list.filter((r) => (r.metrics.modifiedDuration ?? Number.NEGATIVE_INFINITY) >= minD);
    }
    if (maxD != null && Number.isFinite(maxD)) {
      list = list.filter((r) => (r.metrics.modifiedDuration ?? Number.POSITIVE_INFINITY) <= maxD);
    }
    return list;
  }, [rows, issuerFilter, durMin, durMax]);

  const filteredTickers = useMemo(() => filteredRows.map((r) => r.ticker), [filteredRows]);

  useEffect(() => {
    if (filteredTickers.length === 0) {
      setSelectedTicker('');
      return;
    }
    setSelectedTicker((prev) => (prev && filteredTickers.includes(prev) ? prev : filteredTickers[0]!));
  }, [filteredTickers]);

  const selectedRow = useMemo(() => {
    if (!selectedTicker) return null;
    return filteredRows.find((r) => r.ticker === selectedTicker) ?? null;
  }, [filteredRows, selectedTicker]);

  const metricsByTicker = useMemo(() => {
    const m = new Map<string, (typeof rows)[0]['metrics']>();
    for (const r of rows) m.set(r.ticker, r.metrics);
    return m;
  }, [rows]);
  const selectedInPortfolio = useMemo(
    () => (!!selectedTicker ? portfolio.some((p) => p.ticker === selectedTicker) : false),
    [portfolio, selectedTicker]
  );

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

      {showFlowRegimeToggle && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm print:hidden">
          <span className="text-muted-foreground">Flujos (ley / AFIP):</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={bondFlowViewMode}
            onChange={(e) => setBondFlowViewMode(e.target.value as BondFlowViewMode)}
            aria-label="Ley general o régimen AFIP"
          >
            <option value="normal">Ley general</option>
            <option value="afip">Régimen AFIP</option>
          </select>
        </div>
      )}

      <div className="grid gap-4 print:hidden">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parámetros de valuación</CardTitle>
            <CardDescription>
              Filtrá bonos por emisor y duration para encontrar más rápido qué especie analizar. El cálculo se actualiza
              automáticamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 grid gap-3 xl:grid-cols-3">
              <div>
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
              <div className="xl:col-span-3">
                <label className="text-label mb-1 block">Bono a analizar</label>
                <select
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
                >
                  {filteredTickers.length === 0 && <option value="">Sin bonos para estos filtros</option>}
                  {filteredTickers.map((ticker) => (
                    <option key={ticker} value={ticker}>
                      {ticker} · {issuerLabel(ticker, issuerByTicker.get(ticker))}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
            <div className="sm:col-span-2 rounded-md border border-border/70 bg-muted/30 p-3" id="bono-calculadora">
              {!selectedRow && (
                <p className="text-sm text-muted-foreground">
                  No hay bonos cargados para analizar. Revisá la configuración del calendario de pagos.
                </p>
              )}
              {selectedRow && (
                <>
                  <p className="text-caption mb-2">
                    Calculadora en vivo:{' '}
                    <span className="font-mono font-medium text-foreground">{selectedRow.ticker}</span>
                  </p>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Cálculo automático: se actualiza al cambiar bono, fecha, precio, nominal o USD/ARS.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className="text-sm text-muted-foreground">
                      TEA (YTM):{' '}
                      <span className="font-mono text-foreground">{fmtPct(selectedRow.metrics.ytmAnnualEffective)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      TNA*:{' '}
                      <span className="font-mono text-foreground">
                        {selectedRow.metrics.ytmAnnualEffective != null
                          ? `${teaToTnaMonthly(selectedRow.metrics.ytmAnnualEffective).toFixed(2)}%`
                          : '—'}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Macaulay:{' '}
                      <span className="font-mono text-foreground">{fmtNum(selectedRow.metrics.macaulayYears)} años</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Dur. modificada:{' '}
                      <span className="font-mono text-foreground">{fmtNum(selectedRow.metrics.modifiedDuration)} años</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Convexidad:{' '}
                      <span className="font-mono text-foreground">{fmtNum(selectedRow.metrics.convexity, 4)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Flujos futuros:{' '}
                      <span className="font-mono text-foreground">{selectedRow.metrics.futureFlowsCount}</span>
                    </p>
                  </div>
                  {selectedRow.metrics.futureFlowsCount === 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      No hay flujos futuros para la fecha elegida. Probá con otra fecha de valuación.
                    </p>
                  )}
                  {selectedRow.metrics.futureFlowsCount > 0 && selectedRow.metrics.ytmAnnualEffective == null && (
                    <p className="mt-2 text-xs text-amber-700">
                      No se puede resolver TIR con estos parámetros. Valor de flujos a 0%:{' '}
                      <span className="font-mono">{selectedRow.metrics.npvAtZero.toFixed(2)}</span> vs precio valuado:{' '}
                      <span className="font-mono">{((dirtyN / 100) * nominalN).toFixed(2)}</span>. Ajustá precio, fecha
                      o tipo de cambio.
                    </p>
                  )}
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => selectedTicker && addToPortfolio(selectedTicker)}
                      disabled={!selectedTicker || selectedInPortfolio}
                    >
                      {selectedInPortfolio ? 'Ya agregado a cartera' : 'Agregar bono a cartera'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

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
            <p className="text-sm text-muted-foreground">
              Agregá bonos desde la calculadora. Los pesos se guardan en este navegador.
            </p>
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
                  TEA {fmtPct(met?.ytmAnnualEffective)} · TNA{' '}
                  {met?.ytmAnnualEffective != null ? `${teaToTnaMonthly(met.ytmAnnualEffective).toFixed(2)}%` : '—'} ·
                  Macaulay {fmtNum(met?.macaulayYears)} años · Dur. mod. {fmtNum(met?.modifiedDuration)} años · Convexidad{' '}
                  {fmtNum(met?.convexity, 4)}
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
