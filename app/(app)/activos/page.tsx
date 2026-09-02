'use client';

import { useState, useMemo, useEffect } from 'react';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCompact, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import type { Position, ClaseActivo } from '@/lib/schema';
import type { BondPaymentEvent } from '@/lib/bonds/types';
import { computeBondYieldMetricsForPosition } from '@/lib/bonds/position-yield';
import { filterBondEventsByViewMode } from '@/lib/bonds/flow-regime';
import { reviveBondEventsFromApi } from '@/lib/bonds/revive';
import { isCashBucketPosition } from '@/lib/cash-buckets';

interface ActivoSummary {
  /** Clave de agregación (coincide con la del consolidado por posición). */
  aggKey: string;
  ticker: string;
  descripcion: string;
  clase_activo: ClaseActivo;
  forma_legal: string | null;
  brokers: string[];
  titulares: {
    cliente_id: string;
    titular: string;
    broker: string;
    cuenta: string;
    cantidad: number;
    valor_usd: number;
  }[];
  total_usd: number;
  total_cantidad: number;
}

function isCashInstrument(p: Position): boolean {
  return p.clase_activo === 'cash' || isCashBucketPosition(p);
}

function positionAggKey(p: Position): string {
  return p.ticker ?? `_${p.cusip ?? p.descripcion.slice(0, 30)}`;
}

function buildActivoSummaries(positions: Position[]): ActivoSummary[] {
  const map = new Map<string, ActivoSummary>();

  for (const p of positions) {
    if (isCashInstrument(p)) continue;

    const key = positionAggKey(p);
    let activo = map.get(key);
    if (!activo) {
      activo = {
        aggKey: key,
        ticker: p.ticker ?? '(sin ticker)',
        descripcion: p.descripcion,
        clase_activo: p.clase_activo,
        forma_legal: p.forma_legal,
        brokers: [],
        titulares: [],
        total_usd: 0,
        total_cantidad: 0,
      };
      map.set(key, activo);
    }

    activo.total_usd += p.valor_mercado_usd ?? 0;
    activo.total_cantidad += p.cantidad;
    activo.titulares.push({
      cliente_id: p.cliente_id,
      titular: p.titular,
      broker: p.broker,
      cuenta: p.cuenta,
      cantidad: p.cantidad,
      valor_usd: p.valor_mercado_usd ?? 0,
    });

    if (!activo.brokers.includes(p.broker)) activo.brokers.push(p.broker);
  }

  return Array.from(map.values());
}

const CLASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas las clases' },
  { value: 'equity', label: 'Equity (incl. CEDEAR)' },
  { value: 'bond', label: 'Bond' },
  { value: 'etf', label: 'ETF' },
  { value: 'fund', label: 'Fund' },
  { value: 'on', label: 'ON' },
  { value: 'option', label: 'Option' },
  { value: 'letra', label: 'Letra' },
  { value: 'other', label: 'Other' },
];

const FORMA_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas las formas' },
  { value: 'directa', label: 'Directa' },
  { value: 'cedear', label: 'CEDEAR' },
  { value: 'adr', label: 'ADR' },
  { value: 'on_local', label: 'ON Local' },
  { value: 'bono_local', label: 'Bono Local' },
];

/** Misma metodología que en ficha cliente (`computeBondYieldMetricsForPosition`). */
function computeBondYtmForPosition(
  p: Position,
  events: BondPaymentEvent[],
  valuationDate: Date
): number | null {
  const metrics = computeBondYieldMetricsForPosition(p, events, valuationDate);
  const y = metrics?.ytmAnnualEffective;
  return y != null && Number.isFinite(y) ? y : null;
}

function formatTirCell(ytm: number | null | undefined): string {
  if (ytm == null || !Number.isFinite(ytm)) return '—';
  return `${(ytm * 100).toFixed(2)}%`;
}

