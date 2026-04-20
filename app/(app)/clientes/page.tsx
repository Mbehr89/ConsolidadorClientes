'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { brokerColorClass, formatCompact, formatCurrency, titularTipoClass } from '@/lib/utils';
import { buildClienteSummaries } from '@/lib/views/cliente-summary';
import { buildGrupoListRows } from '@/lib/views/grupo-view';
import { ExportExcelButton } from '@/components/export-excel-button';
import { ExportPdfButton } from '@/components/export-pdf-button';

type ViewMode = 'cliente' | 'grupo';

export default function ClientesPage() {
  const { state } = useConsolidation();
  const [viewMode, setViewMode] = useState<ViewMode>('cliente');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<'aum_usd' | 'titular' | 'brokers'>('aum_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterBroker, setFilterBroker] = useState<string>('all');
  const [filterTipo, setFilterTipo] = useState<string>('all');
  const [filterProductor, setFilterProductor] = useState<string>('all');
  const [filterAdvisor, setFilterAdvisor] = useState<string>('all');

  const clients = useMemo(() => buildClienteSummaries(state.allPositions), [state.allPositions]);

  const grupoView = useMemo(
    () => buildGrupoListRows(state.grupos, clients),
    [state.grupos, clients]
  );

  const filtered = useMemo(() => {
    let result = clients;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.titular.toLowerCase().includes(q) ||
          c.cliente_id.includes(q) ||
          c.cuentas.some((acc) => acc.cuenta.toLowerCase().includes(q))
      );
    }

    if (filterBroker !== 'all') {
      result = result.filter((c) => c.brokers.includes(filterBroker));
    }

    if (filterTipo !== 'all') {
      result = result.filter((c) => c.tipo_titular === filterTipo);
    }
    if (filterProductor !== 'all') {
      result = result.filter((c) => c.productores.includes(filterProductor));
    }
    if (filterAdvisor !== 'all') {
      result = result.filter((c) => (c.advisor ?? '') === filterAdvisor);
    }

    return result;
  }, [clients, search, filterBroker, filterTipo, filterProductor, filterAdvisor]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'aum_usd':
          cmp = a.aum_usd - b.aum_usd;
          break;
        case 'titular':
          cmp = a.titular.localeCompare(b.titular);
          break;
        case 'brokers':
          cmp = a.brokers.length - b.brokers.length;
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [filtered, sortField, sortDir]);

  const filteredGrupos = useMemo(() => {
    if (!search) return grupoView.grupos;
    const q = search.toLowerCase();
    return grupoView.grupos.filter(
      (g) =>
        g.nombre.toLowerCase().includes(q) ||
        g.miembros.some((m) => m.titular.toLowerCase().includes(q) || m.cliente_id.includes(q))
    );
  }, [grupoView.grupos, search]);

  const sinGrupoFiltered = useMemo(() => {
    let rows = grupoView.sinGrupo;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.titular.toLowerCase().includes(q) ||
          c.cliente_id.includes(q) ||
          c.cuentas.some((acc) => acc.cuenta.toLowerCase().includes(q))
      );
    }
    if (filterBroker !== 'all') {
      rows = rows.filter((c) => c.brokers.includes(filterBroker));
    }
    if (filterTipo !== 'all') {
      rows = rows.filter((c) => c.tipo_titular === filterTipo);
    }
    if (filterProductor !== 'all') {
      rows = rows.filter((c) => c.productores.includes(filterProductor));
    }
    if (filterAdvisor !== 'all') {
      rows = rows.filter((c) => (c.advisor ?? '') === filterAdvisor);
    }
    return rows;
  }, [grupoView.sinGrupo, search, filterBroker, filterTipo, filterProductor, filterAdvisor]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const totalAum = clients.reduce((s, c) => s + c.aum_usd, 0);
  const allBrokers = [...new Set(clients.flatMap((c) => c.brokers))].sort();
  const allProductores = [...new Set(clients.flatMap((c) => c.productores))].sort();
  const allAdvisors = [...new Set(clients.map((c) => c.advisor).filter(Boolean) as string[])].sort();

  if (!state.hasParsed) {
    return (
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
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

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="page-title">Clientes ({clients.length})</h2>
          <p className="page-subtitle">AUM total: {formatCompact(totalAum)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          <ExportExcelButton positions={state.allPositions} size="sm" />
          <ExportPdfButton positions={state.allPositions} size="sm" />
        </div>
        <div className="flex rounded-md border border-border p-0.5 bg-muted/40">
          <Button
            type="button"
            variant={viewMode === 'cliente' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8"
            onClick={() => setViewMode('cliente')}
          >
            Por cliente
          </Button>
          <Button
            type="button"
            variant={viewMode === 'grupo' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8"
            onClick={() => setViewMode('grupo')}
          >
            Por grupo
          </Button>
        </div>
        </div>
      </div>

      <div className="flex gap-4 items-center flex-wrap">
        <input
          type="text"
          placeholder="Buscar titular, cuenta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72 rounded-lg border bg-background px-3 text-sm"
        />
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
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Todos los tipos</option>
          <option value="persona">Persona</option>
          <option value="juridica">Jurídica</option>
        </select>
        <select
          value={filterProductor}
          onChange={(e) => setFilterProductor(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Todos los managers/productores</option>
          {allProductores.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filterAdvisor}
          onChange={(e) => setFilterAdvisor(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Todos los advisors</option>
          {allAdvisors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {viewMode === 'cliente' ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[700px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th
                      className="text-left p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('titular')}
                    >
                      Titular {sortField === 'titular' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Tipo</th>
                    <th
                      className="text-left p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('brokers')}
                    >
                      Brokers {sortField === 'brokers' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Cuentas</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Manager/Productor</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Advisor</th>
                    <th
                      className="text-right p-3 text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('aum_usd')}
                    >
                      AUM USD {sortField === 'aum_usd' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase">Pos.</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((client) => (
                    <tr key={client.cliente_id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="p-3">
                        <Link
                          href={`/clientes/${client.cliente_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {client.titular}
                        </Link>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={titularTipoClass(client.tipo_titular)}>
                          {client.tipo_titular === 'juridica' ? 'Jurídica' : 'Persona'}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {client.brokers.map((b) => (
                            <Badge key={b} variant="outline" className={brokerColorClass(b)}>
                              {b}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">
                        {client.cuentas.map((c) => c.cuenta).join(', ')}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {client.productores.length > 0 ? client.productores.join(', ') : '—'}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {client.advisor ?? '—'}
                      </td>
                      <td className="p-3 text-right font-mono font-medium">{formatCurrency(client.aum_usd)}</td>
                      <td className="p-3 text-right text-muted-foreground">
                        {totalAum > 0 ? `${((client.aum_usd / totalAum) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="p-3 text-center text-muted-foreground">{client.positions_count}</td>
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(client.aum_by_broker)
                            .sort(([, a], [, b]) => b - a)
                            .map(([broker, val]) => (
                              <span key={broker} className="text-xs text-muted-foreground">
                                {broker}: {formatCompact(val)}
                              </span>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[520px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Grupo</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Miembros</th>
                      <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">AUM USD</th>
                      <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGrupos.map((g) => (
                      <tr key={g.grupo_id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="p-3">
                          <Link
                            href={`/clientes/grupo/${encodeURIComponent(g.grupo_id)}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {g.nombre}
                          </Link>
                          <span className="text-muted-foreground text-xs ml-2">({g.miembros.length})</span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground max-w-md">
                          {g.miembros.map((m) => (
                            <span key={m.cliente_id} className="inline-block mr-2 mb-1">
                              <Link href={`/clientes/${m.cliente_id}`} className="text-primary hover:underline">
                                {m.titular}
                              </Link>
                            </span>
                          ))}
                        </td>
                        <td className="p-3 text-right font-mono font-medium">{formatCurrency(g.aum_usd)}</td>
                        <td className="p-3 text-right text-muted-foreground">
                          {totalAum > 0 ? `${((g.aum_usd / totalAum) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Clientes sin grupo asignado</h3>
              <Badge variant="outline">{sinGrupoFiltered.length}</Badge>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[360px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b">
                      <tr>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Titular</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Tipo</th>
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Brokers</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">AUM USD</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase">% Book</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sinGrupoFiltered.map((client) => (
                        <tr key={client.cliente_id} className="border-b border-border/50 hover:bg-muted/50">
                          <td className="p-3">
                            <Link
                              href={`/clientes/${client.cliente_id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {client.titular}
                            </Link>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className={titularTipoClass(client.tipo_titular)}>
                              {client.tipo_titular === 'juridica' ? 'Jurídica' : 'Persona'}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1 flex-wrap">
                              {client.brokers.map((b) => (
                                <Badge key={b} variant="outline" className={brokerColorClass(b)}>
                                  {b}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-right font-mono font-medium">{formatCurrency(client.aum_usd)}</td>
                          <td className="p-3 text-right text-muted-foreground">
                            {totalAum > 0 ? `${((client.aum_usd / totalAum) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
