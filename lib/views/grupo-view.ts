import type { GruposStore } from '@/lib/config-store/types';
import type { ClienteSummary } from './cliente-summary';

export interface GrupoListRow {
  grupo_id: string;
  nombre: string;
  aum_usd: number;
  miembros: { cliente_id: string; titular: string; aum_usd: number }[];
}

/** Filas de grupo + clientes que no están en ningún grupo (vista consolidada). */
export function buildGrupoListRows(
  grupos: GruposStore,
  clients: ClienteSummary[]
): { grupos: GrupoListRow[]; sinGrupo: ClienteSummary[] } {
  const byId = new Map(clients.map((c) => [c.cliente_id, c]));
  const assigned = new Set<string>();
  const rows: GrupoListRow[] = [];

  for (const g of grupos) {
    let aum = 0;
    const miembros: GrupoListRow['miembros'] = [];
    for (const cid of g.cliente_ids) {
      const c = byId.get(cid);
      if (c) {
        assigned.add(cid);
        aum += c.aum_usd;
        miembros.push({ cliente_id: cid, titular: c.titular, aum_usd: c.aum_usd });
      } else {
        miembros.push({ cliente_id: cid, titular: cid, aum_usd: 0 });
      }
    }
    rows.push({ grupo_id: g.id, nombre: g.nombre, aum_usd: aum, miembros });
  }
  rows.sort((a, b) => b.aum_usd - a.aum_usd);
  const sinGrupo = clients.filter((c) => !assigned.has(c.cliente_id));
  return { grupos: rows, sinGrupo };
}
