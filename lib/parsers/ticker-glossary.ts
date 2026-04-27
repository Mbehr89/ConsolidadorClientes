import { ClaseActivoSchema, WARNING_CODES, type Position } from '@/lib/schema';
import type { TickerMeta } from './types';

/**
 * `mapTickersMetadataForParser` indexa con `k.toUpperCase()`. El símbolo del
 * archivo puede venir en distinto casing — si no normalizamos, el lookup falla
 * y el glosario "confirmado" no aplica a la fila.
 */
export function lookupTickerMeta(
  store: Record<string, TickerMeta> | undefined,
  symbol: string | null | undefined
): TickerMeta | undefined {
  if (!store || symbol == null) return undefined;
  const t = String(symbol).trim();
  if (t === '' || t === 'CASH') return undefined;
  return store[t.toUpperCase()];
}

function stripTickerNoConfirmado(warnings: string[]): string[] {
  return warnings.filter(
    (w) => w !== WARNING_CODES.TICKER_NO_CONFIRMADO && !w.startsWith(`${WARNING_CODES.TICKER_NO_CONFIRMADO}:`)
  );
}

/**
 * Si el glosario tiene el ticker **confirmado**, la clase y el país de ese
 * registro son la fuente de verdad para `clase_activo` y `pais_emisor`.
 * (Antes casi solo se usaba `es_etf` y a veces `pais`, y el casing rompía el match.)
 */
export function applyConfirmedGlossaryToPosition(pos: Position, meta: TickerMeta | undefined): Position {
  if (!meta?.confirmado) return pos;
  if (pos.clase_activo === 'cash' && (pos.ticker === 'CASH' || !pos.ticker)) {
    return pos;
  }
  const parsed = ClaseActivoSchema.safeParse(meta.clase);
  let next: Position = { ...pos, warnings: stripTickerNoConfirmado(pos.warnings) };
  if (parsed.success) {
    next = { ...next, clase_activo: parsed.data };
  } else if (meta.es_etf) {
    next = { ...next, clase_activo: 'etf' };
  }
  if (meta.pais != null && meta.pais.length === 2) {
    next = { ...next, pais_emisor: meta.pais };
  }
  return next;
}
