import { describe, expect, it } from 'vitest';
import {
  SIN_GRUPO_ASESOR,
  buildGrupoAsesorByCuenta,
  clienteMatchesGrupoAsesor,
  grupoAsesorDePosicion,
  matchesGrupoAsesor,
  normalizeGrupoAsesor,
} from '@/lib/grupo-asesor';
import type { MappingCuentasStore } from '@/lib/config-store/types';

describe('grupo asesor', () => {
  it('normaliza variantes de escritura', () => {
    expect(normalizeGrupoAsesor('Grupo Familia')).toBe('Grupo Familia');
    expect(normalizeGrupoAsesor('familia')).toBe('Grupo Familia');
    expect(normalizeGrupoAsesor('martín / mariano')).toBe('Martin/Mariano');
    expect(normalizeGrupoAsesor('OFICINA VIEJA')).toBe('Oficina Vieja');
    expect(normalizeGrupoAsesor('Otro')).toBeNull();
    expect(normalizeGrupoAsesor('')).toBeNull();
    expect(normalizeGrupoAsesor(null)).toBeNull();
  });

  it('arma el mapa por broker + cuenta desde el mapping', () => {
    const store: MappingCuentasStore = {
      GMA: {
        '2445': { titular: 'A', grupo_asesor: 'Martin/Mariano' },
        '3088': { titular: 'B', grupo_asesor: null },
        '9999': 'Titular viejo sin objeto',
      },
      MS: { 'MFR - 3815': { titular: 'C', grupo_asesor: 'oficina vieja' } },
    };
    const map = buildGrupoAsesorByCuenta(store);
    expect(map).toEqual({ 'GMA::2445': 'Martin/Mariano', 'MS::MFR - 3815': 'Oficina Vieja' });
    expect(grupoAsesorDePosicion(map, { broker: 'GMA', cuenta: '2445' })).toBe('Martin/Mariano');
    expect(grupoAsesorDePosicion(map, { broker: 'IEB', cuenta: '2445' })).toBeNull();
  });

  it('filtra por grupo, sin grupo o todos', () => {
    expect(matchesGrupoAsesor('Grupo Familia', 'all')).toBe(true);
    expect(matchesGrupoAsesor('Grupo Familia', 'Grupo Familia')).toBe(true);
    expect(matchesGrupoAsesor('Grupo Familia', 'Oficina Vieja')).toBe(false);
    expect(matchesGrupoAsesor(null, SIN_GRUPO_ASESOR)).toBe(true);
    expect(matchesGrupoAsesor('Grupo Familia', SIN_GRUPO_ASESOR)).toBe(false);

    const mixto = { grupos_asesor: ['Grupo Familia', 'Oficina Vieja'] };
    expect(clienteMatchesGrupoAsesor(mixto, 'Oficina Vieja')).toBe(true);
    expect(clienteMatchesGrupoAsesor(mixto, SIN_GRUPO_ASESOR)).toBe(false);
    expect(clienteMatchesGrupoAsesor({ grupos_asesor: [] }, SIN_GRUPO_ASESOR)).toBe(true);
  });
});
