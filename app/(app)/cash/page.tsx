'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency } from '@/lib/utils';
import type { Position } from '@/lib/schema';
import {
  CASH_BUCKET_DEFS,
  formatCashBucketAmount,
  getCashBucketKey,
  getCashCellValue,
  isCashBucketPosition,
  type CashBucketKey,
} from '@/lib/cash-buckets';

const ALL_CASH_BUCKET_KEYS: CashBucketKey[] = CASH_BUCKET_DEFS.map((d) => d.key);

interface CashHolderRow {
  cliente_id: string;
  titular: string;
  brokerLabel: string;
  cuentaLabel: string;
  total_usd: number;
  byBucket: Partial<Record<CashBucketKey, number>>;
}

function buildCashHolderRows(
  positions: Position[],
  cashColumnKeys: ReadonlySet<CashBucketKey>
): CashHolderRow[] {
  const byClient = new Map<
    string,
    {
      cliente_id: string;
      titular: string;
      brokers: Set<string>;
      cuentas: Set<string>;
      total_usd: number;
      byBucket: Partial<Record<CashBucketKey, number>>;
    }
  >();

  for (const p of positions) {
    if (!isCashBucketPosition(p) && p.clase_activo !== 'cash') continue;
    const bucket = getCashBucketKey(p);
    if (!cashColumnKeys.has(bucket)) continue;

    let row = byClient.get(p.cliente_id);
    if (!row) {
      row = {
        cliente_id: p.cliente_id,
        titular: p.titular,
        brokers: new Set<string>(),
        cuentas: new Set<string>(),
        total_usd: 0,
        byBucket: {},
      };
      byClient.set(p.cliente_id, row);
    }
    row.brokers.add(p.broker);
    row.cuentas.add(p.cuenta);
    row.total_usd += p.valor_mercado_usd ?? 0;
    const cell = getCashCellValue(
      {
        valor_usd: p.valor_mercado_usd ?? 0,
        valor_local: p.valor_mercado_local,
        moneda: p.moneda,
      },
      bucket
    );
    row.byBucket[bucket] = (row.byBucket[bucket] ?? 0) + cell;
  }

  return Array.from(byClient.values())
    .filter((r) => r.total_usd > 0 || Object.keys(r.byBucket).length > 0)
    .map((r) => ({
      cliente_id: r.cliente_id,
      titular: r.titular,
      brokerLabel: r.brokers.size === 1 ? [...r.brokers][0]! : 'Varios',
      cuentaLabel: r.cuentas.size === 1 ? [...r.cuentas][0]! : `${r.cuentas.size} cuentas`,
      total_usd: r.total_usd,
      byBucket: r.byBucket,
    }))
    .sort((a, b) => b.total_usd - a.total_usd);
}

