'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, Printer, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetrics, teaToTnaMonthly } from '@/lib/bonds/metrics';
import { issuerByTickerFromEvents, uniqueTickers } from '@/lib/bonds/parse-calendar';
import { issuerLabel } from '@/lib/bonds/issuers';
import { filterBondEventsByViewMode, tickersWithBothRegimes, type BondFlowViewMode } from '@/lib/bonds/flow-regime';
import { reviveBondEventsFromApi } from '@/lib/bonds/revive';
import { normalizeBondTicker } from '@/lib/bonds/ticker-normalize';
import { exportExecutiveFlowReportPdf, exportFlowReportPdf } from '@/lib/export/flow-report';
import { exportModelPortfolioFlowExcel } from '@/lib/export/model-portfolio-flow-excel';
import { formatCurrency } from '@/lib/utils';

const PORTFOLIO_LS = 'consolidador-bond-portfolio-v1';

type PortfolioLine = {
  ticker: string;
  weightPct: number;
  /** Precio sucio por 100 VN; vacío = usar el de «Parámetros de valuación». */
  dirtyPricePer100: string;
};

type StoredPortfolio = {
  lines: PortfolioLine[];
  /** legacy */
  totalUsd?: string;
  totalCartera?: string;
  monedaTotal?: 'USD' | 'ARS';
  portfolioFx?: string;
  preciosCarteraArs?: boolean;
};

