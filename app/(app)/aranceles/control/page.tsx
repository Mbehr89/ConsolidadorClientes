'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Stat,
  StatusBadge,
  inputClass,
  readJson,
} from '@/components/aranceles/shared';
import { formatDate, formatMoney, formatNumber } from '@/lib/aranceles/format';
import { FEE_STATUS_LABEL, type ArancelCommission, type FeeStatus } from '@/lib/aranceles/types';

type ControlResponse = {
  alycs: { name: string; rows: number }[];
  summary: { status: FeeStatus; count: number }[];
  total: number;
  rows: ArancelCommission[];
};

export default function ArancelesControlPage() {
  const [alyc, setAlyc] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<FeeStatus | ''>('');
  const [data, setData] = useState<ControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (alyc) p.set('alyc', alyc);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const res = await fetch(`/api/aranceles/control?${p.toString()}`, { cache: 'no-store' });
      const json = await readJson<ControlResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar control');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [alyc, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data ? (statusFilter ? data.rows.filter((r) => r.fee_status === statusFilter) : data.rows) : [];
  const total = data?.summary.reduce((s, x) => s + x.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Operaciones donde la ALYC no informó arancel, cobró cero, o cobró menos que el fijo / porcentaje habitual del
        cliente. Sirve para reclamar lo que no se liquidó.
      </p>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            ALYC
            <select className={inputClass} value={alyc} onChange={(e) => setAlyc(e.target.value)}>
              <option value="">Todas</option>
              {data?.alycs.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Desde
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Hasta
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </CardContent>
      </Card>

      {loading && !data && <LoadingBlock label="Revisando operaciones…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <button type="button" className="text-left" onClick={() => setStatusFilter('')}>
              <Stat label="A revisar" value={formatNumber(total)} hint={statusFilter ? 'Ver todas' : undefined} />
            </button>
            {(['missing', 'zero', 'below_expected', 'min_on_large'] as const).map((s) => {
              const count = data.summary.find((x) => x.status === s)?.count ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  className={statusFilter === s ? 'rounded-lg text-left ring-2 ring-primary' : 'text-left'}
                  onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                >
                  <Stat label={FEE_STATUS_LABEL[s]} value={formatNumber(count)} />
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <EmptyBlock
              title="Sin anomalías"
              description="Si una ALYC no informa arancel o cobra por debajo de la tarifa sugerida, aparece acá."
              action={
                total === 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/aranceles/importar">Importar planillas</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[640px] overflow-auto">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead className="sticky top-0 border-b bg-card">
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="p-2 text-left font-medium">Estado</th>
                        <th className="p-2 text-left font-medium">Fecha</th>
                        <th className="p-2 text-left font-medium">ALYC</th>
                        <th className="p-2 text-left font-medium">Cliente</th>
                        <th className="p-2 text-left font-medium">Operación</th>
                        <th className="p-2 text-left font-medium">Instrumento</th>
                        <th className="p-2 text-right font-medium">Bruto</th>
                        <th className="p-2 text-right font-medium">Cobrado</th>
                        <th className="p-2 text-right font-medium">Esperado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
                          <td className="p-2">
                            <StatusBadge status={r.fee_status} />
                          </td>
                          <td className="whitespace-nowrap p-2">{formatDate(r.trade_date)}</td>
                          <td className="p-2">{r.alyc}</td>
                          <td className="p-2">
                            <div>{r.client}</div>
                            {r.client_external_id && (
                              <div className="text-xs text-muted-foreground">Cta. {r.client_external_id}</div>
                            )}
                          </td>
                          <td className="p-2 text-xs">{r.operation ?? '—'}</td>
                          <td className="p-2 font-mono text-xs text-muted-foreground">{r.instrument ?? '—'}</td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">
                            {r.amount != null ? formatNumber(r.amount) : '—'}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatMoney(r.commission, r.currency)}
                            {r.commission_pct != null && (
                              <div className="text-xs text-muted-foreground">{formatNumber(r.commission_pct)}%</div>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">
                            {r.expected_commission != null ? formatMoney(r.expected_commission, r.currency) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.total > data.rows.length && (
                  <p className="p-3 text-xs text-muted-foreground">
                    Mostrando {data.rows.length} de {data.total}. Filtrá por ALYC o fechas para acotar.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
