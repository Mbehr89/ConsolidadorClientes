import { describe, it, expect } from 'vitest';
import { detectAliasCandidates, aliasPairKey } from '@/lib/analysis/detect-alias-candidates';
import type { Position } from '@/lib/schema';

function makePos(titularNorm: string, broker: Position['broker']): Position {
  return {
    cliente_id: 'x',
    titular: titularNorm,
    titular_normalizado: titularNorm,
    tipo_titular: 'persona',
    grupo_id: null,
    cuenta: '1',
    broker,
    tipo_cuenta: null,
    productor: null,
    fecha_reporte: '2026-01-01',
    ticker: null,
    isin: null,
    cusip: null,
    descripcion: '',
    clase_activo: 'equity',
    forma_legal: null,
    pais_emisor: null,
    cantidad: 1,
    cantidad_disponible: null,
    cantidad_no_disponible: null,
    precio_mercado: 1,
    moneda: 'USD',
    moneda_subtipo: null,
    valor_mercado_local: 1,
    valor_mercado_usd: 1,
    accrued_interest_usd: null,
    fx_source: 'trivial',
    pct_portfolio: null,
    source_file: 'f',
    source_row: 0,
    warnings: [],
  };
}

describe('detectAliasCandidates', () => {
  it('excluye pares ya unificados por alias', () => {
    const positions = [
      makePos('MARTIN GONI', 'NETX360'),
      makePos('GONI MARTIN', 'GMA'),
    ];
    const aliases: Record<string, string> = {
      'GONI MARTIN': 'MARTIN GONI',
      'MARTIN GONI': 'MARTIN GONI',
    };
    const out = detectAliasCandidates(positions, aliases, new Set(), 0.88);
    expect(out.length).toBe(0);
  });

  it('sin posiciones no hay candidatos', () => {
    expect(detectAliasCandidates([], {}, new Set()).length).toBe(0);
  });

  it('aliasPairKey es estable', () => {
    expect(aliasPairKey('A', 'B')).toBe(aliasPairKey('B', 'A'));
  });
});