function parseDirtyInput(raw: string, fallback: number): number {
  const n = Number(raw.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFxInput(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

type CarteraPersist = {
  lines: PortfolioLine[];
  totalCartera: string;
  monedaTotal: 'USD' | 'ARS';
  portfolioFx: string;
  preciosCarteraArs: boolean;
};

function migratePortfolioFromStorage(raw: string | null): CarteraPersist {
  const empty: CarteraPersist = {
    lines: [],
    totalCartera: '',
    monedaTotal: 'USD',
    portfolioFx: '',
    preciosCarteraArs: false,
  };
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw) as unknown;
    const mapLine = (x: Record<string, unknown>): PortfolioLine => ({
      ticker: String(x.ticker ?? ''),
      weightPct: Number(x.weightPct) || 0,
      dirtyPricePer100: typeof x.dirtyPricePer100 === 'string' ? x.dirtyPricePer100 : '',
    });
    if (Array.isArray(j)) {
      return { ...empty, lines: j.map((x) => mapLine(x as Record<string, unknown>)) };
    }
    if (j && typeof j === 'object' && Array.isArray((j as StoredPortfolio).lines)) {
      const o = j as StoredPortfolio;
      const legacyUsd = typeof o.totalUsd === 'string' ? o.totalUsd : '';
      const totalCartera = typeof o.totalCartera === 'string' ? o.totalCartera : legacyUsd;
      return {
        lines: o.lines.map((x) => mapLine(x as unknown as Record<string, unknown>)),
        totalCartera,
        monedaTotal: o.monedaTotal === 'ARS' ? 'ARS' : 'USD',
        portfolioFx: typeof o.portfolioFx === 'string' ? o.portfolioFx : '',
        preciosCarteraArs: o.preciosCarteraArs === true,
      };
    }
  } catch {
    /* noop */
  }
  return empty;
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
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [dirtyPrice, setDirtyPrice] = useState('85');
  const [nominal, setNominal] = useState('100');
  const [usdArsFx, setUsdArsFx] = useState('1200');
  const [issuerFilter, setIssuerFilter] = useState<string>('__all__');
  const [durMin, setDurMin] = useState('');
  const [durMax, setDurMax] = useState('');

  const [portfolio, setPortfolio] = useState<PortfolioLine[]>([]);
  const [totalCartera, setTotalCartera] = useState('');
  const [monedaTotalCartera, setMonedaTotalCartera] = useState<'USD' | 'ARS'>('USD');
  const [portfolioFxInput, setPortfolioFxInput] = useState('');
  const [preciosCarteraArs, setPreciosCarteraArs] = useState(false);
  const [bondFlowViewMode, setBondFlowViewMode] = useState<BondFlowViewMode>('normal');
  const [flowPdfSections, setFlowPdfSections] = useState({
    monthlyByBond: true,
    annualDualAxis: true,
    flowTable: true,
  });

  const portfolioRef = useRef<PortfolioLine[]>([]);
  const totalCarteraRef = useRef('');
  const monedaTotalRef = useRef<'USD' | 'ARS'>('USD');
  const portfolioFxRef = useRef('');
  const preciosArsRef = useRef(false);

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);
  useEffect(() => {
    totalCarteraRef.current = totalCartera;
  }, [totalCartera]);
  useEffect(() => {
    monedaTotalRef.current = monedaTotalCartera;
  }, [monedaTotalCartera]);
  useEffect(() => {
    portfolioFxRef.current = portfolioFxInput;
  }, [portfolioFxInput]);
  useEffect(() => {
    preciosArsRef.current = preciosCarteraArs;
  }, [preciosCarteraArs]);

  const flushPortfolioStorage = useCallback(() => {
    try {
      localStorage.setItem(
        PORTFOLIO_LS,
        JSON.stringify({
          lines: portfolioRef.current,
          totalCartera: totalCarteraRef.current,
          monedaTotal: monedaTotalRef.current,
          portfolioFx: portfolioFxRef.current,
          preciosCarteraArs: preciosArsRef.current,
        })
      );
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    const m = migratePortfolioFromStorage(localStorage.getItem(PORTFOLIO_LS));
    setPortfolio(m.lines);
    setTotalCartera(m.totalCartera);
    setMonedaTotalCartera(m.monedaTotal);
    setPortfolioFxInput(m.portfolioFx);
    setPreciosCarteraArs(m.preciosCarteraArs);
    portfolioRef.current = m.lines;
    totalCarteraRef.current = m.totalCartera;
    monedaTotalRef.current = m.monedaTotal;
    portfolioFxRef.current = m.portfolioFx;
    preciosArsRef.current = m.preciosCarteraArs;
  }, []);

  const persistPortfolio = useCallback((next: PortfolioLine[]) => {
    setPortfolio(next);
    portfolioRef.current = next;
    flushPortfolioStorage();
  }, [flushPortfolioStorage]);

  const setTotalCarteraPersist = useCallback(
    (v: string) => {
      setTotalCartera(v);
      totalCarteraRef.current = v;
      flushPortfolioStorage();
    },
    [flushPortfolioStorage]
  );

  const setMonedaTotalPersist = useCallback(
    (m: 'USD' | 'ARS') => {
      setMonedaTotalCartera(m);
      monedaTotalRef.current = m;
      flushPortfolioStorage();
    },
    [flushPortfolioStorage]
  );

  const setPortfolioFxPersist = useCallback(
    (v: string) => {
      setPortfolioFxInput(v);
      portfolioFxRef.current = v;
      flushPortfolioStorage();
    },
    [flushPortfolioStorage]
  );

  const setPreciosCarteraArsPersist = useCallback(
    (on: boolean) => {
      setPreciosCarteraArs(on);
      preciosArsRef.current = on;
      flushPortfolioStorage();
    },
    [flushPortfolioStorage]
  );

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

  /** TC para convertir montos/precios de la cartera (ARS por 1 USD). Vacío = mismo que valuación. */
  const fxCartera = useMemo(() => {
    const o = parseFxInput(portfolioFxInput);
    return o ?? fx;
  }, [portfolioFxInput, fx]);

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

  const selectedInPortfolio = useMemo(
    () => (!!selectedTicker ? portfolio.some((p) => p.ticker === selectedTicker) : false),
    [portfolio, selectedTicker]
  );

  const portfolioWeightSum = useMemo(
    () => portfolio.reduce((s, l) => s + (Number.isFinite(l.weightPct) ? l.weightPct : 0), 0),
    [portfolio]
  );

  const portfolioLinesWithMetrics = useMemo(
    () =>
      portfolio.map((line) => {
        const dirtyInput = parseDirtyInput(line.dirtyPricePer100, dirtyN);
        const dirtyForLine = preciosCarteraArs ? dirtyInput / fxCartera : dirtyInput;
        const met = computeBondYieldMetrics(eventsView, line.ticker, valuationAsDate, dirtyForLine, nominalN, fx);
        return { line, dirtyForLine, met };
      }),
    [portfolio, eventsView, valuationAsDate, dirtyN, nominalN, fx, preciosCarteraArs, fxCartera]
  );

  const portfolioPositiveWeightSum = useMemo(
    () => portfolio.reduce((s, l) => s + (l.weightPct > 0 ? l.weightPct : 0), 0),
    [portfolio]
  );

  const totalCarteraNUsd = useMemo(() => {
    const raw = Number(totalCartera.replace(',', '.').trim());
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (monedaTotalCartera === 'ARS') return raw / fxCartera;
    return raw;
  }, [totalCartera, monedaTotalCartera, fxCartera]);

  /** Equivalente ARS del precio global (por 100), para placeholder en modo precios ARS. */
  const dirtyGlobalArsHint = useMemo(() => {
    if (!preciosCarteraArs || !(dirtyN > 0) || !(fxCartera > 0)) return '';
    const v = dirtyN * fxCartera;
    return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  }, [preciosCarteraArs, dirtyN, fxCartera]);

  const portfolioAgg = useMemo(() => {
    const lines = portfolioLinesWithMetrics.filter(({ line }) => line.weightPct > 0);
    const sumW = lines.reduce((s, { line: l }) => s + l.weightPct, 0);
    if (sumW <= 0) return null;
    let wMod = 0;
    let wYtm = 0;
    for (const { line, met } of lines) {
      const w = line.weightPct / sumW;
      if (!met?.modifiedDuration || met.ytmAnnualEffective == null) continue;
      wMod += w * met.modifiedDuration;
      wYtm += w * met.ytmAnnualEffective;
    }
    return {
      modifiedDuration: wMod,
      ytm: wYtm,
      weightsNormalized: true,
    };
  }, [portfolioLinesWithMetrics]);

  /** VN implícito por ticker (monto total × peso / precio). Sin monto: VN relativo = peso %. */
  const portfolioNominalByTicker = useMemo(() => {
    const map = new Map<string, number>();
    let absolute = false;
    for (const { line, dirtyForLine } of portfolioLinesWithMetrics) {
      if (line.weightPct <= 0) continue;
      const t = normalizeBondTicker(line.ticker);
      if (!t) continue;
      if (
        totalCarteraNUsd != null &&
        portfolioPositiveWeightSum > 0 &&
        dirtyForLine > 0
      ) {
        const allocUsd = totalCarteraNUsd * (line.weightPct / portfolioPositiveWeightSum);
        const nominal = (allocUsd * 100) / dirtyForLine;
        if (Number.isFinite(nominal) && nominal > 0) {
          map.set(t, (map.get(t) ?? 0) + nominal);
          absolute = true;
        }
      }
    }
    if (!absolute) {
      for (const { line } of portfolioLinesWithMetrics) {
        if (line.weightPct <= 0) continue;
        const t = normalizeBondTicker(line.ticker);
        if (!t) continue;
        // Relativo: 1 punto de peso ≈ 1 VN (sirve para ver timing / mix).
        map.set(t, (map.get(t) ?? 0) + line.weightPct);
      }
    }
    return { map, absolute };
  }, [portfolioLinesWithMetrics, totalCarteraNUsd, portfolioPositiveWeightSum]);

  const portfolioModelFlows = useMemo(() => {
    const { map: nominalByTicker, absolute } = portfolioNominalByTicker;
    const portfolioTickers = new Set([...nominalByTicker.keys()]);
    const v0 = Date.UTC(
      valuationAsDate.getUTCFullYear(),
      valuationAsDate.getUTCMonth(),
      valuationAsDate.getUTCDate()
    );
    const rows = eventsView
      .filter((ev) => {
        const t = normalizeBondTicker(ev.asset);
        if (!portfolioTickers.has(t)) return false;
        return ev.date.getTime() >= v0;
      })
      .map((ev) => {
        const nominal = nominalByTicker.get(normalizeBondTicker(ev.asset)) ?? 0;
        const intereses = ((ev.couponPer100 ?? 0) / 100) * nominal;
        const amortizacion = ((ev.amortizationPer100 ?? 0) / 100) * nominal;
        return { ev, intereses, amortizacion };
      })
      .sort((a, b) => {
        const byDate = a.ev.date.getTime() - b.ev.date.getTime();
        if (byDate !== 0) return byDate;
        return a.ev.asset.localeCompare(b.ev.asset);
      });
    return {
      rows,
      absolute,
      mappedTickers: new Set(rows.map((r) => normalizeBondTicker(r.ev.asset))).size,
      totalTickers: portfolioTickers.size,
    };
  }, [portfolioNominalByTicker, eventsView, valuationAsDate]);

  const portfolioFlowTotalsByCurrency = useMemo(() => {
    const totals = new Map<string, { intereses: number; amortizacion: number }>();
    for (const r of portfolioModelFlows.rows) {
      const c = r.ev.currency.toUpperCase();
      const prev = totals.get(c) ?? { intereses: 0, amortizacion: 0 };
      prev.intereses += r.intereses;
      prev.amortizacion += r.amortizacion;
      totals.set(c, prev);
    }
    return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [portfolioModelFlows]);

  const portfolioFlowFutureValue = useMemo(
    () => portfolioModelFlows.rows.reduce((s, r) => s + r.intereses + r.amortizacion, 0),
    [portfolioModelFlows]
  );

  const addToPortfolio = (ticker: string) => {
    if (portfolio.some((p) => p.ticker === ticker)) return;
    const next = [...portfolio, { ticker, weightPct: 0, dirtyPricePer100: dirtyPrice }];
    persistPortfolio(next);
  };

  const removeLine = (ticker: string) => {
    persistPortfolio(portfolio.filter((p) => p.ticker !== ticker));
  };

  const updateWeight = (ticker: string, pct: number) => {
    persistPortfolio(portfolio.map((p) => (p.ticker === ticker ? { ...p, weightPct: pct } : p)));
  };

  const updateLineDirtyPrice = (ticker: string, value: string) => {
    persistPortfolio(portfolio.map((p) => (p.ticker === ticker ? { ...p, dirtyPricePer100: value } : p)));
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
            Cada bono puede tener su propio precio sucio (por 100 VN). Podés cargar el monto total de la cartera y los
            precios de cartera en pesos usando el tipo de cambio de la cartera (ARS por USD); si el TC queda vacío, se
            usa el mismo que en «USD/ARS» de valuación. Las TIR se siguen resolviendo en USD por debajo. Con pesos y
            monto total, abajo se proyecta el flujo de cupones y amortizaciones de la cartera.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {portfolio.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="text-label mb-1 block">TC cartera (ARS por 1 USD)</label>
                <input
                  value={portfolioFxInput}
                  onChange={(e) => setPortfolioFxPersist(e.target.value)}
                  className="h-9 w-full max-w-[11rem] rounded-md border bg-background px-3 text-sm font-mono"
                  inputMode="decimal"
                  placeholder={usdArsFx}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-muted-foreground">Vacío = mismo valor que «USD/ARS» arriba ({fx}).</p>
              </div>
              <div>
                <label className="text-label mb-1 block">Moneda del monto total</label>
                <select
                  value={monedaTotalCartera}
                  onChange={(e) => setMonedaTotalPersist(e.target.value as 'USD' | 'ARS')}
                  className="h-9 w-full max-w-[11rem] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              <div className="sm:col-span-2 xl:col-span-2">
                <label className="text-label mb-1 block">
                  Monto total cartera ({monedaTotalCartera})
                </label>
                <input
                  value={totalCartera}
                  onChange={(e) => setTotalCarteraPersist(e.target.value)}
                  className="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm font-mono"
                  inputMode="decimal"
                  placeholder={monedaTotalCartera === 'ARS' ? 'ej. 500000000' : 'ej. 500000'}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo líneas con peso &gt; 0. Si el total está en ARS, se divide por el TC cartera ({fxCartera}) para
                  repartir en proporción al valor en USD de cada bono.
                </p>
              </div>
              <div className="sm:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={preciosCarteraArs}
                    onChange={(e) => setPreciosCarteraArsPersist(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>Precios Px/100 de la cartera en pesos (se convierten a USD con el TC cartera)</span>
                </label>
              </div>
            </div>
          )}
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
              Agregá bonos desde la calculadora. Pesos, precios, TC y monto total se guardan en este navegador.
            </p>
          )}
          {portfolioLinesWithMetrics.map(({ line, dirtyForLine, met }) => {
            const allocUsd =
              totalCarteraNUsd != null &&
              portfolioPositiveWeightSum > 0 &&
              line.weightPct > 0
                ? totalCarteraNUsd * (line.weightPct / portfolioPositiveWeightSum)
                : null;
            const allocArs = allocUsd != null && fxCartera > 0 ? allocUsd * fxCartera : null;
            const impliedNominal =
              allocUsd != null && allocUsd > 0 && dirtyForLine > 0 ? (allocUsd * 100) / dirtyForLine : null;
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
                <div className="w-28">
                  <label
                    className="text-label mb-1 block"
                    title={
                      preciosCarteraArs
                        ? 'Precio sucio por 100 VN en ARS (se divide por TC cartera para el cálculo).'
                        : 'Precio sucio por 100 VN en USD. Vacío = precio global.'
                    }
                  >
                    Px /100{preciosCarteraArs ? ' ARS' : ' USD'}
                  </label>
                  <input
                    value={line.dirtyPricePer100}
                    onChange={(e) => updateLineDirtyPrice(line.ticker, e.target.value)}
                    placeholder={preciosCarteraArs ? dirtyGlobalArsHint || undefined : dirtyPrice}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm font-mono"
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </div>
                <div className="min-w-[112px] text-right">
                  <p className="text-label mb-1 text-left sm:text-right">Asignación USD</p>
                  <p className="font-mono text-sm font-medium">
                    {allocUsd != null ? formatCurrency(allocUsd) : '—'}
                  </p>
                </div>
                <div className="min-w-[120px] text-right">
                  <p className="text-label mb-1 text-left sm:text-right">Asignación ARS</p>
                  <p className="font-mono text-sm font-medium">
                    {allocArs != null ? formatCurrency(allocArs, 'ARS') : '—'}
                  </p>
                </div>
                <div className="min-w-[96px] text-right" title="Unidades de nominal si el precio es USD por cada 100 VN.">
                  <p className="text-label mb-1 text-left sm:text-right">VN impl.</p>
                  <p className="font-mono text-sm">
                    {impliedNominal != null && Number.isFinite(impliedNominal)
                      ? impliedNominal.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : '—'}
                  </p>
                </div>
                <div className="min-w-0 flex-1 basis-full sm:basis-0 text-sm text-muted-foreground">
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

          {portfolio.length > 0 && portfolioPositiveWeightSum > 0 && (
            <div className="space-y-4 rounded-lg border border-border/70 p-4 print:border-0 print:p-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-caption">Flujo de la cartera modelo</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Proyección desde la fecha de valuación · tickers con calendario:{' '}
                    {portfolioModelFlows.mappedTickers}/{portfolioModelFlows.totalTickers}
                    {!portfolioModelFlows.absolute && (
                      <span className="text-amber-700">
                        {' '}
                        · Montos relativos (1 punto de peso ≈ 1 VN). Ingresá monto total para flujo en dinero.
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={portfolioModelFlows.rows.length === 0}
                    onClick={() => {
                      const nominalByTicker = portfolioNominalByTicker.map;
                      exportModelPortfolioFlowExcel({
                        meta: {
                          valuationDate,
                          // Solo incluir TC si precios en ARS o monto total en ARS.
                          fxUsdArs:
                            preciosCarteraArs || monedaTotalCartera === 'ARS' ? fxCartera : null,
                          flowMode: bondFlowViewMode,
                          absoluteNominals: portfolioModelFlows.absolute,
                          totalCarteraUsd: totalCarteraNUsd,
                          portfolioYtm: portfolioAgg?.ytm ?? null,
                          portfolioDuration: portfolioAgg?.modifiedDuration ?? null,
                        },
                        lines: portfolioLinesWithMetrics
                          .filter(({ line }) => line.weightPct > 0)
                          .map(({ line, dirtyForLine, met }) => {
                            const allocUsd =
                              totalCarteraNUsd != null &&
                              portfolioPositiveWeightSum > 0 &&
                              line.weightPct > 0
                                ? totalCarteraNUsd * (line.weightPct / portfolioPositiveWeightSum)
                                : null;
                            const needFx = preciosCarteraArs || monedaTotalCartera === 'ARS';
                            const allocArs =
                              needFx && allocUsd != null && fxCartera > 0
                                ? allocUsd * fxCartera
                                : null;
                            const impliedNominal =
                              allocUsd != null && allocUsd > 0 && dirtyForLine > 0
                                ? (allocUsd * 100) / dirtyForLine
                                : null;
                            return {
                              ticker: line.ticker,
                              weightPct: line.weightPct,
                              dirtyPricePer100: dirtyForLine,
                              allocUsd,
                              allocArs,
                              impliedNominal,
                              ytm: met?.ytmAnnualEffective ?? null,
                              modifiedDuration: met?.modifiedDuration ?? null,
                            };
                          }),
                        rows: portfolioModelFlows.rows.map((r) => {
                          const t = normalizeBondTicker(r.ev.asset);
                          return {
                            ticker: r.ev.asset,
                            issuer: r.ev.issuer,
                            date: fmtIsoDate(r.ev.date),
                            currency: r.ev.currency,
                            nominal: nominalByTicker.get(t) ?? 0,
                            couponPer100: r.ev.couponPer100 ?? 0,
                            amortizationPer100: r.ev.amortizationPer100 ?? 0,
                            flowPer100: r.ev.flowPer100,
                            residualPctOfPar: r.ev.residualPctOfPar,
                            intereses: r.intereses,
                            amortizacion: r.amortizacion,
                          };
                        }),
                      });
                    }}
                  >
                    Exportar Excel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      portfolioModelFlows.rows.length === 0 ||
                      (!flowPdfSections.monthlyByBond &&
                        !flowPdfSections.annualDualAxis &&
                        !flowPdfSections.flowTable)
                    }
                    onClick={() =>
                      exportFlowReportPdf({
                        title: 'Flujo de bonos — Cartera modelo',
                        rows: portfolioModelFlows.rows.map((r) => ({
                          ticker: r.ev.asset,
                          date: fmtIsoDate(r.ev.date),
                          currency: r.ev.currency,
                          intereses: r.intereses,
                          amortizacion: r.amortizacion,
                        })),
                        totalsByCurrency: portfolioFlowTotalsByCurrency,
                        portfolioMetrics: {
                          ytm: portfolioAgg?.ytm ?? null,
                          duration: portfolioAgg?.modifiedDuration ?? null,
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
                    disabled={portfolioModelFlows.rows.length === 0}
                    onClick={() =>
                      exportExecutiveFlowReportPdf({
                        portfolioId: 'cartera-modelo',
                        clientName: 'Cartera modelo',
                        rows: portfolioModelFlows.rows.map((r) => ({
                          ticker: r.ev.asset,
                          date: fmtIsoDate(r.ev.date),
                          currency: r.ev.currency,
                          intereses: r.intereses,
                          amortizacion: r.amortizacion,
                        })),
                        tirValue: portfolioAgg?.ytm ?? null,
                        durationValue: portfolioAgg?.modifiedDuration ?? null,
                        currentValueUsd: totalCarteraNUsd ?? undefined,
                        futureValueUsd: portfolioModelFlows.absolute
                          ? portfolioFlowFutureValue
                          : undefined,
                      })
                    }
                  >
                    Exportar PDF ejecutivo
                  </Button>
                </div>
              </div>

              <div className="mb-1 flex flex-wrap gap-3 text-xs text-muted-foreground print:hidden">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={flowPdfSections.monthlyByBond}
                    onChange={(e) =>
                      setFlowPdfSections((s) => ({ ...s, monthlyByBond: e.target.checked }))
                    }
                  />
                  Gráfico mensual por bono
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={flowPdfSections.annualDualAxis}
                    onChange={(e) =>
                      setFlowPdfSections((s) => ({ ...s, annualDualAxis: e.target.checked }))
                    }
                  />
                  Vencimientos anuales
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={flowPdfSections.flowTable}
                    onChange={(e) =>
                      setFlowPdfSections((s) => ({ ...s, flowTable: e.target.checked }))
                    }
                  />
                  Tabla de flujo
                </label>
              </div>

              {portfolioFlowTotalsByCurrency.length > 0 && (
                <div className="flex flex-wrap gap-4 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                  {portfolioFlowTotalsByCurrency.map(([currency, t]) => (
                    <div key={currency} className="font-mono">
                      <span className="text-muted-foreground">{currency}</span> · Int.{' '}
                      {formatPaymentAmount(t.intereses)} · Amort. {formatPaymentAmount(t.amortizacion)} ·
                      Total {formatPaymentAmount(t.intereses + t.amortizacion)}
                    </div>
                  ))}
                </div>
              )}

              {portfolioFlowTotalsByCurrency.length > 0 && (
                <div className="space-y-4">
                  {portfolioFlowTotalsByCurrency.map(([currency]) => {
                    const rows = portfolioModelFlows.rows.filter(
                      (r) => r.ev.currency.toUpperCase() === currency.toUpperCase()
                    );
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
                        <p className="mb-2 text-sm font-medium">Gráfico mensual {currency}</p>
                        <div className="space-y-1">
                          {monthlyRows.slice(0, 48).map((r, i) => {
                            const total = r.intereses + r.amortizacion;
                            const wt = max > 0 ? (total / max) * 100 : 0;
                            const wi = total > 0 ? (r.intereses / total) * wt : 0;
                            const wa = total > 0 ? (r.amortizacion / total) * wt : 0;
                            const minSegment = 0.8;
                            const wii = r.intereses > 0 ? Math.max(wi, minSegment) : 0;
                            const waa = r.amortizacion > 0 ? Math.max(wa, minSegment) : 0;
                            const scale = wii + waa > 0 ? Math.min(1, wt / (wii + waa)) : 1;
                            return (
                              <div
                                key={`${currency}-${i}`}
                                className="grid grid-cols-[100px_1fr_120px] items-center gap-2 text-xs"
                              >
                                <span className="truncate text-muted-foreground">{r.month}</span>
                                <div className="flex h-2 overflow-hidden rounded bg-muted">
                                  <div className="bg-blue-500" style={{ width: `${wii * scale}%` }} />
                                  <div className="bg-emerald-500" style={{ width: `${waa * scale}%` }} />
                                </div>
                                <span className="text-right font-mono">{formatPaymentAmount(total)}</span>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          <span className="inline-block h-2 w-2 rounded-sm bg-blue-500 align-middle" /> Intereses{' '}
                          <span className="ml-2 inline-block h-2 w-2 rounded-sm bg-emerald-500 align-middle" />{' '}
                          Amortización
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="overflow-auto max-h-[420px]">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                      <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Fecha</th>
                      <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Moneda</th>
                      <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Intereses</th>
                      <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Amortización</th>
                      <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioModelFlows.rows.map((row, i) => (
                      <tr
                        key={`${row.ev.asset}-${row.ev.date.toISOString()}-${i}`}
                        className="border-b border-border/50"
                      >
                        <td className="p-2 font-mono">{row.ev.asset}</td>
                        <td className="p-2">{fmtIsoDate(row.ev.date)}</td>
                        <td className="p-2">{row.ev.currency}</td>
                        <td className="p-2 text-right font-mono">{formatPaymentAmount(row.intereses)}</td>
                        <td className="p-2 text-right font-mono">{formatPaymentAmount(row.amortizacion)}</td>
                        <td className="p-2 text-right font-mono">
                          {formatPaymentAmount(row.intereses + row.amortizacion)}
                        </td>
                      </tr>
                    ))}
                    {portfolioModelFlows.rows.length === 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={6}>
                          No hay flujos futuros mapeados para los bonos de la cartera (revisá pesos &gt; 0, calendario y
                          fecha de valuación).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatPaymentAmount(v: number): string {
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
