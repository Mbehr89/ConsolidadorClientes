import type { AliasStore } from '@/lib/config-store/types';

/** Convierte el store persistido al mapa que usan los parsers (variante → canónico). */
export function aliasStoreToRecord(store: AliasStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of store) {
    out[e.variante] = e.canonico;
  }
  return out;
}
