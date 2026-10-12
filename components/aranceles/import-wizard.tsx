'use client';

import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConflictList } from '@/components/aranceles/conflict-list';
import { ErrorBlock, inputClass, readJson } from '@/components/aranceles/shared';
import { FIELD_LABELS, REQUIRED_FIELDS } from '@/lib/aranceles/aliases';
import type { DedupConflict } from '@/lib/aranceles/dedup';
import { formatMoney, formatNumber } from '@/lib/aranceles/format';
import type { CanonicalField, ColumnMapping, NormalizedRow } from '@/lib/aranceles/types';

type ParseResponse = {
  filename: string;
  sheetName: string;
  headers: string[];
  totalRows: number;
  previewRows: Record<string, unknown>[];
  suggestedMapping: ColumnMapping;
  sampleNormalized: NormalizedRow[];
  sampleErrors: { index: number; message: string }[];
  sampleMissingFees?: number;
  detectedFormat?: string;
  formatLabel?: string;
  suggestedAlycName?: string;
  empty?: boolean;
};

type CommitResponse = {
  rowCount: number;
  duplicates: number;
  repeatedInFile: number;
  conflicts: DedupConflict[];
  conflictCount: number;
  errorCount: number;
  anomalyCount: number;
  scheduleCount: number;
  missingFeeCount: number;
  empty?: boolean;
  errors?: { index: number; message: string }[];
};

const FIELD_OPTIONS = Object.entries(FIELD_LABELS) as [CanonicalField, string][];

