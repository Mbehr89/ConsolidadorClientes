'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConsolidation } from '@/lib/context/consolidation-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { cn, formatCompact } from '@/lib/utils';
import type { BrokerCode } from '@/lib/schema';
import { detectInconsistencies } from '@/lib/analysis/inconsistencies';
import type { BondFlowViewMode } from '@/lib/bonds/flow-regime';
import { ExportExcelButton } from '@/components/export-excel-button';
import { ExportPdfButton } from '@/components/export-pdf-button';

const BROKER_OPTIONS: { code: BrokerCode; label: string }[] = [
  { code: 'MS', label: 'Morgan Stanley' },
  { code: 'NETX360', label: 'Netx360 (Pershing)' },
  { code: 'IEB', label: 'IEB' },
  { code: 'GMA', label: 'GMA' },
];

export default function UploadPage() {
  const { state, addFiles, setBrokerManual, removeFile, setFxManual, setFechaIeb, parseAll, reset } = useConsolidation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const hasAutoSyncedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const [autoParseAfterDrive, setAutoParseAfterDrive] = useState(false);
  const [bondFlowViewMode, setBondFlowViewMode] = useState<BondFlowViewMode>('normal');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    if (files.length > 0) addFiles(files);
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) addFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  }, [addFiles]);

  const needsFx = state.files.some(f => f.needsFx);
  const needsFecha = state.files.some(f => f.needsFecha);
  const allDetected = state.files.length > 0 && state.files.every(f => f.broker !== null || f.status === 'error');
  const canParse = allDetected && (!needsFx || state.fxManual || state.fxSuggested) && (!needsFecha || state.fechaIeb);

  useEffect(() => {
    if (!needsFecha) return;
    if (state.fechaIeb) return;
    const today = new Date().toISOString().slice(0, 10);
    setFechaIeb(today);
  }, [needsFecha, state.fechaIeb, setFechaIeb]);

  const inconsistencyCount = useMemo(() => {
    if (!state.hasParsed || state.allPositions.length === 0) return 0;
    return detectInconsistencies(state.allPositions).length;
  }, [state.hasParsed, state.allPositions]);

  const portfolioExcelOpts = useMemo(() => {
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      layout: 'portfolio' as const,
      filename: `Portfolio_Consolidado_Master_${ymd}.xlsx`,
      fxUsdArs: state.fxManual ?? state.fxSuggested,
      bondFlowViewMode,
    };
  }, [state.fxManual, state.fxSuggested, bondFlowViewMode]);

  const syncFromDrive = useCallback(async (force = false) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncingDrive(true);
    setDriveStatus(null);
    try {
      const query = force ? '?force=1' : '';
      const res = await fetch(`/api/drive/sync${query}`, { cache: 'no-store' });
      const payload = (await res.json()) as {
        error?: string;
        totalInFolder?: number;
        files?: { id: string; name: string; modifiedTime: string | null; contentBase64: string }[];
      };
      if (!res.ok) {
        setDriveConnected(false);
        setDriveStatus(payload.error ?? 'No se pudo sincronizar con Drive.');
        return;
      }
      setDriveConnected(true);

      const allFromDrive = (payload.files ?? []).map((f) => {
        const bytes = Uint8Array.from(atob(f.contentBase64), (c) => c.charCodeAt(0));
        const ext = f.name.toLowerCase().endsWith('.xls') ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        return {
          meta: { id: f.id, name: f.name, modifiedTime: f.modifiedTime },
          file: new File([bytes], f.name, {
            type: ext,
            lastModified: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
          }),
        };
      });

      // Evita duplicados si auto-sync corre dos veces (StrictMode/dev) o si ya están cargados.
      const existingNames = new Set(state.files.map((f) => f.filename.toLowerCase()));
      const files = allFromDrive.filter((x) => !existingNames.has(x.file.name.toLowerCase()));

      if (files.length === 0) {
        const detected =
          typeof payload.totalInFolder === 'number' ? ` (${payload.totalInFolder} detectado/s)` : '';
        setDriveStatus(`Drive sincronizado${detected}. No hay archivos nuevos para importar.`);
        return;
      }

      await addFiles(files.map((x) => x.file));
      await fetch('/api/drive/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map((x) => x.meta),
        }),
      });
      setAutoParseAfterDrive(true);
      setDriveStatus(`Importación automática completada: ${files.length} archivo(s) nuevos.`);
    } catch {
      setDriveStatus('Error inesperado al sincronizar desde Google Drive.');
    } finally {
      setIsSyncingDrive(false);
      syncInFlightRef.current = false;
    }
  }, [addFiles, state.files]);

  useEffect(() => {
    if (hasAutoSyncedRef.current) return;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem('drive_auto_sync_done') === '1') {
      hasAutoSyncedRef.current = true;
      return;
    }
    hasAutoSyncedRef.current = true;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('drive_auto_sync_done', '1');
    }
    void syncFromDrive(false);
  }, [syncFromDrive]);

  useEffect(() => {
    if (!autoParseAfterDrive) return;
    if (state.isProcessing) return;

    if (canParse) {
      setDriveStatus('Drive sincronizado. Iniciando parseo automático…');
      setAutoParseAfterDrive(false);
      void parseAll()
        .then(() => {
          setDriveStatus('Drive sincronizado y parseado automáticamente.');
        })
        .catch(() => {
          setDriveStatus('Drive sincronizado, pero falló el parseo automático.');
        });
      return;
    }

    if (state.files.length > 0) {
      setDriveStatus(
        'Drive sincronizado. Falta completar datos requeridos (FX/fecha o broker) para parsear automáticamente.'
      );
      setAutoParseAfterDrive(false);
    }
  }, [autoParseAfterDrive, canParse, parseAll, state.files.length, state.isProcessing]);

  return (
    <div className="page-shell max-w-6xl">
      <div className="page-header">
        <div>
          <h2 className="page-title">Upload de tenencias</h2>
          <p className="page-subtitle">Importación automática desde Google Drive + parseo local.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isSyncingDrive}
            onClick={() => void syncFromDrive(true)}
          >
            {isSyncingDrive ? 'Sincronizando Drive…' : 'Sincronizar desde Drive'}
          </Button>
          <Badge
            variant={
              driveConnected == null ? 'secondary' : driveConnected ? 'success' : 'warning'
            }
          >
            {driveConnected == null
              ? 'Drive pendiente'
              : driveConnected
                ? 'Drive server sync'
                : 'Drive no configurado'}
          </Badge>
        </div>
      </div>
      {driveStatus && (
        <Card>
          <CardContent className="p-3">
            <p className="text-sm text-muted-foreground">{driveStatus}</p>
          </CardContent>
        </Card>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn('border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors bg-card', dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50')}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm" multiple onChange={handleFileInput} className="hidden" />
        <div className="text-4xl mb-3">📁</div>
        <p className="text-sm font-medium">Arrastrá archivos acá o hacé click para seleccionar</p>
        <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls — MS, Netx360, IEB, GMA</p>
      </div>

      {state.files.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Archivos ({state.files.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {state.files.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-4 p-3 rounded-md bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.filename}</p>
                    <p className="text-xs text-muted-foreground">{entry.reason}</p>
                  </div>
                  <select value={entry.broker ?? ''} onChange={e => setBrokerManual(idx, e.target.value as BrokerCode)} className="h-9 rounded-md border bg-background px-3 text-sm">
                    <option value="">Seleccionar broker...</option>
                    {BROKER_OPTIONS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                  </select>
                  {entry.broker && <Badge variant={entry.confidence > 0.8 ? 'success' : entry.confidence > 0.5 ? 'warning' : 'outline'}>{entry.autoDetected ? `Auto (${Math.round(entry.confidence * 100)}%)` : 'Manual'}</Badge>}
                  {entry.status === 'done' && <Badge variant="success">{entry.result?.positions.length} pos</Badge>}
                  {entry.status === 'error' && <Badge variant="destructive">Error</Badge>}
                  <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive text-lg">×</button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(needsFx || needsFecha) && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Datos adicionales</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {needsFx && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">TC ARS/USD</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="ej: 1438"
                    value={state.fxManual ?? state.fxSuggested ?? ''}
                    onChange={e => setFxManual(parseFloat(e.target.value) || 0)}
                    className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
                  />
                  {state.fxSuggested ? (
                    <div className="mt-2 flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Sugerido por archivos: <span className="font-medium text-foreground">{state.fxSuggested.toFixed(2)}</span>
                      </p>
                      {!state.fxManual && (
                        <button
                          type="button"
                          onClick={() => setFxManual(state.fxSuggested!)}
                          className="text-xs text-primary hover:underline"
                        >
                          Usar sugerido
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No se detectó FX automático en los archivos cargados.</p>
                  )}
                </div>
              )}
              {needsFecha && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Fecha reporte IEB</label>
                  <input type="date" value={state.fechaIeb ?? ''} onChange={e => setFechaIeb(e.target.value)} className="h-9 w-44 rounded-md border bg-background px-3 text-sm" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {state.files.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void parseAll()} disabled={!canParse || state.isProcessing} size="lg">
            {state.isProcessing ? 'Parseando…' : `Parsear ${state.files.length} archivo${state.files.length > 1 ? 's' : ''}`}
          </Button>
          <Button variant="outline" onClick={reset}>Limpiar todo</Button>
          {state.hasParsed && state.aliasSuggestionsCount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="warning">{state.aliasSuggestionsCount} sugerencias de alias</Badge>
              <a href="/admin/aliases" className="text-primary underline">
                Revisar en Admin → Aliases
              </a>
            </div>
          )}
        </div>
      )}

      {state.hasParsed && (
        <>
          <div className="flex flex-wrap gap-4 items-end justify-between">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1 min-w-0">
              {[
                { label: 'AUM Total (USD)', value: formatCompact(state.allPositions.reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0)) },
                { label: 'Posiciones', value: state.allPositions.length },
                { label: 'Clientes', value: new Set(state.allPositions.map(p => p.cliente_id)).size },
              ].map(({ label, value }) => (
                <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium uppercase">{label}</p><p className="text-2xl font-bold mt-1">{value}</p></CardContent></Card>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Flujo bonos (ley / AFIP)</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[148px]"
                  value={bondFlowViewMode}
                  onChange={(e) => setBondFlowViewMode(e.target.value as BondFlowViewMode)}
                  aria-label="Régimen de flujos para la hoja Flujo_Bonos del informe completo"
                >
                  <option value="normal">Ley general</option>
                  <option value="afip">Régimen AFIP</option>
                </select>
              </div>
              <ExportExcelButton positions={state.allPositions} size="sm" />
              <ExportExcelButton
                positions={state.allPositions}
                options={portfolioExcelOpts}
                label="Excel (informe completo)"
                size="sm"
              />
              <ExportPdfButton positions={state.allPositions} size="sm" />
            </div>
          </div>
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Calidad de datos</CardTitle>
              <CardDescription>
                Revisá alertas antes de exportar o presentar al cliente.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Badge variant={inconsistencyCount > 0 ? 'warning' : 'success'}>
                {inconsistencyCount} hallazgo{inconsistencyCount === 1 ? '' : 's'}
              </Badge>
              <Link href="/inconsistencias" className="text-sm text-primary font-medium hover:underline">
                Abrir panel de inconsistencias →
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
