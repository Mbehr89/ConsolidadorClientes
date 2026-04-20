'use client';

import { useState, useCallback } from 'react';
import { read as xlsxRead, type WorkBook } from 'xlsx';
import { detectBroker, parseWithBroker } from '@/lib/parsers';
import type { BrokerCode, Position, ParseResult } from '@/lib/schema';
import type { ParseOptions } from '@/lib/parsers/types';

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
  fxManual: number | null;
  fechaIeb: string | null;
  isProcessing: boolean;
}

export function useConsolidation() {
  const [state, setState] = useState<ConsolidationState>({
    files: [],
    allPositions: [],
    fxManual: null,
    fechaIeb: null,
    isProcessing: false,
  });

  const addFiles = useCallback(async (fileList: File[]) => {
    setState((prev) => ({ ...prev, isProcessing: true }));

    const newEntries: FileEntry[] = [];

    for (const file of fileList) {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = xlsxRead(buffer, { type: 'array' });

        const detection = detectBroker(workbook, file.name);

        const entry: FileEntry = {
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
        };

        newEntries.push(entry);
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

    setState((prev) => ({
      ...prev,
      files: [...prev.files, ...newEntries],
      isProcessing: false,
    }));
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
      return { ...prev, files };
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
  }, []);

  const setFxManual = useCallback((fx: number) => {
    setState((prev) => ({ ...prev, fxManual: fx }));
  }, []);

  const setFechaIeb = useCallback((fecha: string) => {
    setState((prev) => ({ ...prev, fechaIeb: fecha }));
  }, []);

  const parseAll = useCallback(() => {
    setState((prev) => {
      const files = prev.files.map((entry) => {
        if (!entry.broker || entry.status === 'error') return entry;

        const opts: ParseOptions = {};
        if (prev.fxManual) opts.fx_manual = prev.fxManual;
        if (prev.fechaIeb && entry.broker === 'IEB') {
          opts.fecha_reporte_override = prev.fechaIeb;
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

      const allPositions = files
        .filter((f) => f.result)
        .flatMap((f) => f.result!.positions);

      return { ...prev, files, allPositions };
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      files: [],
      allPositions: [],
      fxManual: null,
      fechaIeb: null,
      isProcessing: false,
    });
  }, []);

  return {
    state,
    addFiles,
    setBrokerManual,
    removeFile,
    setFxManual,
    setFechaIeb,
    parseAll,
    reset,
  };
}
