'use client';

import { useState, useMemo } from 'react';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatCompact, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import type { Position, ClaseActivo } from '@/lib/schema';

type CashBucketKey =
  | 'ars'
  | 'cable'
  | 'especie_7000'
  | 'especie_10000'
  | 'mep'
  | 'money_market'
  | 'usd_cash'
  | 'eur'
  | 'usd';

/** Buckets fijos para columnas de CASH (orden de visualización). */
const CASH_BUCKET_DEFS: { key: CashBucketKey; label: string }[] = [
  { key: 'ars', label: 'ARS' },
  { key: 'cable', label: 'Cable' },
  { key: 'especie_7000', label: 'Especie 7000' },
  { key: 'especie_10000', label: 'Especie 10000' },
  { key: 'mep', label: 'USD MEP' },
  { key: 'money_market', label: 'Money market' },
  { key: 'usd_cash', label: 'USD cash' },
  { key: 'eur', label: 'EUR' },
  { key: 'usd', label: 'USD (sin clasificar)' },
];

interface ActivoSummary {
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
    moneda: string;
    moneda_subtipo: string | null;
    /** Bucket estable para columnas; null si no es cash */
    cash_bucket: CashBucketKey | null;
  }[];
  total_usd: number;
  total_cantidad: number;
}

function buildActivoSummaries(positions: Position[]): ActivoSummary[] {
  const map = new Map<string, ActivoSummary>();

  for (const p of positions) {
    const key = p.ticker ?? `_${p.cusip ?? p.descripcion.slice(0, 30)}`;

    let activo = map.get(key);
    if (!activo) {
      activo = {
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
      moneda: p.moneda,
      moneda_subtipo: p.moneda_subtipo,
      cash_bucket: p.clase_activo === 'cash' ? getCashBucketKey(p) : null,
    });

    if (!activo.brokers.includes(p.broker)) activo.brokers.push(p.broker);
  }

  return Array.from(map.values());
}

/**
 * Clasifica cash en un bucket estable.
 *
 * Importante: en GMA el efectivo en USD (MEP/Cable/7000/10000) suele venir con
 * `moneda: 'ARS'` porque la valuación está en pesos; por eso **primero** miramos
 * `moneda_subtipo` y la descripción, y recién al final tratamos ARS “puro”.
 */
function getCashBucketKey(p: Position): CashBucketKey {
  const sub = (p.moneda_subtipo ?? '').trim().toLowerCase();
  const desc = (p.descripcion ?? '').toLowerCase();

  if (sub === '7000') return 'especie_7000';
  if (sub === '10000') return 'especie_10000';
  if (sub === 'cable') return 'cable';
  if (sub === 'mep') return 'mep';
  if (sub === 'money_market' || sub === 'money market') return 'money_market';
  if (sub === 'usd_cash' || sub === 'usd cash') return 'usd_cash';
  if (sub === 'eur') return 'eur';

  // Heurísticas por texto (GMA/IEB a veces solo dejan la etiqueta en descripción)
  if (/\b7000\b|dolar\s*7000|usd\s*7000|especie\s*7000/.test(desc)) return 'especie_7000';
  if (/\b10000\b|dolar\s*10000|especie\s*10000/.test(desc)) return 'especie_10000';
  if (/cable|dólar\s*cable|dolar\s*cable/.test(desc)) return 'cable';
  if (/\bmep\b|dolar\s*mep/.test(desc)) return 'mep';
  if (/money\s*market|\bmmf\b/.test(desc)) return 'money_market';

  if (p.moneda === 'EUR') return 'eur';

  // Pesos: solo cuando no hay subtipo “dólar” ya resuelto arriba
  if (p.moneda === 'ARS' && (!sub || sub === 'ars')) return 'ars';

  // Offshore u otros USD sin subtipo
  if (p.moneda === 'USD') return 'usd';

  // ARS con subtipo residual (no debería pasar en cash típico)
  if (p.moneda === 'ARS') return 'ars';

  return 'usd';
}

const CLASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas las clases' },
  { value: 'equity', label: 'Equity' },
  { value: 'bond', label: 'Bond' },
  { value: 'etf', label: 'ETF' },
  { value: 'cedear', label: 'CEDEAR' },
  { value: 'cash', label: 'Cash' },
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

const ALL_CASH_BUCKET_KEYS: CashBucketKey[] = CASH_BUCKET_DEFS.map(d => d.key);

