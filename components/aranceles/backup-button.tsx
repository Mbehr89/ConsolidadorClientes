'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { readJson } from '@/components/aranceles/shared';
import type { BackupSummary } from '@/lib/aranceles/backup';
import { formatDate, formatNumber } from '@/lib/aranceles/format';

type BackupResponse = BackupSummary & {
  content: string;
  storedIn: 'drive' | 'local' | null;
  storeError: string | null;
};

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/aranceles/backup', { method: 'POST' });
      const json = await readJson<BackupResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar el backup');
      if (json.storedIn !== 'drive') download(json.filename, json.content);
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? 'Generando backup…' : 'Guardar backup'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground">{result.filename}</p>
          <p className="text-muted-foreground">
            {formatNumber(result.operations)} operaciones
            {result.lastOperationByAlyc.length > 0 &&
              ' · última operación: ' +
                result.lastOperationByAlyc.map((a) => `${a.alyc} ${formatDate(a.date)}`).join(', ')}
          </p>
          {result.storedIn === 'drive' && (
            <p className="text-teal-700 dark:text-teal-400">
              Guardado en la carpeta de Drive.{' '}
              <button type="button" className="underline" onClick={() => download(result.filename, result.content)}>
                Descargar también
              </button>
            </p>
          )}
          {result.storedIn === 'local' && (
            <p className="text-muted-foreground">
              Descargado y guardado en <span className="font-mono">.local-store/backups-aranceles/</span>.
            </p>
          )}
          {result.storeError && <p className="text-amber-700 dark:text-amber-400">{result.storeError}</p>}
        </div>
      )}
    </div>
  );
}
