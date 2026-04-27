'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BrokerCodeSchema, type BrokerCode, type Position } from '@/lib/schema';
import type { MappingCuentasStore } from '@/lib/config-store/types';
import { AdminOnly } from '@/components/admin-only';
import { useConsolidation } from '@/lib/context/consolidation-context';

const BROKERS: BrokerCode[] = ['MS', 'NETX360', 'GMA', 'IEB'];

const EMPTY_STORE = (): MappingCuentasStore => ({
  MS: {},
  NETX360: {},
  GMA: {},
  IEB: {},
});

interface MappingRow {
  id: string;
  broker: BrokerCode;
  cuenta: string;
  titular: string;
  productor: string;
  advisor: string;
}

interface PendingImport {
  filename: string;
  rows: MappingRow[];
}

function storeToRows(store: MappingCuentasStore): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const broker of BROKERS) {
    const m = store[broker] ?? {};
    for (const [cuenta, value] of Object.entries(m)) {
      const titular = typeof value === 'string' ? value : value.titular;
      const productor = typeof value === 'string' ? '' : (value.productor ?? '');
      const advisor = typeof value === 'string' ? '' : (value.advisor ?? '');
      rows.push({
        id: `${broker}::${cuenta}`,
        broker,
        cuenta,
        titular,
        productor,
        advisor,
      });
    }
  }
  return rows;
}

function rowsToStore(rows: MappingRow[]): MappingCuentasStore {
  const store = EMPTY_STORE();
  for (const r of rows) {
    const cuenta = r.cuenta.trim();
    const titular = r.titular.trim();
    const productor = r.productor.trim();
    const advisor = r.advisor.trim();
    if (!cuenta) continue;
    const br = BrokerCodeSchema.safeParse(r.broker);
    if (!br.success) continue;
    const bucket = store[br.data];
    if (bucket) {
      bucket[cuenta] = {
        titular,
        productor: productor || null,
        advisor: advisor || null,
      };
    }
  }
  return store;
}

function mergeStore(base: MappingCuentasStore, incoming: MappingCuentasStore): MappingCuentasStore {
  const out = EMPTY_STORE();
  for (const b of BROKERS) {
    out[b] = { ...(base[b] ?? {}), ...(incoming[b] ?? {}) };
  }
  return out;
}

function rowsToMap(rows: MappingRow[]): Map<string, MappingRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

function detectedRowsFromPositions(positions: Position[]): MappingRow[] {
  const out = new Map<string, MappingRow>();
  for (const p of positions) {
    const id = `${p.broker}::${p.cuenta}`;
    if (out.has(id)) continue;
    const titular =
      p.titular.startsWith(`${p.broker}-`) || p.titular.startsWith('Cuenta ')
        ? ''
        : p.titular;
    out.set(id, {
      id,
      broker: p.broker,
      cuenta: p.cuenta,
      titular,
      productor: p.productor ?? '',
      advisor: '',
    });
  }
  return Array.from(out.values());
}

