'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { Position } from '@/lib/schema';
import {
  detectInconsistencies,
  type Inconsistency,
  type InconsistencyTipo,
} from '@/lib/analysis/inconsistencies';

const TIPO_ORDER: InconsistencyTipo[] = [
  'precio_distinto',
  'cantidad_negativa',
  'fecha_desalineada',
  'duplicado_titular',
  'ticker_sin_clasificar',
  'titular_sin_mapear',
  'cash_negativo',
  'posicion_residual',
];

const TIPO_LABEL: Record<InconsistencyTipo, string> = {
  precio_distinto: 'Precio distinto entre brokers',
  cantidad_negativa: 'Cantidad negativa',
  fecha_desalineada: 'Fecha desalineada',
  duplicado_titular: 'Titular duplicado (varios cliente_id)',
  ticker_sin_clasificar: 'Ticker sin clasificar',
  titular_sin_mapear: 'Titular sin mapear',
  cash_negativo: 'Cash negativo',
  posicion_residual: 'Posición residual',
};

function severityVariant(s: Inconsistency['severity']): 'destructive' | 'warning' | 'secondary' {
  if (s === 'error') return 'destructive';
  if (s === 'warning') return 'warning';
  return 'secondary';
}

export default function InconsistenciasPage() {
  const { state } = useConsolidation();
  const all = useMemo(() => detectInconsistencies(state.allPositions), [state.allPositions]);

  const [sev, setSev] = useState<{ error: boolean; warning: boolean; info: boolean }>({
    error: true,
    warning: true,
    info: true,
  });

  const filtered = useMemo(() => {
    return all.filter((x) => {
      if (x.severity === 'error') return sev.error;
      if (x.severity === 'warning') return sev.warning;
      return sev.info;
    });
  }, [all, sev]);

  const countsByTipo = useMemo(() => {
    const m = new Map<InconsistencyTipo, { rows: number; pos: number }>();
    for (const t of TIPO_ORDER) m.set(t, { rows: 0, pos: 0 });
    for (const inc of filtered) {
      const cur = m.get(inc.tipo)!;
      cur.rows += 1;
      cur.pos += inc.posiciones_afectadas.length;
    }
    return m;
  }, [filtered]);

  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) => {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Inconsistencias</h2>
        <p className="text-muted-foreground mt-4">
          Parseá archivos en{' '}
          <Link href="/upload" className="text-primary underline">
            Upload
          </Link>{' '}
          para detectar problemas en los datos.
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell max-w-6xl">
      <div className="page-header">
        <div>
          <h2 className="page-title">Inconsistencias</h2>
          <p className="page-subtitle">
          Hallazgos automáticos antes de presentar al cliente o exportar reportes.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <span className="text-sm text-muted-foreground">Severidad:</span>
        {(
          [
            ['error', 'Error'],
            ['warning', 'Warning'],
            ['info', 'Info'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={sev[k]}
              onChange={() => setSev((s) => ({ ...s, [k]: !s[k] }))}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {TIPO_ORDER.map((t) => {
          const c = countsByTipo.get(t)!;
          if (c.rows === 0) return null;
          return (
            <Badge key={t} variant="outline" className="text-xs">
              {TIPO_LABEL[t]}: {c.rows} hallazgo{c.rows === 1 ? '' : 's'} · {c.pos} pos.
            </Badge>
          );
        })}
        {filtered.length === 0 && (
          <span className="text-sm text-muted-foreground">Nada que mostrar con estos filtros.</span>
        )}
      </div>

      <div className="space-y-6">
        {TIPO_ORDER.map((tipo) => {
          const items = filtered.filter((x) => x.tipo === tipo);
          if (items.length === 0) return null;
          return (
            <Card key={tipo}>
              <CardHeader>
                <CardTitle className="text-base">{TIPO_LABEL[tipo]}</CardTitle>
                <CardDescription>
                  {items.length} hallazgo{items.length === 1 ? '' : 's'} ·{' '}
                  {items.reduce((s, i) => s + i.posiciones_afectadas.length, 0)} posición(es) referenciada(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((inc, j) => {
                  const key = `${tipo}-${j}`;
                  const isOpen = open.has(key);
                  return (
                    <div key={key} className="rounded-lg border bg-card">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 p-3 text-left"
                        onClick={() => toggle(key)}
                      >
                        <span className="mt-0.5 text-muted-foreground shrink-0">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-wrap gap-2 items-center">
                            <Badge variant={severityVariant(inc.severity)}>{inc.severity}</Badge>
                            {inc.broker && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {inc.broker}
                              </Badge>
                            )}
                            {inc.ticker && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {inc.ticker}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{inc.descripcion}</p>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="border-t px-3 pb-3">
                          <AffectedTable indices={inc.posiciones_afectadas} positions={state.allPositions} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function AffectedTable({ indices, positions }: { indices: number[]; positions: Position[] }) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  return (
    <div className="overflow-auto max-h-56 mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left p-2 font-medium">Titular</th>
            <th className="text-left p-2 font-medium">Cliente</th>
            <th className="text-left p-2 font-medium">Broker</th>
            <th className="text-left p-2 font-medium">Ticker</th>
            <th className="text-right p-2 font-medium">Valor USD</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((i) => {
            const p = positions[i];
            if (!p) return null;
            return (
              <tr key={i} className="border-b border-border/40 hover:bg-muted/40">
                <td className="p-2 max-w-[140px] truncate" title={p.titular}>
                  {p.titular}
                </td>
                <td className="p-2">
                  <Link href={`/clientes/${encodeURIComponent(p.cliente_id)}`} className="text-primary font-mono hover:underline">
                    {p.cliente_id.slice(0, 12)}
                    {p.cliente_id.length > 12 ? '…' : ''}
                  </Link>
                </td>
                <td className="p-2 font-mono">{p.broker}</td>
                <td className="p-2 font-mono">{p.ticker ?? '—'}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
