import type { TickersMetadataStore } from '@/lib/config-store/types';
import type { TickerMeta as ParserTickerMeta } from '@/lib/parsers/types';

/** Convierte el store persistido al shape que esperan los parsers (sin campos extra). */
export function mapTickersMetadataForParser(
  store: TickersMetadataStore
): Record<string, ParserTickerMeta> {
  const out: Record<string, ParserTickerMeta> = {};
  for (const [k, v] of Object.entries(store)) {
    const key = k.toUpperCase();
    out[key] = {
      pais: v.pais,
      clase: v.clase,
      es_etf: v.es_etf,
      nombre: v.nombre,
      confirmado: v.confirmado,
    };
  }
  return out;
}
