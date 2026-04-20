import type { Position } from '@/lib/schema';
import type { Grupo, GruposStore } from '@/lib/config-store/types';

/** Mapa cliente_id → grupo_id (primer grupo que contenga al cliente). */
export function buildClienteToGrupoMap(grupos: GruposStore): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of grupos) {
    for (const cid of g.cliente_ids) {
      if (!m.has(cid)) m.set(cid, g.id);
    }
  }
  return m;
}

/** Asigna grupo_id post-parseo según la config de grupos. */
export function applyGrupoIdsToPositions(positions: Position[], grupos: GruposStore): Position[] {
  const map = buildClienteToGrupoMap(grupos);
  return positions.map((p) => ({
    ...p,
    grupo_id: map.get(p.cliente_id) ?? null,
  }));
}

/** Devuelve el grupo en el que ya está el cliente (si existe), excluyendo `exceptGroupId`. */
export function findGrupoContainingCliente(
  clienteId: string,
  grupos: GruposStore,
  exceptGroupId?: string | null
): Grupo | null {
  for (const g of grupos) {
    if (exceptGroupId && g.id === exceptGroupId) continue;
    if (g.cliente_ids.includes(clienteId)) return g;
  }
  return null;
}
