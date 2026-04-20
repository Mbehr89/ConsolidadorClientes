'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BrokerCode, ClaseActivo } from '@/lib/schema';
import type { TickerMeta, TickerPendiente, TickersMetadataStore, TickersPendientesStore } from '@/lib/config-store/types';
import { AdminOnly } from '@/components/admin-only';

const CLASE_LIST: ClaseActivo[] = [
  'equity',
  'bond',
  'cash',
  'fund',
  'option',
  'etf',
  'cedear',
  'on',
  'letra',
  'other',
];

const BROKERS: BrokerCode[] = ['MS', 'NETX360', 'GMA', 'IEB'];

function buildConfirmedMeta(
  pend: TickerPendiente,
  opts: { clase: string; pais: string; esEtf: boolean }
): TickerMeta {
  const pais =
    opts.pais.trim().length === 2 ? opts.pais.trim().toUpperCase() : null;
  return {
    pais,
    clase: opts.clase,
    es_etf: opts.esEtf,
    nombre: pend.descripcion_muestra.slice(0, 200) || pend.ticker,
    confirmado: true,
    fuente: 'admin',
    confirmado_por: 'admin',
    fecha: new Date().toISOString(),
  };
}

type RowEdit = { clase: string; pais: string; esEtf: boolean };

export default function GlosarioPage() {
  const [metadata, setMetadata] = useState<TickersMetadataStore>({});
  const [pendientes, setPendientes] = useState<TickersPendientesStore>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterBroker, setFilterBroker] = useState<BrokerCode | 'all'>('all');
  const [filterEstado, setFilterEstado] = useState<'all' | 'pendiente' | 'en_revision'>('all');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [confirmedOpen, setConfirmedOpen] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [mr, pr] = await Promise.all([
        fetch('/api/config/tickers-metadata'),
        fetch('/api/config/tickers-pendientes'),
      ]);
      if (!mr.ok || !pr.ok) throw new Error('No se pudo cargar');
      const meta = (await mr.json()) as TickersMetadataStore;
      const pend = (await pr.json()) as TickersPendientesStore;
      setMetadata(meta);
      setPendientes(pend);
      const nextEdits: Record<string, RowEdit> = {};
      for (const [k, p] of Object.entries(pend)) {
        nextEdits[k] = {
          clase: p.clase_sugerida,
          pais: p.pais_sugerido ?? '',
          esEtf: p.clase_sugerida === 'etf',
        };
      }
      setEdits(nextEdits);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persistBoth = useCallback(async (meta: TickersMetadataStore, pend: TickersPendientesStore) => {
    const [r1, r2] = await Promise.all([
      fetch('/api/config/tickers-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      }),
      fetch('/api/config/tickers-pendientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pend),
      }),
    ]);
    if (!r1.ok || !r2.ok) throw new Error('Error al guardar');
    setMetadata(meta);
    setPendientes(pend);
    window.dispatchEvent(new CustomEvent('glosario-pending-updated'));
  }, []);

  const pendienteList = useMemo(() => Object.values(pendientes), [pendientes]);

  const filteredPendientes = useMemo(() => {
    let list = pendienteList;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.ticker.toLowerCase().includes(q) ||
          p.descripcion_muestra.toLowerCase().includes(q)
      );
    }
    if (filterBroker !== 'all') {
      list = list.filter((p) => p.brokers_detectados.includes(filterBroker));
    }
    if (filterEstado !== 'all') {
      list = list.filter((p) => p.estado === filterEstado);
    }
    return list.sort((a, b) => b.ocurrencias - a.ocurrencias);
  }, [pendienteList, search, filterBroker, filterEstado]);

  const confirmOne = useCallback(
    async (ticker: string) => {
      const pend = pendientes[ticker];
      if (!pend) return;
      const e = edits[ticker] ?? {
        clase: pend.clase_sugerida,
        pais: pend.pais_sugerido ?? '',
        esEtf: pend.clase_sugerida === 'etf',
      };
      setSaving(true);
      setError(null);
      try {
        const meta = { ...metadata, [ticker]: buildConfirmedMeta(pend, { clase: e.clase, pais: e.pais, esEtf: e.esEtf }) };
        const rest = { ...pendientes };
        delete rest[ticker];
        await persistBoth(meta, rest);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setSaving(false);
      }
    },
    [pendientes, metadata, edits, persistBoth]
  );

  const ignoreOne = useCallback(
    async (ticker: string) => {
      const pend = pendientes[ticker];
      if (!pend) return;
      setSaving(true);
      setError(null);
      try {
        const next = {
          ...pendientes,
          [ticker]: { ...pend, estado: 'en_revision' as const },
        };
        await persistBoth(metadata, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setSaving(false);
      }
    },
    [pendientes, metadata, persistBoth]
  );

  const confirmAllFiltered = useCallback(async () => {
    const toConfirm = filteredPendientes.filter((p) => p.estado === 'pendiente');
    if (toConfirm.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      let meta = { ...metadata };
      let pend = { ...pendientes };
      for (const p of toConfirm) {
        meta[p.ticker] = buildConfirmedMeta(p, {
          clase: p.clase_sugerida,
          pais: p.pais_sugerido ?? '',
          esEtf: p.clase_sugerida === 'etf',
        });
        delete pend[p.ticker];
      }
      await persistBoth(meta, pend);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [filteredPendientes, metadata, pendientes, persistBoth]);

  const confirmedEntries = useMemo(
    () =>
      Object.entries(metadata)
        .filter(([, m]) => m.confirmado)
        .sort((a, b) => a[0].localeCompare(b[0])),
    [metadata]
  );

  const pendingCount = useMemo(
    () => pendienteList.filter((p) => p.estado === 'pendiente').length,
    [pendienteList]
  );

  return (
    <AdminOnly>
      <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Glosario de tickers</h2>
        <p className="text-muted-foreground mt-1">
          Tickers sin metadata confirmada pasan a pendientes tras cada parseo. Confirmá para usar en futuros archivos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Badge variant="secondary">{pendingCount} pendientes</Badge>
        <Badge variant="outline">{Object.keys(metadata).length} en metadata</Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Pendientes</CardTitle>
            <CardDescription>Filtros y acciones masivas</CardDescription>
          </div>
          <Button type="button" onClick={() => void confirmAllFiltered()} disabled={saving || loading}>
            Confirmar todos (vista filtrada)
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Buscar ticker o descripción…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
            />
            <select
              value={filterBroker}
              onChange={(e) => setFilterBroker(e.target.value as BrokerCode | 'all')}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">Todos los brokers</option>
              {BROKERS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value as typeof filterEstado)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_revision">En revisión</option>
            </select>
          </div>

          <div className="overflow-auto max-h-[480px] border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Ticker</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Descripción</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Brokers</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Clase</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase w-20">País</th>
                  <th className="text-center p-2 text-xs font-medium text-muted-foreground uppercase">ETF</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">N</th>
                  <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Estado</th>
                  <th className="text-right p-2 text-xs font-medium text-muted-foreground uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-muted-foreground">
                      Cargando…
                    </td>
                  </tr>
                ) : filteredPendientes.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-muted-foreground text-center">
                      No hay coincidencias.
                    </td>
                  </tr>
                ) : (
                  filteredPendientes.map((p) => {
                    const e = edits[p.ticker] ?? {
                      clase: p.clase_sugerida,
                      pais: p.pais_sugerido ?? '',
                      esEtf: p.clase_sugerida === 'etf',
                    };
                    return (
                      <tr key={p.ticker} className="border-b border-border/40">
                        <td className="p-2 font-mono font-bold align-middle">{p.ticker}</td>
                        <td className="p-2 text-muted-foreground max-w-[220px] truncate align-middle" title={p.descripcion_muestra}>
                          {p.descripcion_muestra}
                        </td>
                        <td className="p-2 align-middle">
                          <div className="flex flex-wrap gap-1">
                            {p.brokers_detectados.map((b) => (
                              <Badge key={b} variant="outline" className="text-[10px]">
                                {b}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="p-2 align-middle">
                          <select
                            className="h-8 w-full min-w-[100px] rounded-md border bg-background px-1 text-xs"
                            value={e.clase}
                            onChange={(ev) =>
                              setEdits((prev) => ({
                                ...prev,
                                [p.ticker]: {
                                  ...e,
                                  clase: ev.target.value,
                                  esEtf: ev.target.value === 'etf',
                                },
                              }))
                            }
                          >
                            {CLASE_LIST.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 align-middle">
                          <input
                            className="h-8 w-14 rounded-md border bg-background px-1 text-xs font-mono uppercase"
                            maxLength={2}
                            value={e.pais}
                            onChange={(ev) =>
                              setEdits((prev) => ({
                                ...prev,
                                [p.ticker]: { ...e, pais: ev.target.value.toUpperCase().slice(0, 2) },
                              }))
                            }
                            placeholder="AR"
                          />
                        </td>
                        <td className="p-2 text-center align-middle">
                          <input
                            type="checkbox"
                            checked={e.esEtf}
                            onChange={(ev) =>
                              setEdits((prev) => ({
                                ...prev,
                                [p.ticker]: { ...e, esEtf: ev.target.checked },
                              }))
                            }
                          />
                        </td>
                        <td className="p-2 text-right font-mono align-middle">{p.ocurrencias}</td>
                        <td className="p-2 align-middle">
                          <Badge variant={p.estado === 'pendiente' ? 'secondary' : 'warning'}>{p.estado}</Badge>
                        </td>
                        <td className="p-2 text-right align-middle space-x-1 whitespace-nowrap">
                          <Button
                            type="button"
                            size="sm"
                            disabled={saving}
                            onClick={() => void confirmOne(p.ticker)}
                          >
                            Confirmar
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void ignoreOne(p.ticker)}>
                            Ignorar
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setConfirmedOpen((o) => !o)}>
          <CardTitle className="text-lg flex items-center gap-2">
            Tickers confirmados ({confirmedEntries.length})
            <span className="text-muted-foreground text-sm font-normal">{confirmedOpen ? '▼' : '▶'}</span>
          </CardTitle>
          <CardDescription>Metadata completa usada por los parsers</CardDescription>
        </CardHeader>
        {confirmedOpen && (
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[360px] border-t">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b">
                  <tr>
                    <th className="text-left p-2 font-medium">Ticker</th>
                    <th className="text-left p-2 font-medium">Nombre</th>
                    <th className="text-left p-2 font-medium">Clase</th>
                    <th className="text-left p-2 font-medium">País</th>
                    <th className="text-center p-2 font-medium">ETF</th>
                    <th className="text-left p-2 font-medium">Fuente</th>
                    <th className="text-left p-2 font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedEntries.map(([t, m]) => (
                    <tr key={t} className="border-b border-border/30">
                      <td className="p-2 font-mono font-semibold">{t}</td>
                      <td className="p-2 max-w-[200px] truncate">{m.nombre}</td>
                      <td className="p-2">{m.clase}</td>
                      <td className="p-2 font-mono">{m.pais ?? '—'}</td>
                      <td className="p-2 text-center">{m.es_etf ? 'Sí' : '—'}</td>
                      <td className="p-2">{m.fuente}</td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{m.fecha.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
      </div>
    </AdminOnly>
  );
}
