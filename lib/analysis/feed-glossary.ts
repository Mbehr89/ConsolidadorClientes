import type { Position } from '@/lib/schema';
import type { TickersMetadataStore, TickersPendientesStore, TickerPendiente } from '@/lib/config-store/types';

/**
 * Alimenta el glosario de tickers pendientes a partir de posiciones parseadas.
 * - Si el ticker ya está en metadata → no hace nada.
 * - Si ya está en pendientes → incrementa ocurrencias y agrega broker si es nuevo.
 * - Si no está en ninguno → crea entrada nueva con clase sugerida del parser.
 */
export function feedGlossary(
  positions: Position[],
  metadata: TickersMetadataStore,
  pendientes: TickersPendientesStore
): TickersPendientesStore {
  const out: TickersPendientesStore = { ...pendientes };
  const metaByKey = new Map(
    Object.entries(metadata).map(([k, v]) => [k.toUpperCase(), v] as const)
  );

  for (const p of positions) {
    const raw = p.ticker?.trim();
    if (!raw) continue;
    if (p.clase_activo === 'cash') continue;
    if (raw.toUpperCase() === 'CASH') continue;

    const key = raw.toUpperCase();
    const meta = metaByKey.get(key);
    // Si ya está confirmado en metadata, no va a pendientes.
    // Si existe pero NO está confirmado, debe aparecer en pendientes para revisión.
    if (meta?.confirmado) continue;

    const existing = out[key];
    if (existing) {
      const brokers = existing.brokers_detectados.includes(p.broker)
        ? existing.brokers_detectados
        : [...existing.brokers_detectados, p.broker];

      const mergedDesc =
        p.descripcion.length > existing.descripcion_muestra.length
          ? p.descripcion.slice(0, 500)
          : existing.descripcion_muestra;

      const next: TickerPendiente = {
        ...existing,
        ocurrencias: existing.ocurrencias + 1,
        brokers_detectados: brokers,
        descripcion_muestra: mergedDesc,
      };
      out[key] = next;
    } else {
      out[key] = {
        ticker: key,
        descripcion_muestra: p.descripcion.slice(0, 500),
        brokers_detectados: [p.broker],
        clase_sugerida: p.clase_activo,
        pais_sugerido: p.pais_emisor ?? null,
        primera_aparicion: new Date().toISOString(),
        ocurrencias: 1,
        estado: 'pendiente',
      };
    }
  }

  return out;
}
