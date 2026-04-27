import type { BondFlowRegime, BondPaymentEvent } from './types';
import { normalizeBondTicker } from './ticker-normalize';

export type { BondFlowRegime } from './types';

/**
 * Régimen activo al consultar (ley general) vs. Régimen AFIP. No confundir con "normal" = sin etiqueta.
 */
export type BondFlowViewMode = 'normal' | 'afip';

/**
 * Serie con tratamiento AFIP en la celda de bono (p. ej. `BPOC7 @AFIP` vs `BPOC7`):
 * conviven en calendario con el mismo VN lógico pero flujos y vencimientos distintos (suele vencer antes la variante @AFIP).
 */
export function isAfipSeriesFromAssetString(raw: string): boolean {
  const s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/@\s*AFIP\b/i.test(s)) return true;
  if (/\(AFIP\)/i.test(s)) return true;
  if (/-\s*AFIP\b/i.test(s)) return true;
  if (/\bAFIP\s*$/i.test(s.trim())) return true;
  return false;
}

/**
 * Si para un mismo `normalizeBondTicker` hay al menos una fila de serie @AFIP, el resto de filas sin columna
 * de régimen se marcan `normal` (ley general) o `afip` según el texto de `asset`.
 */
export function applyRegimeFromAssetSeriesSiblings(events: BondPaymentEvent[]): void {
  const byNorm = new Map<string, BondPaymentEvent[]>();
  for (const e of events) {
    const k = normalizeBondTicker(e.asset);
    if (!k) continue;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k)!.push(e);
  }
  for (const group of byNorm.values()) {
    const hasAfipLeg = group.some(
      (e) => e.flowRegime === 'afip' || isAfipSeriesFromAssetString(e.asset)
    );
    if (!hasAfipLeg) continue;
    for (const e of group) {
      if (e.flowRegime != null) continue;
      e.flowRegime = isAfipSeriesFromAssetString(e.asset) ? 'afip' : 'normal';
    }
  }
}

/**
 * Normaliza texto de celda/JSON a régimen, sin inferencias heurísticas.
 */
export function parseFlowRegimeValue(raw: unknown): BondFlowRegime | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const n = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bafip\b|regimen afip|ley 23\.?760/i.test(n)) {
    return 'afip';
  }
  if (/\bgeneral\b|\bgral\b|ley 15|inscripto|no afip|gananc ley com/i.test(n)) {
    return 'normal';
  }
  if (n === 'afip' || n.startsWith('afip')) return 'afip';
  if (n === 'normal' || n === 'general' || n === 'ley general') return 'normal';
  return undefined;
}

/**
 * Tickers (normalizados) que en el calendario tienen al menos un evento `afip` y al menos uno `normal`.
 */
export function tickersWithBothRegimes(events: BondPaymentEvent[]): string[] {
  const af = new Set<string>();
  const na = new Set<string>();
  for (const e of events) {
    if (!e.flowRegime) continue;
    const k = normalizeBondTicker(e.asset);
    if (!k) continue;
    if (e.flowRegime === 'afip') af.add(k);
    if (e.flowRegime === 'normal') na.add(k);
  }
  return [...af].filter((t) => na.has(t)).sort();
}

export function portfolioTickersWithDualRegime(
  events: BondPaymentEvent[],
  portfolioNormalizedTickers: Set<string>
): string[] {
  const dual = new Set(tickersWithBothRegimes(events));
  return [...dual].filter((t) => portfolioNormalizedTickers.has(t)).sort();
}

/**
 * Mantiene un solo brazo (ley general o AFIP) en bonos con ambas series, para no duplicar TIR / flujos.
 * Bonos con una sola serie: se incluyen tal cual. Si faltan etiquetas en un bono con doble fila, no entra a `tickersWithBothRegimes` y podría duplicar (corregir CSV u orden 1ª/2ª fila).
 */
export function filterBondEventsByViewMode(
  events: BondPaymentEvent[],
  mode: BondFlowViewMode
): BondPaymentEvent[] {
  const dual = new Set(tickersWithBothRegimes(events));
  const want: BondFlowRegime = mode === 'afip' ? 'afip' : 'normal';
  return events.filter((e) => {
    const k = normalizeBondTicker(e.asset);
    if (!k) return true;
    if (!dual.has(k)) return true;
    return e.flowRegime === want;
  });
}
