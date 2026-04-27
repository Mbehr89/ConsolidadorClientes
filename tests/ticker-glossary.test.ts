import { describe, expect, it } from 'vitest';
import { applyConfirmedGlossaryToPosition, lookupTickerMeta } from '@/lib/parsers/ticker-glossary';
import type { TickerMeta } from '@/lib/parsers/types';
import type { Position } from '@/lib/schema';

const base: Position = {
  cliente_id: 'c1',
  titular: 'T',
  titular_normalizado: 't',
  tipo_titular: 'persona',
  grupo_id: null,
  broker: 'IEB',
  cuenta: '1',
  tipo_cuenta: null,
  productor: null,
  fecha_reporte: '2026-01-01',
  ticker: 'GGAL',
  isin: null,
  cusip: null,
  descripcion: 'X',
  clase_activo: 'equity',
  forma_legal: 'directa',
  pais_emisor: null,
  cantidad: 1,
  cantidad_disponible: null,
  cantidad_no_disponible: null,
  precio_mercado: 1,
  moneda: 'ARS',
  moneda_subtipo: null,
  valor_mercado_local: 1,
  valor_mercado_usd: 1,
  accrued_interest_usd: null,
  fx_source: 'manual',
  pct_portfolio: null,
  source_file: 'f.xlsx',
  source_row: 0,
  warnings: ['TICKER_NO_CONFIRMADO'],
};

describe('lookupTickerMeta', () => {
  it('resolves case-insensitive keys (store keys are uppercased like mapTickersMetadataForParser)', () => {
    const store: Record<string, TickerMeta> = {
      GGAL: { pais: 'AR', clase: 'equity', es_etf: false, nombre: 'n', confirmado: true },
    };
    expect(lookupTickerMeta(store, 'ggal')?.clase).toBe('equity');
  });
});

describe('applyConfirmedGlossaryToPosition', () => {
  it('applies confirmado clase and pais', () => {
    const meta: TickerMeta = {
      pais: 'US',
      clase: 'etf',
      es_etf: true,
      nombre: 'F',
      confirmado: true,
    };
    const out = applyConfirmedGlossaryToPosition(base, meta);
    expect(out.clase_activo).toBe('etf');
    expect(out.pais_emisor).toBe('US');
    expect(out.warnings).not.toContain('TICKER_NO_CONFIRMADO');
  });
});