export default function CashPage() {
  const { state } = useConsolidation();
  const [search, setSearch] = useState('');
  const [filterBroker, setFilterBroker] = useState('all');
  const [filterAdvisor, setFilterAdvisor] = useState('all');
  const [cashColumnKeys, setCashColumnKeys] = useState<Set<CashBucketKey>>(
    () => new Set(ALL_CASH_BUCKET_KEYS)
  );
  const [sortField, setSortField] = useState<'titular' | 'total_usd'>('total_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const visibleCashBuckets = useMemo(
    () => CASH_BUCKET_DEFS.filter((d) => cashColumnKeys.has(d.key)),
    [cashColumnKeys]
  );

  const positions = useMemo(() => {
    if (filterAdvisor === 'all') return state.allPositions;
    return state.allPositions.filter(
      (p) => (state.advisorsByCliente[p.cliente_id]?.trim() ?? '') === filterAdvisor
    );
  }, [state.allPositions, state.advisorsByCliente, filterAdvisor]);

  const rows = useMemo(
    () => buildCashHolderRows(positions, cashColumnKeys),
    [positions, cashColumnKeys]
  );

  const brokers = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.brokerLabel !== 'Varios') set.add(r.brokerLabel);
    }
    return Array.from(set).sort();
  }, [rows]);

  const advisors = useMemo(() => {
    const set = new Set<string>();
    for (const [id, name] of Object.entries(state.advisorsByCliente)) {
      const n = name?.trim();
      if (n && rows.some((r) => r.cliente_id === id)) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [state.advisorsByCliente, rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.titular.toLowerCase().includes(q) ||
          r.cliente_id.toLowerCase().includes(q) ||
          r.cuentaLabel.toLowerCase().includes(q) ||
          r.brokerLabel.toLowerCase().includes(q)
      );
    }
    if (filterBroker !== 'all') {
      result = result.filter((r) => {
        if (r.brokerLabel === filterBroker) return true;
        if (r.brokerLabel !== 'Varios') return false;
        return positions.some(
          (p) =>
            p.cliente_id === r.cliente_id &&
            p.broker === filterBroker &&
            (isCashBucketPosition(p) || p.clase_activo === 'cash')
        );
      });
    }
    return result;
  }, [rows, search, filterBroker, positions]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const cmp =
        sortField === 'titular' ? a.titular.localeCompare(b.titular) : a.total_usd - b.total_usd;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totals = useMemo(() => {
    const byBucket: Partial<Record<CashBucketKey, number>> = {};
    let totalUsd = 0;
    for (const r of sorted) {
      totalUsd += r.total_usd;
      for (const { key } of visibleCashBuckets) {
        if (r.byBucket[key] != null) {
          byBucket[key] = (byBucket[key] ?? 0) + (r.byBucket[key] ?? 0);
        }
      }
    }
    return { byBucket, totalUsd };
  }, [sorted, visibleCashBuckets]);

  const toggleCashColumn = (key: CashBucketKey) => {
    setCashColumnKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSort = (field: 'titular' | 'total_usd') => {
    if (sortField === field) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortField(field);
      setSortDir(field === 'titular' ? 'asc' : 'desc');
    }
  };

  if (!state.hasParsed || state.allPositions.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Cash</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No hay consolidación cargada. Subí archivos en Upload o sincronizá Drive.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cash</h1>
        <p className="text-sm text-muted-foreground">
          Tenedores de efectivo por titular · {sorted.length} clientes
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Columnas de segmento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 pt-0">
          {CASH_BUCKET_DEFS.map(({ key, label }) => {
            const on = cashColumnKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleCashColumn(key)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  on
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                )}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCashColumnKeys(new Set(ALL_CASH_BUCKET_KEYS))}
            className="ml-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Mostrar todas
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar titular, cuenta o broker…"
            className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
          <select
            value={filterBroker}
            onChange={(e) => setFilterBroker(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">Todos los brokers</option>
            {brokers.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {advisors.length > 0 && (
            <select
              value={filterAdvisor}
              onChange={(e) => setFilterAdvisor(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">Todos los advisors</option>
              {advisors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          <Badge variant="secondary" className="tabular-nums">
            Total {formatCurrency(totals.totalUsd)}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-16rem)] overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-30 cursor-pointer whitespace-nowrap border-b border-r bg-card p-3 text-left text-xs font-medium uppercase text-muted-foreground shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)] hover:text-foreground"
                    onClick={() => toggleSort('titular')}
                  >
                    Titular {sortField === 'titular' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="sticky top-0 z-20 border-b bg-card p-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Broker
                  </th>
                  <th className="sticky top-0 z-20 border-b bg-card p-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Cuenta
                  </th>
                  {visibleCashBuckets.map(({ key, label }) => (
                    <th
                      key={key}
                      className="sticky top-0 z-20 whitespace-nowrap border-b bg-card p-3 text-right text-xs font-medium uppercase text-muted-foreground"
                    >
                      {label}
                    </th>
                  ))}
                  <th
                    className="sticky top-0 z-20 cursor-pointer whitespace-nowrap border-b bg-card p-3 text-right text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('total_usd')}
                  >
                    Valor USD {sortField === 'total_usd' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.cliente_id} className="group hover:bg-muted/40">
                    <td className="sticky left-0 z-10 border-b border-r border-border/40 bg-background p-3 font-medium shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)] group-hover:bg-muted/40">
                      <Link href={`/clientes/${r.cliente_id}`} className="text-primary hover:underline">
                        {r.titular}
                      </Link>
                    </td>
                    <td className="border-b border-border/40 p-3 text-muted-foreground">{r.brokerLabel}</td>
                    <td className="border-b border-border/40 p-3 font-mono text-muted-foreground">{r.cuentaLabel}</td>
                    {visibleCashBuckets.map(({ key }) => (
                      <td key={key} className="border-b border-border/40 p-3 text-right font-mono tabular-nums">
                        {r.byBucket[key] != null
                          ? formatCashBucketAmount(key, r.byBucket[key] ?? 0, formatCurrency)
                          : '—'}
                      </td>
                    ))}
                    <td className="border-b border-border/40 p-3 text-right font-mono font-medium tabular-nums">
                      {formatCurrency(r.total_usd)}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={3 + visibleCashBuckets.length + 1}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      No hay tenedores de cash con los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr className="font-medium">
                    <td className="sticky left-0 z-10 border-t-2 border-r border-border bg-muted/50 p-3 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]">
                      Total ({sorted.length})
                    </td>
                    <td className="border-t-2 border-border bg-muted/30 p-3" />
                    <td className="border-t-2 border-border bg-muted/30 p-3" />
                    {visibleCashBuckets.map(({ key }) => (
                      <td
                        key={key}
                        className="border-t-2 border-border bg-muted/30 p-3 text-right font-mono tabular-nums"
                      >
                        {totals.byBucket[key] != null
                          ? formatCashBucketAmount(key, totals.byBucket[key] ?? 0, formatCurrency)
                          : '—'}
                      </td>
                    ))}
                    <td className="border-t-2 border-border bg-muted/30 p-3 text-right font-mono tabular-nums">
                      {formatCurrency(totals.totalUsd)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
