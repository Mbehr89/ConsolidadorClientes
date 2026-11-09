import type { MappingCuentasStore } from '@/lib/config-store/types';
import type { Position } from '@/lib/schema';

/** Nombres iniciales. El catálogo real se administra en Mapping cuentas y puede crecer. */
export const GRUPOS_ASESOR = ['Grupo Familia', 'Martin/Mariano', 'Oficina Vieja'] as const;
export type GrupoAsesor = string;

/** Valor del filtro para cuentas sin grupo asesor asignado. */
export const SIN_GRUPO_ASESOR = '__sin_grupo_asesor__';

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const MAX_GRUPO = 80;

/** Nombre usable: sin espacios de más, con alguna letra o número. */
export function cleanGrupoAsesorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s || s.length > MAX_GRUPO || !/[0-9a-z]/i.test(s)) return null;
  return s;
}

/**
 * Devuelve el nombre ya cargado que coincide (mayúsculas, acentos, espacios).
 * "familia" sigue siendo Grupo Familia cuando ese nombre está en el catálogo.
 */
export function normalizeGrupoAsesor(raw: unknown, catalog: readonly string[] = GRUPOS_ASESOR): string | null {
  const cleaned = cleanGrupoAsesorName(raw);
  if (!cleaned) return null;
  const folded = fold(cleaned);
  if (folded === 'familia') {
    const familia = catalog.find((g) => fold(g) === fold('Grupo Familia'));
    if (familia) return familia;
  }
  return catalog.find((g) => fold(g) === folded) ?? null;
}

/** Si no está en el catálogo, el nombre limpio es un grupo nuevo. */
export function adoptGrupoAsesor(
  raw: unknown,
  catalog: readonly string[]
): { name: string; isNew: boolean } | null {
  const cleaned = cleanGrupoAsesorName(raw);
  if (!cleaned) return null;
  const known = normalizeGrupoAsesor(cleaned, catalog);
  if (known) return { name: known, isNew: false };
  return { name: cleaned, isNew: true };
}

/** Suma al catálogo los nombres que todavía no están, sin duplicar variantes. */
export function mergeGruposAsesor(
  catalog: readonly string[],
  incoming: readonly unknown[]
): { grupos: string[]; added: string[] } {
  const grupos = [...catalog];
  const added: string[] = [];
  for (const raw of incoming) {
    const adopted = adoptGrupoAsesor(raw, grupos);
    if (!adopted?.isNew) continue;
    grupos.push(adopted.name);
    added.push(adopted.name);
  }
  return { grupos, added };
}

export function cuentaKey(broker: string, cuenta: string): string {
  return `${broker}::${cuenta}`;
}

/** `${broker}::${cuenta}` → grupo asesor, a partir del mapping persistido. */
export function buildGrupoAsesorByCuenta(
  store: MappingCuentasStore | null,
  catalog: readonly string[] = GRUPOS_ASESOR
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!store) return out;
  for (const [broker, cuentas] of Object.entries(store)) {
    for (const [cuenta, value] of Object.entries(cuentas ?? {})) {
      if (typeof value === 'string') continue;
      const g = normalizeGrupoAsesor(value.grupo_asesor, catalog);
      if (g) out[cuentaKey(broker, cuenta)] = g;
    }
  }
  return out;
}

export function grupoAsesorDePosicion(
  byCuenta: Record<string, string>,
  p: Pick<Position, 'broker' | 'cuenta'>
): string | null {
  return byCuenta[cuentaKey(p.broker, p.cuenta)] ?? null;
}

/** `filter` es 'all', SIN_GRUPO_ASESOR o un nombre de grupo. */
export function matchesGrupoAsesor(grupo: string | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === SIN_GRUPO_ASESOR) return grupo == null;
  return grupo === filter;
}

/** Un cliente entra en el grupo si alguna de sus cuentas pertenece a él. */
export function clienteMatchesGrupoAsesor(
  cliente: { grupos_asesor: string[] } | undefined,
  filter: string
): boolean {
  if (filter === 'all') return true;
  if (!cliente) return false;
  if (filter === SIN_GRUPO_ASESOR) return cliente.grupos_asesor.length === 0;
  return cliente.grupos_asesor.includes(filter);
}
