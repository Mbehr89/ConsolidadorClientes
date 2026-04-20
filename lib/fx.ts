/**
 * FX & date utilities.
 * Centraliza parseo de fechas (formato varía por broker) y conversión monetaria.
 */
import type { BrokerCode } from './schema';
import { BROKERS } from './brokers';

// ─── Date parsing ──────────────────────────────────────

/**
 * Parsea una fecha según el formato del broker y devuelve ISO 8601 (YYYY-MM-DD).
 * @throws si el formato no matchea o la fecha es inválida.
 */
export function parseBrokerDate(
  raw: string | Date | number,
  broker: BrokerCode
): string {
  const format = BROKERS[broker].date_format;

  // Excel native Timestamp (Netx360)
  if (format === 'native') {
    if (raw instanceof Date) {
      return formatIso(raw);
    }
    if (typeof raw === 'number') {
      // Excel serial date → JS Date
      const d = excelSerialToDate(raw);
      return formatIso(d);
    }
    throw new Error(`Expected Date or number for ${broker}, got ${typeof raw}`);
  }

  // Manual (IEB) — se espera que venga ya en ISO
  if (format === 'manual') {
    const s = String(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`IEB fecha manual debe ser ISO 8601, got: ${s}`);
  }

  const s = String(raw).trim();

  if (format === 'MM/DD/YYYY') {
    // MS: "04/16/2026"
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) throw new Error(`Expected MM/DD/YYYY, got: ${s}`);
    const [, month, day, year] = m;
    return `${year}-${month}-${day}`;
  }

  if (format === 'DD/MM/YYYY') {
    // GMA: "15/04/2026"
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) throw new Error(`Expected DD/MM/YYYY, got: ${s}`);
    const [, day, month, year] = m;
    return `${year}-${month}-${day}`;
  }

  throw new Error(`Unknown date format for broker ${broker}: ${format}`);
}

/**
 * Extrae fecha del header textual de MS.
 * Input: "Holdings for All Accounts as of 04/16/2026 12:01 PM ET"
 * Output: "2026-04-16"
 */
export function extractMsReportDate(headerText: string): string | null {
  const m = headerText.match(/as of (\d{2}\/\d{2}\/\d{4})/i);
  if (!m) return null;
  return parseBrokerDate(m[1]!, 'MS');
}

/**
 * Extrae fecha del header textual de Netx360.
 * Input: "Input Criteria : ... Snapshot Date equals  15-Apr-2026"
 * Output: "2026-04-15"
 */
export function extractNetx360ReportDate(headerText: string): string | null {
  const m = headerText.match(/Snapshot Date equals\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const [, dayStr, monthStr, yearStr] = m;
  const monthMap: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const month = monthMap[monthStr!];
  if (!month) return null;
  const day = dayStr!.padStart(2, '0');
  return `${yearStr}-${month}-${day}`;
}

// ─── FX conversion ─────────────────────────────────────

/**
 * Convierte un monto en moneda local a USD.
 * Para brokers offshore (MS, Netx360), amount ya está en USD → trivial.
 * Para brokers locales (IEB, GMA), se divide por fx_rate (ARS/USD).
 */
export function toUsd(
  amount_local: number,
  broker: BrokerCode,
  fx_rate?: number | null
): { usd: number; source: 'trivial' | 'broker' | 'manual' } {
  if (BROKERS[broker].tipo === 'offshore') {
    return { usd: amount_local, source: 'trivial' };
  }

  if (fx_rate != null && fx_rate > 0) {
    return { usd: amount_local / fx_rate, source: 'broker' };
  }

  // No debería llegar acá — el pipeline debe proveer fx_manual
  return { usd: 0, source: 'manual' };
}

// ─── Numeric parsing helpers ───────────────────────────

/**
 * Parsea un valor que puede ser número, string con formato, "-", N/A, null.
 * Devuelve number o null.
 */
export function parseNumeric(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  const s = String(raw).trim();
  if (s === '' || s === '-' || s === 'N/A' || s === 'n/a') return null;

  // Handle AR format "1.234,56" → "1234.56" and "1,234.56" → "1234.56"
  // Heuristic: if last separator is comma and ≤2 digits after → comma is decimal
  const cleaned = s.replace(/[^0-9.,\-]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized: string;
  if (lastComma > lastDot) {
    // "1.234,56" → comma is decimal separator (AR format)
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // "1,234.56" or no comma → dot is decimal separator (US format)
    normalized = cleaned.replace(/,/g, '');
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

/**
 * Parsea un porcentaje que puede venir como "10.84", "0,51%", "10.84%", etc.
 * Devuelve el valor como fracción (0-100 range preservado, no dividido por 100).
 */
export function parsePercentage(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace('%', '');
  return parseNumeric(s);
}

// ─── Internal helpers ──────────────────────────────────

function formatIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function excelSerialToDate(serial: number): Date {
  // Excel serial date: days since 1900-01-01 (with the 1900 leap year bug)
  const utcDays = serial - 25569; // offset to Unix epoch
  const utcMs = utcDays * 86400000;
  return new Date(utcMs);
}
