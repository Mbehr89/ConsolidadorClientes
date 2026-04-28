'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { read as xlsxRead, utils as xlsxUtils, type WorkBook } from 'xlsx';
import { detectBroker, parseWithBroker } from '@/lib/parsers';
import type { BrokerCode, Position, ParseResult } from '@/lib/schema';
import type { ParseOptions } from '@/lib/parsers/types';
import type {
  AliasStore,
  MappingCuentaValue,
  MappingCuentasStore,
  TickersMetadataStore,
  TickersPendientesStore,
  GruposStore,
} from '@/lib/config-store/types';
import { applyGrupoIdsToPositions } from '@/lib/analysis/grupos';
import { feedGlossary } from '@/lib/analysis/feed-glossary';
import { mapTickersMetadataForParser } from '@/lib/analysis/ticker-meta-parser';
import { aliasStoreToRecord } from '@/lib/analysis/alias-utils';
import { detectAliasCandidates } from '@/lib/analysis/detect-alias-candidates';
import { loadIgnoredPairKeys } from '@/lib/analysis/ignored-alias-pairs';

// ─── Types ──────────────────────────────────────────────

export interface FileEntry {
  filename: string;
  broker: BrokerCode | null;
  autoDetected: boolean;
  confidence: number;
  reason: string;
  workbook: WorkBook;
  result: ParseResult | null;
  status: 'detected' | 'parsing' | 'done' | 'error';
  needsFx: boolean;
  needsFecha: boolean;
}

export interface ConsolidationState {
  files: FileEntry[];
  allPositions: Position[];
  /** Grupos económicos cargados del store (KV); se aplican a posiciones como `grupo_id`). */
  grupos: GruposStore;
  fxManual: number | null;
  /** FX ARS/USD sugerido automáticamente a partir de los archivos cargados. */
  fxSuggested: number | null;
  fechaIeb: string | null;
  isProcessing: boolean;
  hasParsed: boolean;
  /** Sugerencias fuzzy de alias tras el último parseo (respeta ignorados en localStorage). */
  aliasSuggestionsCount: number;
}

interface ConsolidationContextValue {
  state: ConsolidationState;
  addFiles: (files: File[]) => Promise<void>;
  setBrokerManual: (index: number, broker: BrokerCode) => void;
  removeFile: (index: number) => void;
  setFxManual: (fx: number) => void;
  setFechaIeb: (fecha: string) => void;
  parseAll: (aliasesOverride?: AliasStore) => Promise<void>;
  /** Recarga grupos desde el servidor y re-asigna `grupo_id` sin re-parsear Excel. */
  refreshGruposAssignment: () => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE: ConsolidationState = {
  files: [],
  allPositions: [],
  grupos: [],
  fxManual: null,
  fxSuggested: null,
  fechaIeb: null,
  isProcessing: false,
  hasParsed: false,
  aliasSuggestionsCount: 0,
};

function parseNumericLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:[^\d]|$))/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function extractFxCandidatesIeb(workbook: WorkBook): number[] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = xlsxUtils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const header = rows[0]?.map((c) => String(c ?? '').trim()) ?? [];
  const tcIdx = header.indexOf('TipoCambio');
  if (tcIdx < 0) return [];

  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const tc = parseNumericLike(rows[i]?.[tcIdx]);
    if (!tc) continue;
    if (tc > 100 && tc < 5000) out.push(tc);
  }
  return out;
}

function extractFxCandidatesGma(workbook: WorkBook): number[] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = xlsxUtils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const comitente = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(comitente)) continue; // fila data

    const valuacionEmision = parseNumericLike(row[6]); // col GMA
    const valuacionLocal = parseNumericLike(row[11]); // col GMA
    const fxRatio =
      valuacionEmision && valuacionLocal ? valuacionLocal / valuacionEmision : null;
    if (fxRatio && fxRatio > 100 && fxRatio < 5000) out.push(fxRatio);

    const cotizLocal = parseNumericLike(row[8]);
    if (cotizLocal && cotizLocal > 100 && cotizLocal < 5000) out.push(cotizLocal);
  }
  return out;
}

function suggestFxFromFiles(files: FileEntry[]): number | null {
  const candidates: number[] = [];
  for (const f of files) {
    if (f.status === 'error' || !f.workbook) continue;
    if (f.broker === 'IEB') candidates.push(...extractFxCandidatesIeb(f.workbook));
    if (f.broker === 'GMA') candidates.push(...extractFxCandidatesGma(f.workbook));
  }
  const m = median(candidates);
  if (!m) return null;
  return Math.round(m * 100) / 100;
}