export default function ActivosPage() {
  const { state } = useConsolidation();
  const [search, setSearch] = useState('');
  const [filterClase, setFilterClase] = useState('all');
  const [filterForma, setFilterForma] = useState('all');
  const [filterBroker, setFilterBroker] = useState('all');
  const [sortField, setSortField] = useState<'total_usd' | 'ticker' | 'titulares'>('total_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  /** Columnas de efectivo visibles en la tabla de tenedores (multi-selección; por defecto todas). */
  const [cashColumnKeys, setCashColumnKeys] = useState<Set<CashBucketKey>>(
    () => new Set(ALL_CASH_BUCKET_KEYS)
  );

  const visibleCashBuckets = useMemo(
    () => CASH_BUCKET_DEFS.filter(d => cashColumnKeys.has(d.key)),
    [cashColumnKeys]
  );

  const toggleCashColumn = (key: CashBucketKey) => {
    setCashColumnKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllCashColumns = () => setCashColumnKeys(new Set(ALL_CASH_BUCKET_KEYS));

  const activos = useMemo(() => buildActivoSummaries(state.allPositions), [state.allPositions]);

  const filtered = useMemo(() => {
    let result = activos;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        a.descripcion.toLowerCase().includes(q)
      );
    }

    if (filterClase !== 'all') result = result.filter(a => a.clase_activo === filterClase);
    if (filterForma !== 'all') result = result.filter(a => a.forma_legal === filterForma);
    if (filterBroker !== 'all') result = result.filter(a => a.brokers.includes(filterBroker));

    return result;
  }, [activos, search, filterClase, filterForma, filterBroker]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'total_usd': cmp = a.total_usd - b.total_usd; break;
        case 'ticker': cmp = a.ticker.localeCompare(b.ticker); break;
        case 'titulares': cmp = a.titulares.length - b.titulares.length; break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [filtered, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const totalAum = activos.reduce((s, a) => s + a.total_usd, 0);
  const allBrokers = [...new Set(activos.flatMap(a => a.brokers))].sort();

  // Aggregates for summary cards
  const byClase = activos.reduce<Record<string, number>>((acc, a) => {
    acc[a.clase_activo] = (acc[a.clase_activo] ?? 0) + a.total_usd;
    return acc;
  }, {});

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="page-title">Activos</h2>
        <p className="text-muted-foreground mt-4">Subí archivos en <Link href="/upload" className="text-primary underline">Upload</Link> primero.</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div>
        <h2 className="page-title">Activos ({activos.length} instrumentos)</h2>
        <p className="page-subtitle">Exposición agregada por instrumento cross-broker</p>
      </div>

      {/* Summary by class */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {Object.entries(byClase)
          .sort(([, a], [, b]) => b - a)
          .map(([clase, value]) => (
            <Card key={clase} className={`cursor-pointer transition-colors ${filterClase === clase ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilterClase(filterClase === clase ? 'all' : clase)}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground font-medium uppercase">{clase}</p>
                <p className="text-lg font-semibold mt-0.5">{formatCompact(value)}</p>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <input
          type="text"
          placeholder="Buscar ticker, descripción..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 w-72 rounded-md border bg-background px-3 text-sm"
        />
        <select value={filterClase} onChange={e => setFilterClase(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          {CLASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterForma} onChange={e => setFilterForma(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          {FORMA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="all">Todos los brokers</option>
          {allBrokers.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        {(filterClase !== 'all' || filterForma !== 'all' || filterBroker !== 'all' || search) && (
          <button
            onClick={() => { setSearch(''); setFilterClase('all'); setFilterForma('all'); setFilterBroker('all'); }}
            className="text-sm text-primary hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Columnas visibles para CASH (tenedores) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-h3">Columnas cash (tenedores)</CardTitle>
          <p className="text-label mt-1">
            Elegí qué rubros de efectivo mostrar al expandir un instrumento CASH. Solo se listan las columnas activas.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {CASH_BUCKET_DEFS.map(({ key, label }) => {
            const on = cashColumnKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleCashColumn(key)}
                className={cn(
                  'rounded-pill border-[0.5px] px-3 py-1.5 text-xs font-medium transition-colors duration-[120ms]',
                  on
                    ? 'border-navy-700 bg-navy-700 text-white shadow-none'
                    : 'border-border bg-card text-muted-foreground hover:border-navy-300 hover:text-foreground'
                )}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={selectAllCashColumns}
            className="ml-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Mostrar todas
          </button>
        </CardContent>
      </Card>

      {/* Activos table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[700px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('ticker')}>
                    Ticker {sortField === 'ticker' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Descripción</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Forma Legal</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Brokers</th>
                  <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('titulares')}>
                    Titulares {sortField === 'titulares' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">Cant. Total</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('total_usd')}>
                    Valor USD {sortField === 'total_usd' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 300).map(activo => {
                  const isExpanded = expandedTicker === activo.ticker;
                  return (
                    <ActivoRow
                      key={activo.ticker}
                      activo={activo}
                      totalAum={totalAum}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedTicker(isExpanded ? null : activo.ticker)}
                      visibleCashBuckets={visibleCashBuckets}
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

function ActivoRow({ activo, totalAum, isExpanded, onToggle, visibleCashBuckets }: {
  activo: ActivoSummary;
  totalAum: number;
  isExpanded: boolean;
  onToggle: () => void;
  visibleCashBuckets: { key: CashBucketKey; label: string }[];
}) {
  const pct = totalAum > 0 ? (activo.total_usd / totalAum) * 100 : 0;
  const uniqueTitulares = new Set(activo.titulares.map(t => t.cliente_id)).size;
  const isCash = activo.clase_activo === 'cash' || activo.ticker === 'CASH';
  const subtotalByBucket = useMemo(() => {
    const subtotals: Partial<Record<CashBucketKey, number>> = {};
    for (const t of activo.titulares) {
      if (t.cash_bucket == null) continue;
      subtotals[t.cash_bucket] = (subtotals[t.cash_bucket] ?? 0) + t.valor_usd;
    }
    return subtotals;
  }, [activo.titulares]);

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/50 cursor-pointer" onClick={onToggle}>
        <td className="p-3 font-mono font-medium">{activo.ticker}</td>
        <td className="p-3 text-muted-foreground max-w-[250px] truncate" title={activo.descripcion}>{activo.descripcion}</td>
        <td className="p-3"><Badge variant="secondary" className="text-xs">{activo.clase_activo}</Badge></td>
        <td className="p-3 text-xs text-muted-foreground">{activo.forma_legal ?? '—'}</td>
        <td className="p-3">
          <div className="flex gap-1">{activo.brokers.map(b => <Badge key={b} variant="outline" className="text-xs">{b}</Badge>)}</div>
        </td>
        <td className="p-3 text-center">{uniqueTitulares}</td>
        <td className="p-3 text-right font-mono">{activo.total_cantidad.toLocaleString()}</td>
        <td className="p-3 text-right font-mono font-medium">{formatCurrency(activo.total_usd)}</td>
        <td className="p-3 text-right text-muted-foreground">{pct.toFixed(1)}%</td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={9} className="p-0">
            <div className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase">Tenedores de {activo.ticker}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-1.5 font-medium text-muted-foreground">Titular</th>
                    <th className="text-left p-1.5 font-medium text-muted-foreground">Broker</th>
                    <th className="text-left p-1.5 font-medium text-muted-foreground">Cuenta</th>
                    <th className="text-right p-1.5 font-medium text-muted-foreground">Cantidad</th>
                    {isCash &&
                      visibleCashBuckets.map(({ key, label }) => (
                        <th key={key} className="text-right p-1.5 font-medium text-muted-foreground whitespace-nowrap">
                          {label}
                        </th>
                      ))}
                    <th className="text-right p-1.5 font-medium text-muted-foreground">Valor USD</th>
                  </tr>
                </thead>
                <tbody>
                  {activo.titulares
                    .sort((a, b) => b.valor_usd - a.valor_usd)
                    .map((t, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="p-1.5">
                          <Link href={`/clientes/${t.cliente_id}`} className="text-primary hover:underline">{t.titular}</Link>
                        </td>
                        <td className="p-1.5 text-muted-foreground">{t.broker}</td>
                        <td className="p-1.5 font-mono text-muted-foreground">{t.cuenta}</td>
                        <td className="p-1.5 text-right font-mono">{t.cantidad.toLocaleString()}</td>
                        {isCash &&
                          visibleCashBuckets.map(({ key }) => (
                            <td key={key} className="p-1.5 text-right font-mono">
                              {t.cash_bucket === key ? formatCurrency(t.valor_usd) : '—'}
                            </td>
                          ))}
                        <td className="p-1.5 text-right font-mono">{formatCurrency(t.valor_usd)}</td>
                      </tr>
                    ))}
                  {isCash && (
                    <tr className="border-t-2 border-border font-medium bg-muted/20">
                      <td className="p-1.5">Subtotal</td>
                      <td className="p-1.5" />
                      <td className="p-1.5" />
                      <td className="p-1.5 text-right font-mono">
                        {activo.titulares.reduce((sum, t) => sum + t.cantidad, 0).toLocaleString()}
                      </td>
                      {visibleCashBuckets.map(({ key }) => (
                        <td key={key} className="p-1.5 text-right font-mono">
                          {formatCurrency(subtotalByBucket[key] ?? 0)}
                        </td>
                      ))}
                      <td className="p-1.5 text-right font-mono">{formatCurrency(activo.total_usd)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
