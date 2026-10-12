import type { MappingCuentasStore } from '@/lib/config-store/types';
import type { Position } from '@/lib/schema';

/** Segmentación de cuentas por grupo asesor (se asigna en Mapping cuentas). */
export const GRUPOS_ASESOR = ['Grupo Familia', 'Martin/Mariano', 'Oficina Vieja'] as const;
export type GrupoAsesor = (typeof GRUPOS_ASESOR)[number];

/** Valor del filtro para cuentas sin grupo asesor asignado. */
export const SIN_GRUPO_ASESOR = '__sin_grupo_asesor__';

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const BY_FOLDED = new Map<string, GrupoAsesor>(GRUPOS_ASESOR.map((g) => [fold(g), g]));
BY_FOLDED.set('familia', 'Grupo Familia');

/** Acepta variantes de mayúsculas, acentos y espacios (ej. "martín / mariano", "familia"). */
export function normalizeGrupoAsesor(raw: unknown): GrupoAsesor | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return BY_FOLDED.get(fold(raw)) ?? null;
}

export function cuentaKey(broker: string, cuenta: string): string {
  return `${broker}::${cuenta}`;
}

/** `${broker}::${cuenta}` → grupo asesor, a partir del mapping persistido. */
export function buildGrupoAsesorByCuenta(store: MappingCuentasStore | null): Record<string, GrupoAsesor> {
  const out: Record<string, GrupoAsesor> = {};
  if (!store) return out;
  for (const [broker, cuentas] of Object.entries(store)) {
    for (const [cuenta, value] of Object.entries(cuentas ?? {})) {
      if (typeof value === 'string') continue;
      const g = normalizeGrupoAsesor(value.grupo_asesor);
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
