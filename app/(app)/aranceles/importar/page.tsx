'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BackupButton } from '@/components/aranceles/backup-button';
import { ConflictList } from '@/components/aranceles/conflict-list';
import { DriveSyncPanel } from '@/components/aranceles/drive-sync-panel';
import { IebPeriodWizard } from '@/components/aranceles/ieb-period-wizard';
import { ImportWizard } from '@/components/aranceles/import-wizard';
import { ErrorBlock, readJson } from '@/components/aranceles/shared';
import { formatDate, formatNumber } from '@/lib/aranceles/format';
import type { ArancelImport } from '@/lib/aranceles/types';
import { cn } from '@/lib/utils';

type ManualMode = 'file' | 'ieb';

type Integrity = {
  operations: number;
  withId: number;
  withoutId: number;
  duplicateGroups: number;
  duplicateSample: (string | null)[];
  sharedIdGroups: number;
  sharedIdSample: { op_number: string | null; rows: number; imports: (string | undefined)[] }[];
};

type ImportsResponse = {
  imports: ArancelImport[];
  usage: Record<string, { own: number; shared: number }>;
  integrity: Integrity;
};

export default function ArancelesImportarPage() {
  const [mode, setMode] = useState<ManualMode>('file');
  const [data, setData] = useState<ImportsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openConflicts, setOpenConflicts] = useState<string | null>(null);

  const loadImports = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/aranceles/imports', { cache: 'no-store' });
      const json = await readJson<ImportsResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al listar importaciones');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }, []);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  const imports = data?.imports ?? [];

  const remove = async (imp: ArancelImport) => {
    const usage = data?.usage[imp.id] ?? { own: 0, shared: 0 };
    const msg =
      `¿Borrar la importación "${imp.filename}" del historial?\n\n` +
      `· ${usage.own} operaciones vinieron sólo en este archivo y se van a borrar.\n` +
      (usage.shared
        ? `· ${usage.shared} operaciones también están en otros archivos y se conservan.`
        : '· Ninguna operación de este archivo está en otros archivos.') +
      (imp.source === 'drive' ? '\n\nEl archivo vuelve a quedar pendiente en la carpeta de Drive.' : '');
    if (!window.confirm(msg)) return;
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
            Cada operación se identifica por ALYC + n° de boleto / ID. Si un archivo trae operaciones que ya estaban,
            no se duplican; si trae un n° ya cargado con datos distintos, no se importa y queda como conflicto para
            revisar. Al borrar un archivo se conservan las operaciones que también vinieron en otro.
          </CardDescription>
          {data && <IntegrityBadge integrity={data.integrity} imports={imports} />}
          <div className="pt-2">
            <BackupButton />
          </div>
        </CardHeader>
        <CardContent>
          {error && <ErrorBlock message={error} onRetry={() => void loadImports()} />}
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay importaciones.</p>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 border-b bg-card">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="p-2 text-left font-medium">Fecha</th>
                    <th className="p-2 text-left font-medium">ALYC</th>
                    <th className="p-2 text-left font-medium">Archivo</th>
                    <th className="p-2 text-left font-medium">Origen</th>
                    <th className="p-2 text-left font-medium">Período</th>
                    <th className="p-2 text-right font-medium">Nuevas</th>
                    <th className="p-2 text-right font-medium">Ya estaban</th>
                    <th className="p-2 text-right font-medium">Conflictos</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => {
                    const conflicts = imp.conflicts ?? [];
                    const repeated = (imp.duplicate_count ?? 0) + (imp.repeated_in_file ?? 0);
                    const open = openConflicts === imp.id;
                    return (
                      <Fragment key={imp.id}>
                        <tr className="border-b border-border/50">
                          <td className="whitespace-nowrap p-2">{formatDate(imp.imported_at.slice(0, 10))}</td>
                          <td className="p-2">{imp.alyc}</td>
                          <td className="p-2">
                            {imp.filename}
                            {imp.segment && (
                              <span className="ml-1 text-xs text-muted-foreground">({imp.segment})</span>
                            )}
                          </td>
                          <td className="p-2">
                            <Badge variant={imp.source === 'drive' ? 'success' : 'secondary'}>
                              {imp.source === 'drive' ? 'Drive' : 'Manual'}
                            </Badge>
                          </td>
                          <td className="p-2 text-muted-foreground">{imp.period_label ?? '—'}</td>
                          <td className="p-2 text-right tabular-nums">{formatNumber(imp.row_count)}</td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">
                            {repeated ? formatNumber(repeated) : '—'}
                          </td>
                          <td className="p-2 text-right">
                            {conflicts.length ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-amber-700 dark:text-amber-400"
                                onClick={() => setOpenConflicts(open ? null : imp.id)}
                              >
                                {conflicts.length} {open ? '▲' : '▼'}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
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
                        {open && (
                          <tr className="border-b border-border/50 bg-amber-50/50 dark:bg-amber-950/20">
                            <td colSpan={9} className="p-3">
                              <ConflictList conflicts={conflicts} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrityBadge({ integrity, imports }: { integrity: Integrity; imports: ArancelImport[] }) {
  if (integrity.duplicateGroups > 0) {
    return (
      <div className="pt-2">
        <Badge variant="destructive">
          {integrity.duplicateGroups} operaciones duplicadas en el historial (n° {integrity.duplicateSample.join(', ')})
        </Badge>
      </div>
    );
  }
  if (integrity.sharedIdGroups > 0) {
    const fileOf = (id: string | undefined) => imports.find((i) => i.id === id)?.filename ?? '¿?';
    return (
      <div className="space-y-1 pt-2 text-xs">
        <Badge variant="destructive">
          {integrity.sharedIdGroups} n° de operación compartidos por operaciones distintas
        </Badge>
        <ul className="text-muted-foreground">
          {integrity.sharedIdSample.map((g) => (
            <li key={g.op_number ?? ''}>
              n° {g.op_number}: {g.rows} operaciones · {g.imports.map(fileOf).join(', ')}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Suele ser un archivo leído con la columna de n° equivocada: borrá esa importación y volvé a importarla.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
      <Badge variant="success">Sin operaciones duplicadas</Badge>
      <span>
        {formatNumber(integrity.operations)} operaciones · {formatNumber(integrity.withId)} identificadas por n° de
        boleto / ID
        {integrity.withoutId ? ` · ${formatNumber(integrity.withoutId)} sin n° (se comparan por contenido)` : ''}
      </span>
    </div>
  );
}
