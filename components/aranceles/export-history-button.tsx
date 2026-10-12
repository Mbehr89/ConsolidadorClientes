'use client';

import { Check, Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readJson } from '@/components/aranceles/shared';
import type { BackupSummary, HistoryContentItem } from '@/lib/aranceles/backup';
import { formatDate, formatNumber } from '@/lib/aranceles/format';

type ExportResponse = BackupSummary & {
  contents: { included: HistoryContentItem[]; notIncluded: HistoryContentItem[] };
  history: unknown;
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

/** Descarga el historial completo (el mismo JSON que está en Drive) y explica qué incluye. */
export function ExportHistoryButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Omit<ExportResponse, 'history'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const open = result != null || error != null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setResult(null);
        setError(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/aranceles/export', { cache: 'no-store' });
      const json = await readJson<ExportResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo exportar el historial');
      const { history, ...rest } = json;
      download(json.filename, JSON.stringify(history, null, 2));
      setResult(rest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        <Download className="mr-1.5 h-4 w-4" />
        {busy ? 'Exportando…' : 'Exportar'}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(440px,90vw)] space-y-3 rounded-md border bg-popover p-4 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-foreground">
              {error ? 'No se pudo exportar' : 'Historial descargado'}
            </p>
            <button
              type="button"
              aria-label="Cerrar"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {result && (
            <>
              <div className="text-xs text-muted-foreground">
                <p className="break-all font-mono text-foreground">{result.filename}</p>
                <p>
                  {formatNumber(result.operations)} operaciones
                  {result.lastOperationByAlyc.length > 0 &&
                    ' · última: ' + result.lastOperationByAlyc.map((a) => `${a.alyc} ${formatDate(a.date)}`).join(', ')}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Incluye operaciones y configuración
                </p>
                <ul className="space-y-1.5">
                  {result.contents.included.map((item) => (
                    <li key={item.label} className="flex gap-2 text-xs">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                      <span>
                        <span className="font-medium text-foreground">{item.label}:</span>{' '}
                        <span className="text-muted-foreground">{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5 border-t pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">No incluye</p>
                <ul className="space-y-1.5">
                  {result.contents.notIncluded.map((item) => (
                    <li key={item.label} className="flex gap-2 text-xs">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        <span className="font-medium text-foreground">{item.label}:</span>{' '}
                        <span className="text-muted-foreground">{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
