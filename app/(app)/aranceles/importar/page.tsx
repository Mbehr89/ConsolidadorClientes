'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DriveSyncPanel } from '@/components/aranceles/drive-sync-panel';
import { IebPeriodWizard } from '@/components/aranceles/ieb-period-wizard';
import { ImportWizard } from '@/components/aranceles/import-wizard';
import { ErrorBlock, readJson } from '@/components/aranceles/shared';
import { formatDate, formatNumber } from '@/lib/aranceles/format';
import type { ArancelImport } from '@/lib/aranceles/types';
import { cn } from '@/lib/utils';

type ManualMode = 'file' | 'ieb';

export default function ArancelesImportarPage() {
  const [mode, setMode] = useState<ManualMode>('file');
  const [imports, setImports] = useState<ArancelImport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadImports = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/aranceles/imports', { cache: 'no-store' });
      const json = await readJson<{ imports: ArancelImport[] }>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al listar importaciones');
      setImports(json.imports);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }, []);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  const remove = async (imp: ArancelImport) => {
    if (!window.confirm(`¿Borrar la importación "${imp.filename}" (${imp.row_count} filas) del historial?`)) return;
    setDeleting(imp.id);
    try {
      const res = await fetch(`/api/aranceles/imports?id=${encodeURIComponent(imp.id)}`, { method: 'DELETE' });
      const json = await readJson<{ removedRows: number }>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo borrar');
      await loadImports();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setDeleting(null);
    }
  };

  const alycs = [...new Set(imports.map((i) => i.alyc))].sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <div className="space-y-6">
      <DriveSyncPanel onImported={() => void loadImports()} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Subir archivo a mano</CardTitle>
          <CardDescription>
            Para planillas que no están en Drive o con formato no reconocido (mapeo de columnas manual).
          </CardDescription>
          <div className="flex gap-1 pt-2">
            {(
              [
                ['file', 'Un archivo'],
                ['ieb', 'Período IEB (varios segmentos)'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={mode === value ? 'default' : 'outline'}
                className={cn(mode === value && 'pointer-events-none')}
                onClick={() => setMode(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {mode === 'file' ? (
            <ImportWizard alycs={alycs} onImported={() => void loadImports()} />
          ) : (
            <IebPeriodWizard onImported={() => void loadImports()} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Importaciones en el historial ({imports.length})</CardTitle>
          <CardDescription>
            Si un archivo se cargó mal, borralo acá: se quitan sus operaciones y se recalculan tarifas y control. Los
            archivos de Drive modificados se reemplazan solos al sincronizar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <ErrorBlock message={error} onRetry={() => void loadImports()} />}
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay importaciones.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 border-b bg-card">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="p-2 text-left font-medium">Fecha</th>
                    <th className="p-2 text-left font-medium">ALYC</th>
                    <th className="p-2 text-left font-medium">Archivo</th>
                    <th className="p-2 text-left font-medium">Origen</th>
                    <th className="p-2 text-left font-medium">Período</th>
                    <th className="p-2 text-right font-medium">Filas</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => (
                    <tr key={imp.id} className="border-b border-border/50">
                      <td className="whitespace-nowrap p-2">{formatDate(imp.imported_at.slice(0, 10))}</td>
                      <td className="p-2">{imp.alyc}</td>
                      <td className="p-2">
                        {imp.filename}
                        {imp.segment && <span className="ml-1 text-xs text-muted-foreground">({imp.segment})</span>}
                      </td>
                      <td className="p-2">
                        <Badge variant={imp.source === 'drive' ? 'success' : 'secondary'}>
                          {imp.source === 'drive' ? 'Drive' : 'Manual'}
                        </Badge>
                      </td>
                      <td className="p-2 text-muted-foreground">{imp.period_label ?? '—'}</td>
                      <td className="p-2 text-right tabular-nums">{formatNumber(imp.row_count)}</td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleting === imp.id}
                          onClick={() => void remove(imp)}
                        >
                          {deleting === imp.id ? 'Borrando…' : 'Borrar'}
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
  );
}
