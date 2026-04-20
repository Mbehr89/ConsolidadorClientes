'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConsolidation } from '@/lib/context/consolidation-context';
import type { Grupo, GruposStore } from '@/lib/config-store/types';
import { findGrupoContainingCliente } from '@/lib/analysis/grupos';
import { formatCompact, formatCurrency } from '@/lib/utils';
import { AdminOnly } from '@/components/admin-only';

type ClienteOpt = { cliente_id: string; titular: string; brokers: string[] };

function newGrupoId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `gr_${crypto.randomUUID()}`;
  }
  return `gr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function AdminGruposPage() {
  const { state, refreshGruposAssignment } = useConsolidation();
  const [grupos, setGrupos] = useState<GruposStore>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Grupo | null>(null);
  const [nombre, setNombre] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState('');
  const [memberConflict, setMemberConflict] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/config/grupos');
      if (!res.ok) throw new Error('No se pudo cargar');
      setGrupos((await res.json()) as GruposStore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableClientes = useMemo(() => {
    const m = new Map<string, ClienteOpt>();
    for (const p of state.allPositions) {
      let e = m.get(p.cliente_id);
      if (!e) {
        e = { cliente_id: p.cliente_id, titular: p.titular, brokers: [] };
        m.set(p.cliente_id, e);
      }
      if (!e.brokers.includes(p.broker)) e.brokers.push(p.broker);
    }
    return Array.from(m.values()).sort((a, b) => a.titular.localeCompare(b.titular));
  }, [state.allPositions]);

  const aumByCliente = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of state.allPositions) {
      m.set(p.cliente_id, (m.get(p.cliente_id) ?? 0) + (p.valor_mercado_usd ?? 0));
    }
    return m;
  }, [state.allPositions]);

  const enAlgunGrupo = useMemo(() => new Set(grupos.flatMap((g) => g.cliente_ids)), [grupos]);

  const clientesSinGrupo = useMemo(
    () => availableClientes.filter((c) => !enAlgunGrupo.has(c.cliente_id)),
    [availableClientes, enAlgunGrupo]
  );

  const persist = useCallback(
    async (next: GruposStore) => {
      const res = await fetch('/api/config/grupos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error('No se pudo guardar');
      setGrupos(next);
      await refreshGruposAssignment();
    },
    [refreshGruposAssignment]
  );

  const openCreate = () => {
    setEditing(null);
    setNombre('');
    setSelectedIds(new Set());
    setPickerSearch('');
    setMemberConflict(null);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (g: Grupo) => {
    setEditing(g);
    setNombre(g.nombre);
    setSelectedIds(new Set(g.cliente_ids));
    setPickerSearch('');
    setMemberConflict(null);
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setMemberConflict(null);
  };

  const toggleMember = (clienteId: string) => {
    const next = new Set(selectedIds);
    if (next.has(clienteId)) {
      next.delete(clienteId);
      setMemberConflict(null);
    } else {
      const other = findGrupoContainingCliente(clienteId, grupos, editing?.id ?? null);
      if (other) {
        setMemberConflict(`El cliente ya está en el grupo «${other.nombre}». Quitalo de allí primero.`);
        return;
      }
      next.add(clienteId);
      setMemberConflict(null);
    }
    setSelectedIds(next);
  };

  const submitModal = async () => {
    const n = nombre.trim();
    if (!n) {
      setError('El nombre es obligatorio');
      return;
    }
    for (const cid of selectedIds) {
      const other = findGrupoContainingCliente(cid, grupos, editing?.id ?? null);
      if (other) {
        setError(`Conflicto: ${cid} ya pertenece a «${other.nombre}».`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const ids = [...selectedIds];
      const fecha = new Date().toISOString();
      if (editing) {
        const next: GruposStore = grupos.map((g) =>
          g.id === editing.id ? { ...g, nombre: n, cliente_ids: ids, fecha } : g
        );
        await persist(next);
      } else {
        const row: Grupo = {
          id: newGrupoId(),
          nombre: n,
          cliente_ids: ids,
          creado_por: 'admin',
          fecha,
        };
        await persist([...grupos, row]);
      }
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const removeGrupo = async (id: string) => {
    if (!window.confirm('¿Eliminar este grupo? Los clientes no se borran; solo dejan de agruparse.')) return;
    setSaving(true);
    setError(null);
    try {
      await persist(grupos.filter((g) => g.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const filteredPicker = useMemo(() => {
    if (!pickerSearch.trim()) return availableClientes;
    const q = pickerSearch.toLowerCase();
    return availableClientes.filter(
      (c) =>
        c.titular.toLowerCase().includes(q) ||
        c.cliente_id.toLowerCase().includes(q) ||
        c.brokers.some((b) => b.toLowerCase().includes(q))
    );
  }, [availableClientes, pickerSearch]);

  const grupoAum = (g: Grupo) => g.cliente_ids.reduce((s, cid) => s + (aumByCliente.get(cid) ?? 0), 0);

  return (
    <AdminOnly>
      <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Grupos de clientes</h2>
          <p className="text-muted-foreground mt-1">
            Unidades económicas (households). Un cliente solo puede estar en un grupo. Asigná{' '}
            <code className="text-xs bg-muted px-1 rounded">grupo_id</code> en posiciones tras el parseo.
          </p>
        </div>
        <Button type="button" onClick={openCreate} disabled={saving || !state.allPositions.length}>
          Crear grupo
        </Button>
      </div>

      {!state.allPositions.length && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Parseá archivos en <Link href="/upload">Upload</Link> para listar clientes y armar grupos.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">Cargando…</p>
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => {
            const aum = grupoAum(g);
            const isOpen = expanded.has(g.id);
            return (
              <Card key={g.id}>
                <CardHeader className="pb-2">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 text-left"
                    onClick={() => toggleExpand(g.id)}
                  >
                    <span className="mt-0.5 text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base">{g.nombre}</CardTitle>
                      <CardDescription className="mt-1">
                        {g.cliente_ids.length} miembro{g.cliente_ids.length === 1 ? '' : 's'}
                        {state.allPositions.length > 0 && (
                          <>
                            {' · '}
                            <span className="font-mono text-foreground">{formatCurrency(aum)}</span> AUM
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => openEdit(g)}>
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={saving}
                        onClick={() => void removeGrupo(g.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </button>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0 border-t">
                    <ul className="mt-3 space-y-2 text-sm">
                      {g.cliente_ids.map((cid) => {
                        const opt = availableClientes.find((c) => c.cliente_id === cid);
                        const tit = opt?.titular ?? cid;
                        const sub = opt ? opt.brokers.join(', ') : '—';
                        return (
                          <li key={cid} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <Link href={`/clientes/${encodeURIComponent(cid)}`} className="text-primary font-medium hover:underline">
                              {tit}
                            </Link>
                            <span className="text-xs text-muted-foreground font-mono">{cid}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {sub}
                            </Badge>
                            {state.allPositions.length > 0 && (
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatCompact(aumByCliente.get(cid) ?? 0)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                      {g.cliente_ids.length === 0 && (
                        <li className="text-muted-foreground text-sm">Sin miembros todavía.</li>
                      )}
                    </ul>
                  </CardContent>
                )}
              </Card>
            );
          })}
          {grupos.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">No hay grupos. Creá uno para empezar.</p>
          )}
        </div>
      )}

      <div className="border-t pt-8">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold">Clientes sin grupo asignado</h3>
          <Badge variant="outline">{clientesSinGrupo.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Clientes detectados en el último parseo que no están en ningún grupo.
        </p>
        <div className="rounded-md border max-h-48 overflow-auto p-3 text-sm space-y-1">
          {clientesSinGrupo.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            clientesSinGrupo.map((c) => (
              <div key={c.cliente_id} className="flex flex-wrap gap-2 items-center">
                <Link href={`/clientes/${encodeURIComponent(c.cliente_id)}`} className="text-primary hover:underline">
                  {c.titular}
                </Link>
                <span className="text-xs font-mono text-muted-foreground">{c.cliente_id}</span>
                <span className="text-xs text-muted-foreground">{c.brokers.join(', ')}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg space-y-4 max-h-[90vh] flex flex-col">
            <h3 className="text-lg font-semibold">{editing ? 'Editar grupo' : 'Crear grupo'}</h3>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Nombre</label>
              <input
                className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Grupo Martínez"
              />
            </div>
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">Miembros</label>
              <input
                type="text"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                placeholder="Buscar titular, cliente_id o broker…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
              {memberConflict && <p className="text-sm text-amber-600 dark:text-amber-400">{memberConflict}</p>}
              <div className="border rounded-md overflow-auto max-h-52 space-y-0.5 p-2">
                {filteredPicker.map((c) => (
                  <label
                    key={c.cliente_id}
                    className="flex items-start gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedIds.has(c.cliente_id)}
                      onChange={() => toggleMember(c.cliente_id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{c.titular}</span>
                      <span className="block text-xs text-muted-foreground font-mono">{c.cliente_id}</span>
                      <span className="text-xs text-muted-foreground">{c.brokers.join(' · ')}</span>
                    </span>
                  </label>
                ))}
                {filteredPicker.length === 0 && (
                  <p className="text-sm text-muted-foreground p-2">Sin coincidencias.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Seleccionados: {selectedIds.size}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void submitModal()} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminOnly>
  );
}
