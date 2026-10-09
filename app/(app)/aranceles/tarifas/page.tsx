'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyBlock, ErrorBlock, LoadingBlock, inputClass, readJson } from '@/components/aranceles/shared';
import { formatMoney, formatNumber } from '@/lib/aranceles/format';
import type { FeeSchedule } from '@/lib/aranceles/types';

export default function ArancelesTarifasPage() {
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/aranceles/tarifas', { cache: 'no-store' });
      const json = await readJson<{ schedules: FeeSchedule[] }>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar tarifas');
      setSchedules(json.schedules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/aranceles/tarifas', { method: 'POST' });
      const json = await readJson<{ schedules: FeeSchedule[] }>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo recalcular');
      setSchedules(json.schedules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return schedules;
    return schedules.filter((s) => `${s.client} ${s.alyc}`.toLowerCase().includes(needle));
  }, [schedules, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Aranceles sugeridos a partir del historial: fijos recurrentes (ej. $19,90 / USD 0,20) y porcentajes habituales
          por ALYC, cliente y moneda. Se usan para marcar cobros faltantes o por debajo en Control. Se recalculan solos
          en cada importación.
        </p>
        <div className="flex items-center gap-2">
          <input className={`${inputClass} w-56`} placeholder="Buscar cliente o ALYC…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? 'Recalculando…' : 'Recalcular'}
          </Button>
        </div>
      </div>

      {loading && <LoadingBlock label="Cargando tarifas…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {!loading && !error && schedules.length === 0 && (
        <EmptyBlock
          title="Todavía no hay tarifas sugeridas"
          description="Con al menos dos cobros iguales por cliente se propone una tarifa. Importá más períodos para mejorar las sugerencias."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/aranceles/importar">Importar planillas</Link>
            </Button>
          }
        />
      )}

      {!loading && visible.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 border-b bg-card">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="p-2 text-left font-medium">Cliente</th>
                    <th className="p-2 text-left font-medium">ALYC</th>
                    <th className="p-2 text-left font-medium">Tipo</th>
                    <th className="p-2 text-left font-medium">Moneda</th>
                    <th className="p-2 text-right font-medium">Valor</th>
                    <th className="p-2 text-right font-medium">Muestras</th>
                    <th className="p-2 text-left font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/40">
                      <td className="p-2 font-medium">{s.client}</td>
                      <td className="p-2">{s.alyc}</td>
                      <td className="p-2">
                        <Badge variant="secondary">{s.fee_type === 'fixed' ? 'Fijo' : 'Porcentaje'}</Badge>
                      </td>
                      <td className="p-2">{s.currency}</td>
                      <td className="p-2 text-right font-medium tabular-nums">
                        {s.fee_type === 'fixed' ? formatMoney(s.amount, s.currency) : `${formatNumber(s.amount)} %`}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatNumber(s.sample_count ?? 0)}
                        {s.confidence != null && (
                          <div className="text-xs text-muted-foreground">{Math.round(s.confidence * 100)}% conf.</div>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {s.source === 'manual' ? 'Manual' : s.notes ?? 'Inferida'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
