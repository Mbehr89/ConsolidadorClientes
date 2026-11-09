'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ExposureSnapshot } from '@/components/exposure/snapshot';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { accountsFromPositions, consolidate } from '@/lib/exposure/engine';
import type { ExposureAccount } from '@/lib/exposure/types';
import type { Position } from '@/lib/schema';

type View = 'cuenta' | 'asesor' | 'grupo';

const ROW_LABEL: Record<View, string> = {
  cuenta: 'Cuenta',
  asesor: 'Asesor',
  grupo: 'Grupo',
};

export default function DashboardPage() {
  const { state } = useConsolidation();
  if (!state.hasParsed || state.allPositions.length === 0) return <EmptyDashboard />;
  return (
    <Book
      positions={state.allPositions}
      grupos={state.grupos}
      advisorsByCliente={state.advisorsByCliente}
    />
  );
}

function EmptyDashboard() {
  return (
    <div className="page-shell max-w-5xl">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">Pantallazo de asset class, región y sector por cuenta.</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Empezá subiendo archivos</CardTitle>
          <CardDescription>
            Subí los Excels de MS, Netx360, IEB y GMA para ver el consolidado y cada cuenta.
            Todo se procesa en tu browser — los datos nunca salen de tu máquina.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/upload">
            <Button size="lg">Ir a Upload</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Book({
  positions,
  grupos,
  advisorsByCliente,
}: {
  positions: Position[];
  grupos: ReturnType<typeof useConsolidation>['state']['grupos'];
  advisorsByCliente: Record<string, string>;
}) {
  const [view, setView] = useState<View>('asesor');

  const rows = useMemo(() => {
    if (view === 'cuenta') return accountsFromPositions(positions);
    if (view === 'asesor') {
      return rollup(positions, (position) => advisorOf(position, advisorsByCliente));
    }
    const nameOf = new Map(grupos.map((grupo) => [grupo.id, grupo.nombre]));
    return rollup(positions, (position) => (position.grupo_id ? nameOf.get(position.grupo_id) ?? 'Sin grupo' : 'Sin grupo'));
  }, [advisorsByCliente, grupos, positions, view]);

  const fechas = useMemo(() => [...new Set(positions.map((position) => position.fecha_reporte))].sort(), [positions]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">
            Elegí si el pantallazo es por asesor, por grupo o por cuenta. Tocá un tramo y, debajo de esa cartera, ves qué activos lo componen.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Ver</span>
          <select
            value={view}
            onChange={(event) => setView(event.target.value as View)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="asesor">Por asesor</option>
            <option value="grupo">Por grupo</option>
            <option value="cuenta">Por cuenta</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nada para mostrar en esta vista</CardTitle>
            <CardDescription>No hay posiciones con valor de mercado en la selección.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ExposureSnapshot key={view} accounts={rows} fechas={fechas} rowLabel={ROW_LABEL[view]} />
      )}
    </div>
  );
}

function advisorOf(position: Position, advisorsByCliente: Record<string, string>): string {
  const mapped = advisorsByCliente[position.cliente_id]?.trim();
  if (mapped) return mapped;
  const productor = position.productor?.trim();
  if (productor && !/^\d+$/.test(productor)) return productor;
  return 'Sin asesor';
}

function rollup(positions: readonly Position[], labelOf: (position: Position) => string): ExposureAccount[] {
  const buckets = new Map<string, Position[]>();
  for (const position of positions) {
    const label = labelOf(position);
    const list = buckets.get(label) ?? [];
    list.push(position);
    buckets.set(label, list);
  }
  const rows = [...buckets.entries()].map(([label, list]) => {
    const merged = consolidate(accountsFromPositions(list));
    const cuentas = new Set(list.map((position) => `${position.broker}::${position.cuenta}`));
    const n = cuentas.size;
    return {
      ...merged,
      id: label,
      name: label,
      cuenta: label,
      broker: '',
      titular: `${n} ${n === 1 ? 'cuenta' : 'cuentas'}`,
    };
  });
  rows.sort((a, b) => {
    const aSin = a.name.startsWith('Sin ');
    const bSin = b.name.startsWith('Sin ');
    if (aSin !== bSin) return aSin ? 1 : -1;
    return b.asset.reduce((s, v) => s + v, 0) - a.asset.reduce((s, v) => s + v, 0);
  });
  return rows;
}
