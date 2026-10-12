'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBlock, LoadingBlock, readJson } from '@/components/aranceles/shared';
import { formatDate } from '@/lib/aranceles/format';
import type { DrivePendingFile, DriveSyncFileResult } from '@/lib/aranceles/import-service';
import type { ArancelesStorageInfo } from '@/lib/aranceles/store';
import type { DriveFileRecord } from '@/lib/aranceles/types';

const BATCH_SIZE = 2;

type StatusResponse = {
  storage: ArancelesStorageInfo;
  configured: boolean;
  totalInFolder?: number;
  processedCount?: number;
  pending?: DrivePendingFile[];
  records?: DriveFileRecord[];
};

type SyncResponse = {
  processed: DriveSyncFileResult[];
  pendingRemaining: number;
  anomalyCount: number;
};

const REASON_LABEL: Record<DrivePendingFile['reason'], string> = {
  new: 'Nuevo',
  modified: 'Modificado',
  retry: 'Reintento',
  forced: 'Reprocesar',
};

const STATUS_BADGE: Record<DriveFileRecord['status'], { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  imported: { label: 'Importado', variant: 'success' },
  empty: { label: 'Vacío', variant: 'secondary' },
  needs_mapping: { label: 'Requiere mapeo', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
};

export function DriveSyncPanel({ onImported }: { onImported?: () => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<DriveSyncFileResult[]>([]);
  const [anomalies, setAnomalies] = useState(0);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/aranceles/drive', { cache: 'no-store' });
      const json = await readJson<StatusResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo leer Drive');
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    setProgress([]);
    setAnomalies(0);
    try {
      for (let guard = 0; guard < 50; guard++) {
        const res = await fetch('/api/aranceles/drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: BATCH_SIZE }),
        });
        const json = await readJson<SyncResponse>(res);
        if (!res.ok) throw new Error(json.error ?? 'Error al sincronizar');
        setProgress((prev) => [...prev, ...json.processed]);
        setAnomalies((prev) => prev + json.anomalyCount);
        if (json.processed.length === 0 || json.pendingRemaining === 0) break;
      }
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSyncing(false);
      void loadStatus();
    }
  };

  const pending = status?.pending ?? [];
  const records = status?.records ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Carpeta de Drive</CardTitle>
        <CardDescription>
          Se leen los Excel de la carpeta (y subcarpetas). Los archivos nuevos o modificados se importan y el historial se
          guarda en el JSON de la misma carpeta. También corre solo una vez por día.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !status && <LoadingBlock label="Consultando Drive…" />}
        {error && <ErrorBlock message={error} onRetry={() => void loadStatus()} />}

        {status && !status.configured && status.storage.backend === 'local' && (
          <div className="space-y-2 rounded-md border border-dashed p-4 text-sm">
            <p className="font-medium">Drive no configurado</p>
            <p className="text-muted-foreground">
              Faltan las variables: <span className="font-mono text-xs">{status.storage.missingDriveVars.join(', ')}</span>.
              Mientras tanto el historial se guarda localmente en <span className="font-mono text-xs">.local-store/</span> y
              podés subir archivos a mano.
            </p>
          </div>
        )}

        {status?.configured && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="success">Conectado</Badge>
              <span className="text-muted-foreground">
                {status.totalInFolder ?? 0} Excel en la carpeta · {status.processedCount ?? 0} procesados ·{' '}
                <span className={pending.length ? 'font-medium text-foreground' : ''}>{pending.length} pendientes</span>
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" disabled={loading || syncing} onClick={() => void loadStatus()}>
                  Actualizar
                </Button>
                <Button size="sm" disabled={syncing || pending.length === 0} onClick={() => void sync()}>
                  {syncing ? 'Sincronizando…' : `Importar pendientes (${pending.length})`}
                </Button>
              </div>
            </div>

            {pending.length > 0 && !syncing && (
              <ul className="divide-y rounded-md border text-sm">
                {pending.slice(0, 20).map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate">
                      {f.path && <span className="text-muted-foreground">{f.path} / </span>}
                      {f.name}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {f.modifiedTime && formatDate(f.modifiedTime.slice(0, 10))}
                      <Badge variant="outline">{REASON_LABEL[f.reason]}</Badge>
                    </span>
                  </li>
                ))}
                {pending.length > 20 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">y {pending.length - 20} más…</li>
                )}
              </ul>
            )}

            {progress.length > 0 && (
              <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {syncing ? 'Procesando…' : 'Sincronización terminada'} · {progress.length} archivo(s)
                  {anomalies > 0 ? ` · ${anomalies} operaciones para revisar en Control` : ''}
                </p>
                <ul className="space-y-1">
                  {progress.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_BADGE[p.status].variant}>{STATUS_BADGE[p.status].label}</Badge>
                      <span>{p.name}</span>
                      {p.status === 'imported' && (
                        <span className="text-muted-foreground">{p.rowCount} operaciones nuevas</span>
                      )}
                      {p.conflicts > 0 && (
                        <Badge variant="warning">{p.conflicts} conflictos (ver Importaciones)</Badge>
                      )}
                      {p.message && <span className="text-xs text-muted-foreground">{p.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {records.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Archivos ya procesados ({records.length})</summary>
                <ul className="mt-2 max-h-72 divide-y overflow-auto rounded-md border">
                  {records.map((r) => (
                    <li key={r.file_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
                      <span className="min-w-0 truncate">
                        {r.path && <span className="text-muted-foreground">{r.path} / </span>}
                        {r.name}
                      </span>
                      {r.message && <span className="text-xs text-muted-foreground">{r.message}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{formatDate(r.processed_at.slice(0, 10))}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