function detectedRowsFromCache(): MappingRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('mapping_detected_accounts_cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      broker: string;
      cuenta: string;
      titular: string;
      productor: string | null;
    }>;
    const out: MappingRow[] = [];
    for (const p of parsed) {
      const br = BrokerCodeSchema.safeParse(p.broker);
      if (!br.success) continue;
      const cuenta = String(p.cuenta ?? '').trim();
      if (!cuenta) continue;
      out.push({
        id: `${br.data}::${cuenta}`,
        broker: br.data,
        cuenta,
        titular: String(p.titular ?? '').trim(),
        productor: String(p.productor ?? '').trim(),
        advisor: '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeDetectedRows(base: MappingRow[], detected: MappingRow[]): MappingRow[] {
  const map = rowsToMap(base);
  for (const row of detected) {
    const existing = map.get(row.id);
    if (!existing) {
      map.set(row.id, row);
      continue;
    }
    // Completar huecos sin pisar edición existente.
    if (!existing.titular.trim() && row.titular.trim()) existing.titular = row.titular;
    if (!existing.productor.trim() && row.productor.trim()) existing.productor = row.productor;
  }
  return Array.from(map.values()).sort((a, b) => {
    const byBroker = a.broker.localeCompare(b.broker);
    if (byBroker !== 0) return byBroker;
    return a.cuenta.localeCompare(b.cuenta);
  });
}

function parseMappingExcel(buffer: ArrayBuffer): MappingRow[] {
  const wb = read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName]!;
  const matrix: unknown[][] = utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (matrix.length < 2) return [];

  const header = (matrix[0] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
  const iBroker = header.indexOf('broker');
  const iCuenta = header.indexOf('cuenta');
  const iTitular = header.indexOf('titular');
  const iProductor = header.indexOf('productor');
  const iAdvisor = header.indexOf('advisor');
  if (iBroker === -1 || iCuenta === -1) {
    throw new Error('La primera fila debe incluir: broker | cuenta (opcionales: titular, productor, advisor)');
  }

  const out: MappingRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const brokerRaw = String(row[iBroker] ?? '').trim().toUpperCase();
    const cuenta = String(row[iCuenta] ?? '').trim();
    const titular = iTitular >= 0 ? String(row[iTitular] ?? '').trim() : '';
    const productor = iProductor >= 0 ? String(row[iProductor] ?? '').trim() : '';
    const advisor = iAdvisor >= 0 ? String(row[iAdvisor] ?? '').trim() : '';
    if (!cuenta && !titular && !brokerRaw) continue;

    const br = BrokerCodeSchema.safeParse(brokerRaw);
    if (!br.success) {
      throw new Error(`Fila ${r + 1}: broker inválido "${brokerRaw}"`);
    }
    if (!cuenta) {
      throw new Error(`Fila ${r + 1}: cuenta es obligatoria`);
    }
    out.push({
      id: `xlsx-${r}-${Math.random().toString(36).slice(2, 8)}`,
      broker: br.data,
      cuenta,
      titular,
      productor,
      advisor,
    });
  }
  return out;
}

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function MappingCuentasPage() {
  const { state } = useConsolidation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/config/mapping-cuentas');
      if (!res.ok) throw new Error('No se pudo cargar el mapping');
      const data = (await res.json()) as MappingCuentasStore;
      const persisted = storeToRows(data);
      const detectedFromPositions = detectedRowsFromPositions(state.allPositions);
      const detectedFromCache = detectedRowsFromCache();
      const mergedDetected = [...detectedFromPositions, ...detectedFromCache];
      setRows(mergeDetectedRows(persisted, mergedDetected));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [state.allPositions]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const detected = detectedRowsFromPositions(state.allPositions);
    if (detected.length === 0) return;
    setRows((prev) => mergeDetectedRows(prev, detected));
  }, [state.allPositions]);

  useEffect(() => {
    const cached = detectedRowsFromCache();
    if (cached.length === 0) return;
    setRows((prev) => mergeDetectedRows(prev, cached));
  }, []);

  const countsByBroker = useMemo(() => {
    const c: Record<BrokerCode, number> = { MS: 0, NETX360: 0, GMA: 0, IEB: 0 };
    for (const r of rows) {
      if (r.cuenta.trim()) c[r.broker] += 1;
    }
    return c;
  }, [rows]);

  const totalAccounts = useMemo(() => rows.filter((r) => r.cuenta.trim()).length, [rows]);
  const totalCompleted = useMemo(
    () => rows.filter((r) => r.cuenta.trim() && r.titular.trim()).length,
    [rows]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSuccess(null);
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseMappingExcel(buf);
        setPendingImport({ filename: file.name, rows: parsed });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error leyendo Excel');
      }
    },
    []
  );

  const pendingPreview = useMemo(() => {
    if (!pendingImport) {
      return { total: 0, newCount: 0, overwriteCount: 0 };
    }
    const existing = rowsToMap(rows);
    let newCount = 0;
    let overwriteCount = 0;
    for (const r of pendingImport.rows) {
      if (existing.has(`${r.broker}::${r.cuenta}`)) overwriteCount += 1;
      else newCount += 1;
    }
    return { total: pendingImport.rows.length, newCount, overwriteCount };
  }, [pendingImport, rows]);

  const applyPendingImport = useCallback(() => {
    if (!pendingImport) return;
    setRows((prev) => {
      const merged = mergeStore(rowsToStore(prev), rowsToStore(pendingImport.rows));
      return storeToRows(merged);
    });
    setSuccess(
      `Importación aplicada: ${pendingImport.rows.length} filas (${pendingPreview.newCount} nuevas, ${pendingPreview.overwriteCount} actualizadas).`
    );
    setPendingImport(null);
  }, [pendingImport, pendingPreview.newCount, pendingPreview.overwriteCount]);

  const cancelPendingImport = useCallback(() => {
    setPendingImport(null);
    setSuccess('Importación cancelada. No se aplicaron cambios.');
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = Array.from(e.dataTransfer.files).find((x) => /\.(xlsx|xls|xlsm)$/i.test(x.name));
      if (f) void handleFile(f);
    },
    [handleFile]
  );

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: `new-${crypto.randomUUID()}`,
        broker: 'GMA',
        cuenta: '',
        titular: '',
        productor: '',
        advisor: '',
      },
    ]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<Pick<MappingRow, 'broker' | 'cuenta' | 'titular' | 'productor' | 'advisor'>>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const exportBackup = useCallback(() => {
    const dataRows = rows.filter((r) => r.cuenta.trim().length > 0);
    const aoa: string[][] = [
      ['broker', 'cuenta', 'titular', 'productor', 'advisor'],
      ...dataRows.map((r) => [r.broker, r.cuenta, r.titular, r.productor, r.advisor]),
    ];
    const ws = utils.aoa_to_sheet(aoa);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'mapping');
    const name = `mapping_cuentas_backup_${localDateYmd()}.xlsx`;
    writeFile(wb, name, { bookType: 'xlsx', compression: true });
  }, [rows]);

  const save = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const store = rowsToStore(rows);
      const res = await fetch('/api/config/mapping-cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(store),
      });
      if (!res.ok) throw new Error('No se pudo guardar');
      setSuccess('Mapping guardado correctamente');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }, [rows, load]);

  return (
    <AdminOnly>
      <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mapping cuenta → titular/productor/advisor</h2>
        <p className="text-muted-foreground mt-1">
          GMA y MS no traen nombres en el Excel de tenencias. Subí un archivo con columnas{' '}
          <span className="font-mono text-xs">broker</span>, <span className="font-mono text-xs">cuenta</span>,{' '}
          <span className="font-mono text-xs">titular</span> y opcionales{' '}
          <span className="font-mono text-xs">productor</span>, <span className="font-mono text-xs">advisor</span>; o editá la tabla manualmente.
          También se incluyen automáticamente cuentas detectadas aunque falte titular/advisor, para que puedas completar desde esta pantalla.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {totalAccounts} cuentas totales ({totalCompleted} completas)
        </span>
        {BROKERS.map((b) => (
          <Badge key={b} variant="secondary" className="font-mono">
            {b}: {countsByBroker[b]}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Importar Excel</CardTitle>
          <CardDescription>Primera fila: broker, cuenta (opcionales: titular, productor, advisor) — broker: MS, NETX360, GMA, IEB</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            <p className="text-sm font-medium">Arrastrá un .xlsx acá o hacé click</p>
            <p className="text-xs text-muted-foreground mt-1">Se combina con el mapping ya cargado (misma cuenta+broker se sobrescribe)</p>
          </div>
        </CardContent>
      </Card>

      {pendingImport && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-lg">Preview de importación</CardTitle>
            <CardDescription>
              Archivo: <span className="font-mono text-xs">{pendingImport.filename}</span> — {pendingPreview.total} fila(s), {pendingPreview.newCount} nuevas, {pendingPreview.overwriteCount} a sobrescribir.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-auto max-h-[320px] border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Broker</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Cuenta</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Titular</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Productor</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground uppercase">Advisor</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingImport.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/30">
                      <td className="p-2">{r.broker}</td>
                      <td className="p-2 font-mono text-xs">{r.cuenta}</td>
                      <td className="p-2">{r.titular || '—'}</td>
                      <td className="p-2">{r.productor || '—'}</td>
                      <td className="p-2">{r.advisor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={cancelPendingImport}>
                Cancelar
              </Button>
              <Button type="button" onClick={applyPendingImport}>
                Incorporar al mapping actual
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(error || success) && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            error ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
          )}
        >
          {error ?? success}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Mapping actual</CardTitle>
            <CardDescription>
              Editá filas o eliminá entradas. Guardá para persistir en config (KV / memoria en dev). Exportar backup descarga un Excel
              compatible con &quot;Importar Excel&quot; (incluye la grilla actual aunque no hayas guardado).
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={exportBackup}
              disabled={loading || totalAccounts === 0}
              title="Descarga un .xlsx con el mismo formato que la importación (incluye cambios aún no guardados)"
            >
              Exportar backup
            </Button>
            <Button type="button" variant="outline" onClick={addRow}>
              Agregar fila
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || loading}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <div className="overflow-auto max-h-[560px] border-t">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Broker</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Cuenta</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Titular</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Productor/Manager</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase">Advisor</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase w-24"> </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                        No hay filas. Importá un Excel o agregá una fila manualmente.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="p-2 align-middle">
                        <select
                          className="h-9 w-full min-w-[120px] rounded-md border bg-background px-2 text-sm"
                          value={r.broker}
                          onChange={(e) => updateRow(r.id, { broker: e.target.value as BrokerCode })}
                        >
                          {BROKERS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 align-middle">
                        <input
                          className="h-9 w-full min-w-[200px] rounded-md border bg-background px-2 text-sm font-mono"
                          value={r.cuenta}
                          onChange={(e) => updateRow(r.id, { cuenta: e.target.value })}
                          placeholder="ej. 2319 o MFR - 3815"
                        />
                      </td>
                      <td className="p-2 align-middle">
                        <input
                          className="h-9 w-full min-w-[240px] rounded-md border bg-background px-2 text-sm"
                          value={r.titular}
                          onChange={(e) => updateRow(r.id, { titular: e.target.value })}
                          placeholder="Nombre titular"
                        />
                      </td>
                      <td className="p-2 align-middle">
                        <input
                          className="h-9 w-full min-w-[220px] rounded-md border bg-background px-2 text-sm"
                          value={r.productor}
                          onChange={(e) => updateRow(r.id, { productor: e.target.value })}
                          placeholder="Manager / Productor"
                        />
                      </td>
                      <td className="p-2 align-middle">
                        <input
                          className="h-9 w-full min-w-[180px] rounded-md border bg-background px-2 text-sm"
                          value={r.advisor}
                          onChange={(e) => updateRow(r.id, { advisor: e.target.value })}
                          placeholder="Advisor"
                        />
                      </td>
                      <td className="p-2 align-middle text-right">
                        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeRow(r.id)}>
                          Eliminar
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
      </div>
    </AdminOnly>
  );
}
