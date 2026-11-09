'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { ExposureSnapshot } from '@/components/exposure/snapshot';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { accountsFromPositions } from '@/lib/exposure/engine';

export default function DashboardPage() {
  const { state } = useConsolidation();
  if (!state.hasParsed || state.allPositions.length === 0) return <EmptyDashboard />;
  return <Book positions={state.allPositions} grupos={state.grupos} />;
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
}: {
  positions: ReturnType<typeof useConsolidation>['state']['allPositions'];
  grupos: ReturnType<typeof useConsolidation>['state']['grupos'];
}) {
  const [grupoId, setGrupoId] = useState('all');
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const inGroup = useMemo(() => {
    if (grupoId === 'all') return positions;
    const grupo = grupos.find((item) => item.id === grupoId);
    if (!grupo) return positions;
    const ids = new Set(grupo.cliente_ids);
    return positions.filter((position) => ids.has(position.cliente_id) || position.grupo_id === grupoId);
  }, [grupoId, grupos, positions]);

  const universe = useMemo(() => accountsFromPositions(inGroup), [inGroup]);
  const selected = useMemo(() => universe.filter((account) => !hidden[account.id]), [hidden, universe]);
  const fechas = useMemo(() => [...new Set(inGroup.map((position) => position.fecha_reporte))].sort(), [inGroup]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">
            El consolidado y, debajo, cada cuenta. Tocá un tramo para ver qué activos arman ese porcentaje.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={grupoId === 'all'} onClick={() => { setGrupoId('all'); setHidden({}); }}>
          Todas las cuentas
        </FilterChip>
        {grupos.map((grupo) => (
          <FilterChip
            key={grupo.id}
            active={grupoId === grupo.id}
            onClick={() => { setGrupoId(grupo.id); setHidden({}); }}
          >
            {grupo.nombre}
          </FilterChip>
        ))}
      </div>

      {universe.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {universe.map((account) => (
            <FilterChip
              key={account.id}
              active={!hidden[account.id]}
              onClick={() => setHidden((current) => ({ ...current, [account.id]: !current[account.id] }))}
            >
              {account.broker} {account.cuenta}
            </FilterChip>
          ))}
        </div>
      )}

      {selected.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ninguna cuenta en esta selección</CardTitle>
            <CardDescription>Activá al menos una cuenta, o volvé a todas.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ExposureSnapshot accounts={selected} fechas={fechas} />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}