function buildCuentaFieldMap(
  source: Record<string, MappingCuentaValue> | undefined,
  field: 'titular' | 'productor' | 'advisor'
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  for (const [cuenta, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      if (field === 'titular' && value.trim()) out[cuenta] = value.trim();
      continue;
    }
    const raw = value[field];
    if (typeof raw === 'string' && raw.trim()) out[cuenta] = raw.trim();
  }
  return out;
}

// ─── Context ────────────────────────────────────────────

const ConsolidationContext = createContext<ConsolidationContextValue | null>(null);

export function useConsolidation() {
  const ctx = useContext(ConsolidationContext);
  if (!ctx) throw new Error('useConsolidation must be used within ConsolidationProvider');
  return ctx;
}

// ─── Provider ───────────────────────────────────────────

export function ConsolidationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsolidationState>(INITIAL_STATE);
  const stateRef = useRef<ConsolidationState>(INITIAL_STATE);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const addFiles = useCallback(async (fileList: File[]) => {
    setState((prev) => ({ ...prev, isProcessing: true }));

    const newEntries: FileEntry[] = [];

    for (const file of fileList) {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = xlsxRead(buffer, { type: 'array' });
        const detection = detectBroker(workbook, file.name);

        newEntries.push({
          filename: file.name,
          broker: detection.parser?.code ?? null,
          autoDetected: detection.result?.matches ?? false,
          confidence: detection.result?.confidence ?? 0,
          reason: detection.result?.reason ?? 'No se pudo detectar el broker',
          workbook,
          result: null,
          status: 'detected',
          needsFx: detection.parser?.code === 'IEB' || detection.parser?.code === 'GMA',
          needsFecha: detection.parser?.code === 'IEB',
        });
      } catch (err) {
        newEntries.push({
          filename: file.name,
          broker: null,
          autoDetected: false,
          confidence: 0,
          reason: `Error leyendo archivo: ${err instanceof Error ? err.message : String(err)}`,
          workbook: null as unknown as WorkBook,
          result: null,
          status: 'error',
          needsFx: false,
          needsFecha: false,
        });
      }
    }

    setState((prev) => {
      const files = [...prev.files, ...newEntries];
      const fxSuggested = suggestFxFromFiles(files);
      return {
        ...prev,
        files,
        fxSuggested,
        isProcessing: false,
      };
    });
  }, []);

  const setBrokerManual = useCallback((index: number, broker: BrokerCode) => {
    setState((prev) => {
      const files = [...prev.files];
      const entry = files[index];
      if (entry) {
        files[index] = {
          ...entry,
          broker,
          autoDetected: false,
          needsFx: broker === 'IEB' || broker === 'GMA',
          needsFecha: broker === 'IEB',
        };
      }
      return { ...prev, files, fxSuggested: suggestFxFromFiles(files) };
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setState((prev) => {
      const files = prev.files.filter((_, i) => i !== index);
      return { ...prev, files, fxSuggested: suggestFxFromFiles(files) };
    });
  }, []);

  const setFxManual = useCallback((fx: number) => {
    setState((prev) => ({ ...prev, fxManual: fx }));
  }, []);

  const setFechaIeb = useCallback((fecha: string) => {
    setState((prev) => ({ ...prev, fechaIeb: fecha }));
  }, []);

  const parseAll = useCallback(async (aliasesOverride?: AliasStore) => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    const snapshot = stateRef.current;

    let mappingStore: MappingCuentasStore | null = null;
    let tickersMeta: TickersMetadataStore = {};
    let tickersPend: TickersPendientesStore = {};
    let aliasesStore: AliasStore = [];
    let gruposStore: GruposStore = [];
    let clienteAdvisorsStore: Record<string, string> = {};
    try {
      const [mRes, mmRes, pRes, aRes, gRes, caRes] = await Promise.all([
        fetch('/api/config/mapping-cuentas'),
        fetch('/api/config/tickers-metadata'),
        fetch('/api/config/tickers-pendientes'),
        fetch('/api/config/aliases'),
        fetch('/api/config/grupos'),
        fetch('/api/config/cliente-advisors'),
      ]);
      if (mRes.ok) mappingStore = (await mRes.json()) as MappingCuentasStore;
      if (mmRes.ok) tickersMeta = (await mmRes.json()) as TickersMetadataStore;
      if (pRes.ok) tickersPend = (await pRes.json()) as TickersPendientesStore;
      if (aRes.ok) aliasesStore = (await aRes.json()) as AliasStore;
      if (gRes.ok) gruposStore = (await gRes.json()) as GruposStore;
      if (caRes.ok) clienteAdvisorsStore = (await caRes.json()) as Record<string, string>;
    } catch {
      /* fetch opcional */
    }

    const effectiveAliasesStore = aliasesOverride ?? aliasesStore;
    const parserTickerMeta = mapTickersMetadataForParser(tickersMeta);
    const aliasRecord = aliasStoreToRecord(effectiveAliasesStore);

    const files = snapshot.files.map((entry) => {
      if (!entry.broker || entry.status === 'error') return entry;

      const opts: ParseOptions = {};
      const fxEffective = snapshot.fxManual ?? snapshot.fxSuggested ?? undefined;
      opts.tickers_metadata = parserTickerMeta;
      opts.aliases = aliasRecord;
      if (fxEffective) opts.fx_manual = fxEffective;
      if (snapshot.fechaIeb && entry.broker === 'IEB') {
        opts.fecha_reporte_override = snapshot.fechaIeb;
      }

      if (mappingStore && entry.broker === 'GMA') {
        opts.mapping_cuentas = buildCuentaFieldMap(mappingStore.GMA, 'titular');
        opts.mapping_productor = buildCuentaFieldMap(mappingStore.GMA, 'productor');
        opts.mapping_advisor = buildCuentaFieldMap(mappingStore.GMA, 'advisor');
      }
      if (mappingStore && entry.broker === 'MS') {
        opts.mapping_cuentas = buildCuentaFieldMap(mappingStore.MS, 'titular');
        opts.mapping_productor = buildCuentaFieldMap(mappingStore.MS, 'productor');
        opts.mapping_advisor = buildCuentaFieldMap(mappingStore.MS, 'advisor');
      }

      try {
        const result = parseWithBroker(entry.broker, entry.workbook, entry.filename, opts);
        return { ...entry, result, status: 'done' as const };
      } catch (err) {
        return {
          ...entry,
          status: 'error' as const,
          reason: `Error en parseo: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    const raw = files
      .filter((f) => f.result)
      .flatMap((f) => f.result!.positions);
    const allPositions = applyGrupoIdsToPositions(raw, gruposStore);

    const ignored = loadIgnoredPairKeys();
    const aliasSuggestionsCount = detectAliasCandidates(
      allPositions,
      aliasRecord,
      ignored
    ).length;

    setState((prev) => ({
      ...prev,
      files,
      allPositions,
      grupos: gruposStore,
      hasParsed: allPositions.length > 0,
      isProcessing: false,
      aliasSuggestionsCount,
    }));

    if (typeof window !== 'undefined') {
      const mappingSnapshot = allPositions.map((p) => ({
        broker: p.broker,
        cuenta: p.cuenta,
        titular: p.titular,
        productor: p.productor ?? null,
      }));
      window.localStorage.setItem('mapping_detected_accounts_cache', JSON.stringify(mappingSnapshot));
    }

    try {
      const nextPendientes = feedGlossary(allPositions, tickersMeta, tickersPend);
      const res = await fetch('/api/config/tickers-pendientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPendientes),
      });
      if (res.ok && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('glosario-pending-updated'));
      }
    } catch {
      /* no bloquear UI si falla persistencia del glosario */
    }

    try {
      if (mappingStore) {
        const advisorByCuentaGma = buildCuentaFieldMap(mappingStore.GMA, 'advisor');
        const advisorByCuentaMs = buildCuentaFieldMap(mappingStore.MS, 'advisor');
        const nextAdvisors = { ...clienteAdvisorsStore };

        for (const p of allPositions) {
          const byCuenta =
            p.broker === 'GMA'
              ? advisorByCuentaGma[p.cuenta]
              : p.broker === 'MS'
                ? advisorByCuentaMs[p.cuenta]
                : undefined;
          if (byCuenta && byCuenta.trim()) {
            nextAdvisors[p.cliente_id] = byCuenta.trim();
          }
        }

        await fetch('/api/config/cliente-advisors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextAdvisors),
        });
      }
    } catch {
      /* no bloquear parse si falla persistencia advisors */
    }
  }, []);

  const refreshGruposAssignment = useCallback(async () => {
    try {
      const res = await fetch('/api/config/grupos');
      if (!res.ok) return;
      const grupos: GruposStore = await res.json();
      setState((prev) => {
        if (prev.allPositions.length === 0) {
          return { ...prev, grupos };
        }
        const stripped = prev.allPositions.map((p) => ({ ...p, grupo_id: null }));
        return {
          ...prev,
          grupos,
          allPositions: applyGrupoIdsToPositions(stripped, grupos),
        };
      });
    } catch {
      /* noop */
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return (
    <ConsolidationContext.Provider
      value={{
        state,
        addFiles,
        setBrokerManual,
        removeFile,
        setFxManual,
        setFechaIeb,
        parseAll,
        refreshGruposAssignment,
        reset,
      }}
    >
      {children}
    </ConsolidationContext.Provider>
  );
}
