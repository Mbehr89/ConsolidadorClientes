'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBlock, inputClass, readJson } from '@/components/aranceles/shared';
import type { IebSegmentResult } from '@/lib/aranceles/import-service';
import { IEB_SEGMENTS } from '@/lib/aranceles/mappers/ieb';

type IebResponse = { totalRows: number; anomalyCount: number; results: IebSegmentResult[] };

function firstOfPreviousMonth(): string {
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`;
}

export function IebPeriodWizard({ onImported }: { onImported?: () => void }) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fallbackDate, setFallbackDate] = useState(firstOfPreviousMonth);
  const [periodLabel, setPeriodLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IebResponse | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set('alycName', 'IEB');
      form.set('fallbackDate', fallbackDate);
      form.set('periodLabel', periodLabel || fallbackDate.slice(0, 7));
      let any = false;
      for (const seg of IEB_SEGMENTS) {
        const f = files[seg.id];
        if (f) {
          form.set(seg.id, f);
          any = true;
        }
      }
      if (!any) throw new Error('Subí al menos un segmento. El resto puede quedar vacío.');
      const res = await fetch('/api/aranceles/import/ieb', { method: 'POST', body: form });
      const json = await readJson<IebResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al importar IEB');
      setResult(json);
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        IEB exporta varios Excel por período. Podés subir cualquiera de los segmentos; los que falten o vengan vacíos
        (SENEBI, licitaciones, notas) son normales.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Período (etiqueta)
          <input
            className={`${inputClass} w-40`}
            placeholder={fallbackDate.slice(0, 7)}
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Fecha de referencia (ACDI y segmentos sin fecha)
          <input type="date" className={`${inputClass} w-48`} value={fallbackDate} onChange={(e) => setFallbackDate(e.target.value)} />
        </label>
      </div>

      <ul className="divide-y rounded-md border">
        {IEB_SEGMENTS.map((seg) => {
          const f = files[seg.id];
          return (
            <li key={seg.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{seg.label}</p>
                <p className="text-xs text-muted-foreground">Opcional · ej. {seg.fileHint}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1"
                  onChange={(e) => {
                    setFiles((prev) => ({ ...prev, [seg.id]: e.target.files?.[0] ?? null }));
                    setResult(null);
                  }}
                />
                {f && <Badge variant="secondary">{f.name}</Badge>}
              </div>
            </li>
          );
        })}
      </ul>

      {error && <ErrorBlock message={error} />}
      {result && (
        <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm">
          <p className="font-medium">
            Período IEB cargado: {result.totalRows} filas
            {result.anomalyCount ? ` · ${result.anomalyCount} para revisar en Control` : ''}
          </p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {result.results.map((r) => (
              <li key={r.segment}>
                <span className="font-medium text-foreground">{r.segment}</span>:{' '}
                {r.skipped
                  ? 'no subido'
                  : r.empty
                    ? r.error ?? 'vacío (0 filas)'
                    : `${r.rowCount} filas (${r.filename})${r.duplicates ? ` · ${r.duplicates} ya estaban` : ''}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? 'Importando período…' : 'Importar segmentos IEB'}
      </Button>
    </div>
  );
}
