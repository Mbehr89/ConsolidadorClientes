'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { brokerColorClass, formatCompact, formatCurrency, formatPct } from '@/lib/utils';
import { BROKERS } from '@/lib/brokers';
import type { Position } from '@/lib/schema';

export default function GrupoDetailPage() {
  const params = useParams();
  const grupoId = params.grupo_id as string;
  const { state } = useConsolidation();

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

  const topPositions = [...positions]
    .filter((p) => p.clase_activo !== 'cash')
    .sort((a, b) => (b.valor_mercado_usd ?? 0) - (a.valor_mercado_usd ?? 0))
    .slice(0, 15);

  const allWarnings = positions.flatMap((p) =>
    p.warnings.map((w) => ({ warning: w, ticker: p.ticker, broker: p.broker }))
  );

  const miembros = grupo?.cliente_ids ?? [...new Set(positions.map((p) => p.cliente_id))];

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownCard title="Por Broker" data={byBroker} total={totalUsd} />
        <BreakdownCard title="Por Clase de Activo" data={byClase} total={totalUsd} />
        <BreakdownCard title="Por Moneda" data={byMoneda} total={totalUsd} />
        <BreakdownCard title="Local vs Offshore" data={byTipo} total={totalUsd} />
        <BreakdownCard title="Por Forma Legal" data={byFormaLegal} total={totalUsd} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Posiciones (sin cash)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Broker</th>
                <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Descripción</th>
                <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Cantidad</th>
                <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valor USD</th>
                <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">% Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {topPositions.map((p, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="p-2">
                    <Badge variant="outline" className={brokerColorClass(p.broker)}>
                      {p.broker}
                    </Badge>
                  </td>
                  <td className="p-2 font-mono">{p.ticker ?? '—'}</td>
                  <td className="p-2 text-muted-foreground max-w-[250px] truncate" title={p.descripcion}>
                    {p.descripcion}
                  </td>
                  <td className="p-2">
                    <Badge variant="secondary" className="text-xs">
                      {p.clase_activo}
                    </Badge>
                  </td>
                  <td className="p-2 text-right font-mono">{p.cantidad.toLocaleString()}</td>
                  <td className="p-2 text-right font-mono font-medium">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
                  <td className="p-2 text-right text-muted-foreground">
                    {totalUsd > 0 ? formatPct(((p.valor_mercado_usd ?? 0) / totalUsd) * 100) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Todas las posiciones ({positions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Broker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Cuenta</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Cliente</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Cant.</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Valor USD</th>
                  <th className="p-2 text-xs font-medium text-muted-foreground uppercase">⚠</th>
                </tr>
              </thead>
              <tbody>
                {[...positions]
                  .sort((a, b) => (b.valor_mercado_usd ?? 0) - (a.valor_mercado_usd ?? 0))
                  .map((p, i) => (
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
                      <td className="p-2 text-right font-mono font-medium">{formatCurrency(p.valor_mercado_usd ?? 0)}</td>
                      <td className="p-2">
                        {p.warnings.length > 0 && (
                          <span className="text-amber-500" title={p.warnings.join('\n')}>
                            ⚠ {p.warnings.length}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
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