export function ImportWizard({ alycs, onImported }: { alycs: string[]; onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [alycName, setAlycName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CommitResponse | null>(null);

  const mappedRequired = useMemo(() => {
    const values = new Set(Object.values(mapping));
    return REQUIRED_FIELDS.every((f) => values.has(f));
  }, [mapping]);

  const onFile = useCallback(async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setSuccess(null);
    setError(null);
    if (!f) return;
    setParsing(true);
    try {
      const form = new FormData();
      form.set('file', f);
      const res = await fetch('/api/aranceles/import/parse', { method: 'POST', body: form });
      const json = await readJson<ParseResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo leer el Excel.');
      setParsed(json);
      setMapping(json.suggestedMapping);
      if (json.suggestedAlycName) setAlycName((prev) => prev || json.suggestedAlycName || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el archivo');
    } finally {
      setParsing(false);
    }
  }, []);

  const updateMapping = (header: string, field: CanonicalField) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (field !== 'ignore') {
        for (const [h, f] of Object.entries(next)) {
          if (f === field && h !== header) next[h] = 'ignore';
        }
      }
      next[header] = field;
      return next;
    });
  };

  const commit = async () => {
    if (!file || !parsed) return;
    setCommitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (!alycName.trim()) throw new Error('Escribí el nombre de la ALYC.');
      if (!mappedRequired) throw new Error('Mapeá Cliente y Fecha antes de confirmar.');
      const form = new FormData();
      form.set('file', file);
      form.set('mapping', JSON.stringify(mapping));
      form.set('alycName', alycName.trim());
      const res = await fetch('/api/aranceles/import/commit', { method: 'POST', body: form });
      const json = await readJson<CommitResponse>(res);
      if (!res.ok) {
        const first = json.errors?.[0];
        throw new Error((json.error ?? 'Error al importar') + (first ? ` Ej.: fila ${first.index}: ${first.message}` : ''));
      }
      setSuccess(json);
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al importar');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
      >
        <p className="font-medium">Arrastrá un Excel o hacé clic</p>
        <p className="text-sm text-muted-foreground">GMA, IEB o cualquier planilla con cliente, fecha y arancel</p>
        <input
          type="file"
          accept=".xlsx,.xls,.xlsm"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        {file && <Badge variant="secondary">{file.name}</Badge>}
      </label>
      {parsing && <p className="text-sm text-muted-foreground animate-pulse">Leyendo planilla…</p>}
      {error && <ErrorBlock message={error} />}

      {success && (
        <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm">
          <p className="font-medium">Importación lista</p>
          <p className="text-muted-foreground">
            {success.empty
              ? 'El archivo estaba vacío.'
              : `Se guardaron ${success.rowCount} operaciones nuevas` +
                (success.duplicates ? ` · ${success.duplicates} ya estaban en el historial (no se duplicaron)` : '') +
                (success.repeatedInFile ? ` · ${success.repeatedInFile} líneas repetidas dentro del archivo` : '') +
                (success.errorCount ? ` · ${success.errorCount} omitidas por datos inválidos` : '') +
                (success.missingFeeCount ? ` · ${success.missingFeeCount} sin arancel informado` : '') +
                (success.anomalyCount ? ` · ${success.anomalyCount} para revisar en Control` : '') +
                '.'}
          </p>
        </div>
      )}
      {success && success.conflictCount > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {success.conflictCount} operaciones no se importaron: su n° ya estaba cargado con otros datos
            {success.conflictCount > success.conflicts.length ? ` (se muestran ${success.conflicts.length})` : ''}.
          </p>
          <ConflictList conflicts={success.conflicts} />
        </div>
      )}

      {parsed && parsed.empty && (
        <p className="text-sm text-muted-foreground">El archivo no tiene filas (es normal en algunos segmentos IEB).</p>
      )}

      {parsed && !parsed.empty && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mapeo de columnas</h3>
              <span className="text-xs text-muted-foreground">
                Hoja «{parsed.sheetName}» · {formatNumber(parsed.totalRows)} filas
              </span>
            </div>
            {parsed.formatLabel && <Badge variant="secondary">{parsed.formatLabel}</Badge>}
            <p className="text-sm text-muted-foreground">
              Obligatorio: <strong>Cliente</strong> y <strong>Fecha</strong>. Si falta el arancel, la fila se importa igual y
              aparece en Control.
              {parsed.sampleMissingFees ? ` En la muestra hay ${parsed.sampleMissingFees} fila(s) sin arancel.` : ''}
            </p>
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-card">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="p-2 text-left font-medium">Columna Excel</th>
                    <th className="p-2 text-left font-medium">Campo</th>
                    <th className="p-2 text-left font-medium">Ejemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((header) => (
                    <tr key={header} className="border-b border-border/50">
                      <td className="p-2 font-medium">{header}</td>
                      <td className="p-2">
                        <select
                          className={`${inputClass} w-48`}
                          value={mapping[header] ?? 'ignore'}
                          onChange={(e) => updateMapping(header, e.target.value as CanonicalField)}
                        >
                          {FIELD_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                              {REQUIRED_FIELDS.includes(value) ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="max-w-[16rem] truncate p-2 text-muted-foreground">
                        {String(parsed.previewRows[0]?.[header] ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappedRequired && (
              <p className="text-sm text-amber-700">Falta mapear alguna columna obligatoria (Cliente, Fecha).</p>
            )}
          </section>

          {parsed.sampleNormalized.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Vista previa normalizada</h3>
              <ul className="space-y-1 text-sm">
                {parsed.sampleNormalized.slice(0, 5).map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3">
                    <span>{r.client}</span>
                    <span className="text-muted-foreground">{r.date}</span>
                    <span className="font-medium tabular-nums">{formatMoney(r.commission, r.currency)}</span>
                    {r.instrument && <span className="text-muted-foreground">{r.instrument}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              ALYC
              <input
                className={`${inputClass} w-64`}
                list="aranceles-alycs"
                placeholder="Ej. GMA, IEB, Balanz…"
                value={alycName}
                onChange={(e) => setAlycName(e.target.value)}
              />
              <datalist id="aranceles-alycs">
                {alycs.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <Button disabled={committing || !mappedRequired} onClick={() => void commit()}>
              {committing ? 'Importando…' : 'Confirmar importación'}
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