export default function ActivosPage() {
  const { state } = useConsolidation();
  const [bondEvents, setBondEvents] = useState<BondPaymentEvent[]>([]);
  const [search, setSearch] = useState('');
  const [filterClase, setFilterClase] = useState('all');
  const [filterForma, setFilterForma] = useState('all');
  const [filterBroker, setFilterBroker] = useState('all');
  const [filterAdvisor, setFilterAdvisor] = useState('all');
  const [sortField, setSortField] = useState<'total_usd' | 'ticker' | 'titulares' | 'tir'>('total_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedAggKey, setExpandedAggKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/bonds/calendar', { cache: 'no-store' });
        const data = (await res.json()) as { events?: Array<Record<string, unknown>> };
        if (!cancelled && data.events) setBondEvents(reviveBondEventsFromApi(data.events));
      } catch {
        if (!cancelled) setBondEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bondEventsView = useMemo(
    () => filterBondEventsByViewMode(bondEvents, 'normal'),
    [bondEvents]
  );

  const positionsForActivos = useMemo(() => {
    const base =
      filterAdvisor === 'all'
        ? state.allPositions
        : state.allPositions.filter(
            (p) => (state.advisorsByCliente[p.cliente_id]?.trim() ?? '') === filterAdvisor
          );
    return base.filter((p) => !isCashInstrument(p));
  }, [state.allPositions, state.advisorsByCliente, filterAdvisor]);

  const activos = useMemo(() => buildActivoSummaries(positionsForActivos), [positionsForActivos]);

  const filtered = useMemo(() => {
    let result = activos;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) => a.ticker.toLowerCase().includes(q) || a.descripcion.toLowerCase().includes(q)
      );
    }

    if (filterClase !== 'all') result = result.filter((a) => a.clase_activo === filterClase);
    if (filterForma !== 'all') result = result.filter((a) => a.forma_legal === filterForma);
    if (filterBroker !== 'all') result = result.filter((a) => a.brokers.includes(filterBroker));

    return result;
  }, [activos, search, filterClase, filterForma, filterBroker]);

  /** TIR por instrumento agregado (posición representativa = mayor valor USD). */
  const bondYtmByAggKey = useMemo(() => {
    const map = new Map<string, number | null>();
    const now = new Date();
    const valuationDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const byKey = new Map<string, Position>();
    for (const p of positionsForActivos) {
      if (!(p.clase_activo === 'bond' || p.clase_activo === 'on' || p.clase_activo === 'letra')) continue;
      const k = positionAggKey(p);
      const prev = byKey.get(k);
      const usd = p.valor_mercado_usd ?? 0;
      if (!prev || (prev.valor_mercado_usd ?? 0) < usd) byKey.set(k, p);
    }
    for (const [k, p] of byKey) {
      map.set(k, computeBondYtmForPosition(p, bondEventsView, valuationDate));
    }
    return map;
  }, [positionsForActivos, bondEventsView]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'total_usd':
          cmp = a.total_usd - b.total_usd;
          break;
        case 'ticker':
          cmp = a.ticker.localeCompare(b.ticker);
          break;
        case 'titulares':
          cmp = a.titulares.length - b.titulares.length;
          break;
        case 'tir': {
          const avRaw = bondYtmByAggKey.get(a.aggKey);
          const bvRaw = bondYtmByAggKey.get(b.aggKey);
          const av = avRaw != null && Number.isFinite(avRaw) ? avRaw : null;
          const bv = bvRaw != null && Number.isFinite(bvRaw) ? bvRaw : null;
          if (av == null && bv == null) cmp = 0;
          else if (av == null) cmp = 1;
          else if (bv == null) cmp = -1;
          else cmp = av - bv;
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [filtered, sortField, sortDir, bondYtmByAggKey]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const totalAum = useMemo(() => filtered.reduce((s, a) => s + a.total_usd, 0), [filtered]);
  const allBrokers = useMemo(
    () => [...new Set(positionsForActivos.map((p) => p.broker))].sort(),
    [positionsForActivos]
  );
  const advisorFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of positionsForActivos) {
      const a = state.advisorsByCliente[p.cliente_id]?.trim();
      if (a) names.add(a);
    }
    return [...names].sort();
  }, [positionsForActivos, state.advisorsByCliente]);

  const byClase = useMemo(
    () =>
      filtered.reduce<Record<string, number>>((acc, a) => {
        acc[a.clase_activo] = (acc[a.clase_activo] ?? 0) + a.total_usd;
        return acc;
      }, {}),
    [filtered]
  );

  const tableColSpan = 10;

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="page-title">Activos</h2>
        <p className="mt-4 text-muted-foreground">
          Subí archivos en{' '}
          <Link href="/upload" className="text-primary underline">
            Upload
          </Link>{' '}
          primero.
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div>
        <h2 className="page-title">Activos ({filtered.length} instrumentos)</h2>
        <p className="page-subtitle">
          Exposición agregada por instrumento cross-broker · el efectivo está en{' '}
          <Link href="/cash" className="text-primary underline-offset-2 hover:underline">
            Cash
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {Object.entries(byClase)
          .sort(([, a], [, b]) => b - a)
          .map(([clase, value]) => (
            <Card
              key={clase}
              className={`cursor-pointer transition-colors ${filterClase === clase ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilterClase(filterClase === clase ? 'all' : clase)}
            >
              <CardContent className="p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">{clase}</p>
                <p className="mt-0.5 text-lg font-semibold">{formatCompact(value)}</p>
              </CardContent>
            </Card>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="text"
          placeholder="Buscar ticker, descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72 rounded-md border bg-background px-3 text-sm"
        />
        <select
          value={filterClase}
          onChange={(e) => setFilterClase(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {CLASE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filterForma}
          onChange={(e) => setFilterForma(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {FORMA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filterBroker}
          onChange={(e) => setFilterBroker(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Todos los brokers</option>
          {allBrokers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          value={filterAdvisor}
          onChange={(e) => setFilterAdvisor(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Todos los advisors</option>
          {advisorFilterOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {(filterClase !== 'all' ||
          filterForma !== 'all' ||
          filterBroker !== 'all' ||
          filterAdvisor !== 'all' ||
          search) && (
          <button
            onClick={() => {
              setSearch('');
              setFilterClase('all');
              setFilterForma('all');
              setFilterBroker('all');
              setFilterAdvisor('all');
            }}
            className="text-sm text-primary hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[700px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-card">
                <tr>
                  <th
                    className="cursor-pointer p-3 text-left text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('ticker')}
                  >
                    Ticker {sortField === 'ticker' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="p-3 text-left text-xs font-medium uppercase text-muted-foreground">Descripción</th>
                  <th className="p-3 text-left text-xs font-medium uppercase text-muted-foreground">Clase</th>
                  <th className="p-3 text-left text-xs font-medium uppercase text-muted-foreground">Forma Legal</th>
                  <th
                    className="cursor-pointer whitespace-nowrap p-3 text-right text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('tir')}
                  >
                    TIR {sortField === 'tir' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="p-3 text-left text-xs font-medium uppercase text-muted-foreground">Brokers</th>
                  <th
                    className="cursor-pointer p-3 text-center text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('titulares')}
                  >
                    Titulares {sortField === 'titulares' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="p-3 text-right text-xs font-medium uppercase text-muted-foreground">Cant. Total</th>
                  <th
                    className="cursor-pointer p-3 text-right text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('total_usd')}
                  >
                    Valor USD {sortField === 'total_usd' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="p-3 text-right text-xs font-medium uppercase text-muted-foreground">% Book</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 300).map((activo) => {
                  const isExpanded = expandedAggKey === activo.aggKey;
                  const tirCell = formatTirCell(bondYtmByAggKey.get(activo.aggKey) ?? null);
                  return (
                    <ActivoRow
                      key={activo.aggKey}
                      activo={activo}
                      totalAum={totalAum}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedAggKey(isExpanded ? null : activo.aggKey)}
                      tirCell={tirCell}
                      tableColSpan={tableColSpan}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ActivoRow({
  activo,
  totalAum,
  isExpanded,
  onToggle,
  tirCell,
  tableColSpan,
}: {
  activo: ActivoSummary;
  totalAum: number;
  isExpanded: boolean;
  onToggle: () => void;
  tirCell: string;
  tableColSpan: number;
}) {
  const displayPct = totalAum > 0 ? (activo.total_usd / totalAum) * 100 : 0;
  const uniqueTitulares = new Set(activo.titulares.map((t) => t.cliente_id)).size;

  return (
    <>
      <tr className="cursor-pointer border-b border-border/50 hover:bg-muted/50" onClick={onToggle}>
        <td className="p-3 font-mono font-medium">{activo.ticker}</td>
        <td className="max-w-[250px] truncate p-3 text-muted-foreground" title={activo.descripcion}>
          {activo.descripcion}
        </td>
        <td className="p-3">
          <Badge variant="secondary" className="text-xs">
            {activo.clase_activo}
          </Badge>
        </td>
        <td className="p-3 text-xs text-muted-foreground">{activo.forma_legal ?? '—'}</td>
        <td className="p-3 text-right font-mono tabular-nums text-muted-foreground">{tirCell}</td>
        <td className="p-3">
          <div className="flex gap-1">
            {activo.brokers.map((b) => (
              <Badge key={b} variant="outline" className="text-xs">
                {b}
              </Badge>
            ))}
          </div>
        </td>
        <td className="p-3 text-center">{uniqueTitulares}</td>
        <td className="p-3 text-right font-mono">{activo.total_cantidad.toLocaleString()}</td>
        <td className="p-3 text-right font-mono font-medium">{formatCurrency(activo.total_usd)}</td>
        <td className="p-3 text-right text-muted-foreground">{displayPct.toFixed(1)}%</td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={tableColSpan} className="p-4">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Tenedores de {activo.ticker}
            </p>
            <div className="max-h-[380px] overflow-auto rounded-md border border-border/50">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="border-b">
                    <th className="p-1.5 text-left font-medium text-muted-foreground">Titular</th>
                    <th className="p-1.5 text-left font-medium text-muted-foreground">Broker</th>
                    <th className="p-1.5 text-left font-medium text-muted-foreground">Cuenta</th>
                    <th className="p-1.5 text-right font-medium text-muted-foreground">Cantidad</th>
                    <th className="p-1.5 text-right font-medium text-muted-foreground">Valor USD</th>
                  </tr>
                </thead>
                <tbody>
                  {activo.titulares
                    .slice()
                    .sort((a, b) => b.valor_usd - a.valor_usd)
                    .map((t, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="p-1.5">
                          <Link
                            href={`/clientes/${t.cliente_id}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t.titular}
                          </Link>
                        </td>
                        <td className="p-1.5 text-muted-foreground">{t.broker}</td>
                        <td className="p-1.5 font-mono text-muted-foreground">{t.cuenta}</td>
                        <td className="p-1.5 text-right font-mono tabular-nums">
                          {t.cantidad.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </td>
                        <td className="p-1.5 text-right font-mono">{formatCurrency(t.valor_usd)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
