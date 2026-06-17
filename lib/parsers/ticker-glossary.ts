import { ClaseActivoSchema, WARNING_CODES, type Position } from '@/lib/schema';
import { isMoneyMarketSubtipo } from '@/lib/cash-buckets';
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
  let clase = pos.clase_activo;
  if (parsed.success) clase = parsed.data;
  else if (meta.es_etf) clase = 'etf';
  if (meta.moneda_subtipo && isMoneyMarketSubtipo(meta.moneda_subtipo)) {
    clase = 'cash';
  }
  let next: Position = { ...pos, warnings: stripTickerNoConfirmado(pos.warnings), clase_activo: clase };
  if (meta.pais != null && meta.pais.length === 2) {
    next = { ...next, pais_emisor: meta.pais };
  }
  if (meta.moneda_subtipo) {
    next = { ...next, moneda_subtipo: meta.moneda_subtipo };
    if (meta.moneda_subtipo === 'money_market_ars') next = { ...next, moneda: 'ARS' };
    if (meta.moneda_subtipo === 'money_market_usd') next = { ...next, moneda: 'USD' };
  }
  return next;
}
