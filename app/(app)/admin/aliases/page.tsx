'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { normalizeTitular } from '@/lib/matching';
import { aliasStoreToRecord } from '@/lib/analysis/alias-utils';
import {
  detectAliasCandidates,
  aliasPairKey,
  type AliasCandidatePair,
} from '@/lib/analysis/detect-alias-candidates';
import {
  loadIgnoredPairKeys,
  addIgnoredPairKey,
} from '@/lib/analysis/ignored-alias-pairs';
import type { AliasEntry, AliasStore } from '@/lib/config-store/types';
import { AdminOnly } from '@/components/admin-only';

export default function AliasesPage() {
  const { state, parseAll } = useConsolidation();
  const [aliases, setAliases] = useState<AliasStore>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoredTick, setIgnoredTick] = useState(0);
  const [manualVariante, setManualVariante] = useState('');
  const [manualCanonico, setManualCanonico] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [bulkCanonico, setBulkCanonico] = useState('');
  const [selectedAccountKeys, setSelectedAccountKeys] = useState<string[]>([]);
  const [mergePair, setMergePair] = useState<AliasCandidatePair | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/config/aliases');
      if (!res.ok) throw new Error('No se pudo cargar');
      setAliases((await res.json()) as AliasStore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persistAliases = useCallback(async (next: AliasStore) => {
    const res = await fetch('/api/config/aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error('No se pudo guardar');
    setAliases(next);
  }, []);

  const reparseIfNeeded = useCallback(async (aliasesOverride?: AliasStore) => {
    if (state.files.length === 0) return;
    await parseAll(aliasesOverride);
  }, [state.files.length, parseAll]);

  const candidates = useMemo(() => {
    if (!state.allPositions.length) return [];
    // Fuerza recálculo cuando se ignora un par.
    if (ignoredTick < 0) return [];
    const record = aliasStoreToRecord(aliases);
    const ignored = loadIgnoredPairKeys();
    return detectAliasCandidates(state.allPositions, record, ignored);
  }, [state.allPositions, aliases, ignoredTick]);

  const ignorePair = useCallback((p: AliasCandidatePair) => {
    addIgnoredPairKey(aliasPairKey(p.titular_a, p.titular_b));
    setIgnoredTick((t) => t + 1);
  }, []);

  const confirmMerge = useCallback(
    async (canonical: 'a' | 'b') => {
      if (!mergePair) return;
      const canonico = canonical === 'a' ? mergePair.titular_a : mergePair.titular_b;
      const variante = canonical === 'a' ? mergePair.titular_b : mergePair.titular_a;
      setSaving(true);
      setError(null);
      try {
        const entry: AliasEntry = {
          variante,
          canonico,
          creado_por: 'admin',
          fecha: new Date().toISOString(),
        };
        const next = [...aliases, entry];
        await persistAliases(next);
        await reparseIfNeeded(next);
        setMergePair(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error');
      } finally {
        setSaving(false);
      }
    },
    [mergePair, aliases, persistAliases, reparseIfNeeded]
  );

  const removeAlias = useCallback(
    async (variante: string) => {
      setSaving(true);
      setError(null);
      try {
        const next = aliases.filter((a) => a.variante !== variante);
        await persistAliases(next);
        await reparseIfNeeded(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error');
      } finally {
        setSaving(false);
      }
    },
    [aliases, persistAliases, reparseIfNeeded]
  );

  const addManual = useCallback(async () => {
    const v = normalizeTitular(manualVariante.trim()).normalizado;
    const c = normalizeTitular(manualCanonico.trim()).normalizado;
    if (!v || !c) {
      setError('Completá variante y canónico');
      return;
    }
    if (v === c) {
      setError('Variante y canónico deben ser distintos');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entry: AliasEntry = {
        variante: v,
        canonico: c,
        creado_por: 'admin',
        fecha: new Date().toISOString(),
      };
      const exists = aliases.some((a) => a.variante === v);
      const next = exists ? aliases.map((a) => (a.variante === v ? entry : a)) : [...aliases, entry];
      await persistAliases(next);
      await reparseIfNeeded(next);
      setManualVariante('');
      setManualCanonico('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [manualVariante, manualCanonico, aliases, persistAliases, reparseIfNeeded]);

  const accountMatches = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return [];
    const grouped = new Map<
      string,
      {
        key: string;
        broker: string;
        cuenta: string;
        titular: string;
        titularNormalizado: string;
        posiciones: number;
        aumUsd: number;
      }
    >();
    for (const p of state.allPositions) {
      const haystack = `${p.titular} ${p.titular_normalizado} ${p.cuenta}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      const key = `${p.broker}|${p.cuenta}|${p.titular_normalizado}`;
      const curr = grouped.get(key);
      if (curr) {
        curr.posiciones += 1;
        curr.aumUsd += p.valor_mercado_usd ?? 0;
      } else {
        grouped.set(key, {
          key,
          broker: p.broker,
          cuenta: p.cuenta,
          titular: p.titular,
          titularNormalizado: p.titular_normalizado,
          posiciones: 1,
          aumUsd: p.valor_mercado_usd ?? 0,
        });
      }
    }
    return [...grouped.values()].sort((a, b) => b.aumUsd - a.aumUsd);
  }, [state.allPositions, accountSearch]);

  const addFromSelectedAccounts = useCallback(async () => {
    const c = normalizeTitular(bulkCanonico.trim()).normalizado;
    if (!c) {
      setError('Completá el canónico para unificación por cuentas');
      return;
    }
    if (selectedAccountKeys.length === 0) {
      setError('Seleccioná al menos una cuenta');
      return;
    }
    const selected = accountMatches.filter((m) => selectedAccountKeys.includes(m.key));
    const variantes = [...new Set(selected.map((m) => m.titularNormalizado))].filter((v) => v !== c);
    if (variantes.length === 0) {
      setError('No hay variantes distintas al canónico seleccionado');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const ts = new Date().toISOString();
      const byVariante = new Map(aliases.map((a) => [a.variante, a] as const));
      for (const variante of variantes) {
        const entry: AliasEntry = {
          variante,
          canonico: c,
          creado_por: 'admin',
          fecha: ts,
        };
        byVariante.set(variante, entry);
      }
      const next = [...byVariante.values()];
      await persistAliases(next);
      await reparseIfNeeded(next);
      setSelectedAccountKeys([]);
      setBulkCanonico('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }, [bulkCanonico, selectedAccountKeys, accountMatches, aliases, persistAliases, reparseIfNeeded]);

  return (
    <AdminOnly>
      <div className="space-y-8 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Aliases de titulares</h2>
        <p className="text-muted-foreground mt-1">
          Unificá nombres equivalentes entre brokers. Variante y canónico deben estar normalizados (mayúsculas, sin
          acentos).
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sugerencias automáticas</CardTitle>
          <CardDescription>
            Basadas en el último parseo (fuzzy Jaro-Winkler ≥ 88%). Si no hay datos, andá a{' '}
            <a href="/upload" className="text-primary underline">
              Upload
            </a>{' '}
            y parseá archivos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!state.allPositions.length ? (
            <p className="text-sm text-muted-foreground">No hay posiciones en memoria. Parseá en Upload primero.</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Cargando aliases…</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay pares candidatos (o ya están unificados / ignorados).</p>
          ) : (
            <div className="overflow-auto border rounded-md max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Titular A</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Brokers A</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Titular B</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Brokers B</th>
                    <th className="text-right p-2 text-xs font-medium text-muted-foreground">Score</th>
                    <th className="text-right p-2 text-xs font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((p) => (
                    <tr key={aliasPairKey(p.titular_a, p.titular_b)} className="border-b border-border/40">
                      <td className="p-2 font-mono text-xs max-w-[180px] break-words">{p.titular_a}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {p.brokers_a.map((b) => (
                            <Badge key={b} variant="outline" className="text-[10px]">
                              {b}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 font-mono text-xs max-w-[180px] break-words">{p.titular_b}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {p.brokers_b.map((b) => (
                            <Badge key={b} variant="outline" className="text-[10px]">
                              {b}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono">{(p.score * 100).toFixed(1)}%</td>
                      <td className="p-2 text-right space-x-1 whitespace-nowrap">
                        <Button type="button" size="sm" onClick={() => setMergePair(p)} disabled={saving}>
                          Unir
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => ignorePair(p)} disabled={saving}>
                          Ignorar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Aliases existentes</CardTitle>
          <CardDescription>Variante → canónico persistidos en config</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Unificar por búsqueda de cuentas</p>
            <p className="text-xs text-muted-foreground">
              Escribí parte del nombre (o cuenta), seleccioná las cuentas y definí un canónico único.
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Buscar nombre / cuenta</label>
                <input
                  className="h-9 w-72 rounded-md border bg-background px-2 text-sm"
                  value={accountSearch}
                  onChange={(e) => {
                    setAccountSearch(e.target.value);
                    setSelectedAccountKeys([]);
                  }}
                  placeholder="ej. MARTIN o 001-123456"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Canónico final</label>
                <input
                  className="h-9 w-64 rounded-md border bg-background px-2 text-sm font-mono"
                  value={bulkCanonico}
                  onChange={(e) => setBulkCanonico(e.target.value)}
                  placeholder="ej. MARTIN GONI"
                />
              </div>
              <Button type="button" disabled={saving} onClick={() => void addFromSelectedAccounts()}>
                Guardar aliases de seleccionados
              </Button>
            </div>

            {accountSearch.trim().length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {accountMatches.length} cuenta{accountMatches.length === 1 ? '' : 's'} encontrada
                    {accountMatches.length === 1 ? '' : 's'} · {selectedAccountKeys.length} seleccionada
                    {selectedAccountKeys.length === 1 ? '' : 's'}
                  </p>
                  {accountMatches.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSelectedAccountKeys((prev) =>
                          prev.length === accountMatches.length ? [] : accountMatches.map((m) => m.key)
                        )
                      }
                    >
                      {selectedAccountKeys.length === accountMatches.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </Button>
                  )}
                </div>
                <div className="overflow-auto border rounded-md max-h-[260px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b">
                      <tr>
                        <th className="text-left p-2 text-xs font-medium">Sel</th>
                        <th className="text-left p-2 text-xs font-medium">Titular</th>
                        <th className="text-left p-2 text-xs font-medium">Normalizado</th>
                        <th className="text-left p-2 text-xs font-medium">Broker</th>
                        <th className="text-left p-2 text-xs font-medium">Cuenta</th>
                        <th className="text-right p-2 text-xs font-medium">Posiciones</th>
                        <th className="text-right p-2 text-xs font-medium">AUM USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountMatches.length === 0 ? (
                        <tr>
                          <td className="p-3 text-sm text-muted-foreground" colSpan={7}>
                            Sin resultados para la búsqueda.
                          </td>
                        </tr>
                      ) : (
                        accountMatches.map((m) => {
                          const checked = selectedAccountKeys.includes(m.key);
                          return (
                            <tr key={m.key} className="border-b border-border/30">
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setSelectedAccountKeys((prev) =>
                                      e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key)
                                    )
                                  }
                                />
                              </td>
                              <td className="p-2 text-xs">{m.titular}</td>
                              <td className="p-2 text-xs font-mono">{m.titularNormalizado}</td>
                              <td className="p-2 text-xs">{m.broker}</td>
                              <td className="p-2 text-xs font-mono">{m.cuenta}</td>
                              <td className="p-2 text-right font-mono text-xs">{m.posiciones}</td>
                              <td className="p-2 text-right font-mono text-xs">{m.aumUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Variante</label>
              <input
                className="h-9 w-56 rounded-md border bg-background px-2 text-sm font-mono"
                value={manualVariante}
                onChange={(e) => setManualVariante(e.target.value)}
                placeholder="ej. GONI MARTIN"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Canónico</label>
              <input
                className="h-9 w-56 rounded-md border bg-background px-2 text-sm font-mono"
                value={manualCanonico}
                onChange={(e) => setManualCanonico(e.target.value)}
                placeholder="ej. MARTIN GONI"
              />
            </div>
            <Button type="button" onClick={() => void addManual()} disabled={saving}>
              Guardar manual
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Al guardar se aplica <span className="font-mono">normalizeTitular</span> (mayúsculas, sin acentos, orden
            nombre/apellido).
          </p>

          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <div className="overflow-auto border rounded-md max-h-[360px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 border-b">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium">Variante</th>
                    <th className="text-left p-2 text-xs font-medium">Canónico</th>
                    <th className="text-left p-2 text-xs font-medium">Creado por</th>
                    <th className="text-left p-2 text-xs font-medium">Fecha</th>
                    <th className="text-right p-2 text-xs font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {aliases.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground text-sm">
                        No hay aliases todavía.
                      </td>
                    </tr>
                  ) : (
                    aliases.map((a) => (
                      <tr key={a.variante} className="border-b border-border/30">
                        <td className="p-2 font-mono text-xs">{a.variante}</td>
                        <td className="p-2 font-mono text-xs font-medium">{a.canonico}</td>
                        <td className="p-2 text-muted-foreground text-xs">{a.creado_por}</td>
                        <td className="p-2 text-muted-foreground text-xs whitespace-nowrap">
                          {a.fecha.slice(0, 10)}
                        </td>
                        <td className="p-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={saving}
                            onClick={() => void removeAlias(a.variante)}
                          >
                            Eliminar
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {mergePair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg space-y-4">
            <h3 className="text-lg font-semibold">Elegir nombre canónico</h3>
            <p className="text-sm text-muted-foreground">
              El otro quedará como variante que resuelve a este canónico para el hash de cliente.
            </p>
            <div className="space-y-2">
              <Button
                type="button"
                className="w-full justify-start h-auto py-3 px-3 font-mono text-xs text-left whitespace-normal"
                variant="outline"
                onClick={() => void confirmMerge('a')}
                disabled={saving}
              >
                <span className="font-semibold mr-2">A:</span> {mergePair.titular_a}
              </Button>
              <Button
                type="button"
                className="w-full justify-start h-auto py-3 px-3 font-mono text-xs text-left whitespace-normal"
                variant="outline"
                onClick={() => void confirmMerge('b')}
                disabled={saving}
              >
                <span className="font-semibold mr-2">B:</span> {mergePair.titular_b}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setMergePair(null)} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminOnly>
  );
}
