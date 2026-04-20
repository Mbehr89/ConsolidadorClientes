import { describe, it, expect } from 'vitest';
import { feedGlossary } from '@/lib/analysis/feed-glossary';
import type { Position } from '@/lib/schema';
import type { TickersMetadataStore, TickersPendientesStore } from '@/lib/config-store/types';

function pos(p: Partial<Position> & Pick<Position, 'ticker' | 'broker' | 'clase_activo' | 'descripcion'>): Position {
  return {
    cliente_id: 'c1',
    titular: 'T',
    titular_normalizado: 't',
    tipo_titular: 'persona',
    grupo_id: null,
    cuenta: '1',
    tipo_cuenta: null,
    productor: null,
    fecha_reporte: '2026-01-01',
    isin: null,
    cusip: null,
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
    source_file: 'f.xlsx',
    source_row: 1,
    warnings: [],
    ...p,
  } as Position;
}

describe('feedGlossary', () => {
  it('omite tickers ya en metadata', () => {
    const metadata: TickersMetadataStore = {
      AAPL: {
        pais: 'US',
        clase: 'equity',
        es_etf: false,
        nombre: 'AAPL',
        confirmado: true,
        fuente: 'seed',
        confirmado_por: null,
        fecha: '2026-01-01T00:00:00.000Z',
      },
    };
    const pend: TickersPendientesStore = {};
    const out = feedGlossary(
      [pos({ ticker: 'AAPL', broker: 'MS', clase_activo: 'equity', descripcion: 'Apple' })],
      metadata,
      pend
    );
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('crea pendiente nuevo', () => {
    const out = feedGlossary(
      [pos({ ticker: 'ZZZ99', broker: 'IEB', clase_activo: 'equity', descripcion: 'Test' })],
      {},
      {}
    );
    expect(out.ZZZ99).toBeDefined();
    expect(out.ZZZ99!.ocurrencias).toBe(1);
    expect(out.ZZZ99!.brokers_detectados).toEqual(['IEB']);
  });

  it('incrementa ocurrencias y brokers', () => {
    const pend: TickersPendientesStore = {
      ZZZ99: {
        ticker: 'ZZZ99',
        descripcion_muestra: 'Test',
        brokers_detectados: ['IEB'],
        clase_sugerida: 'equity',
        pais_sugerido: null,
        primera_aparicion: '2020-01-01',
        ocurrencias: 2,
        estado: 'pendiente',
      },
    };
    const out = feedGlossary(
      [pos({ ticker: 'ZZZ99', broker: 'MS', clase_activo: 'equity', descripcion: 'Test' })],
      {},
      pend
    );
    expect(out.ZZZ99!.ocurrencias).toBe(3);
    expect(out.ZZZ99!.brokers_detectados).toContain('MS');
  });
});
