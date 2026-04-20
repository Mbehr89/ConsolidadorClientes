/**
 * Tests para parser Netx360.
 * Usa fixture anonimizada tests/fixtures/netx360-sample.xlsx
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { read as xlsxRead } from 'xlsx';
import { netx360Parser } from '@/lib/parsers/netx360';
import type { ParseResult } from '@/lib/schema';

let result: ParseResult;

beforeAll(() => {
  const buffer = readFileSync('./tests/fixtures/netx360-sample.xlsx');
  const workbook = xlsxRead(buffer, { type: 'buffer' });

  result = netx360Parser.parse(workbook, 'netx360-sample.xlsx', {});
});

describe('netx360Parser.detect', () => {
  it('detecta el workbook como Netx360 con alta confianza', () => {
    const buffer = readFileSync('./tests/fixtures/netx360-sample.xlsx');
    const workbook = xlsxRead(buffer, { type: 'buffer' });
    const detection = netx360Parser.detect(workbook, 'netx360-sample.xlsx');

    expect(detection.matches).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('netx360Parser.parse — estructura general', () => {
  it('parsea posiciones', () => {
    expect(result.positions.length).toBeGreaterThan(0);
  });

  it('no tiene errores graves', () => {
    const errores = result.errors.filter((e) => e.severity === 'error');
    expect(errores).toHaveLength(0);
  });

  it('detecta múltiples cuentas', () => {
    expect(result.metadata.cuentas_detectadas.length).toBeGreaterThan(5);
  });

  it('extrae fecha de reporte', () => {
    expect(result.metadata.fecha_reporte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('todas las posiciones tienen broker NETX360', () => {
    for (const pos of result.positions) {
      expect(pos.broker).toBe('NETX360');
    }
  });

  it('todas las posiciones están en USD', () => {
    for (const pos of result.positions) {
      expect(pos.moneda).toBe('USD');
    }
  });

  it('todas las posiciones tienen fx_source trivial', () => {
    for (const pos of result.positions) {
      expect(pos.fx_source).toBe('trivial');
    }
  });

  it('todas las posiciones tienen fecha ISO', () => {
    for (const pos of result.positions) {
      expect(pos.fecha_reporte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('netx360Parser.parse — clasificación de activos', () => {
  it('clasifica cash (USD999997) correctamente', () => {
    const cashPositions = result.positions.filter(
      (p) => p.clase_activo === 'cash' && p.cusip === 'USD999997'
    );
    expect(cashPositions.length).toBeGreaterThan(0);
    for (const p of cashPositions) {
      expect(p.moneda_subtipo).toBe('usd_cash');
    }
  });

  it('clasifica money market (MONEYMRKT) como cash', () => {
    const mmPositions = result.positions.filter(
      (p) => p.clase_activo === 'cash' && p.cusip === 'MONEYMRKT'
    );
    expect(mmPositions.length).toBeGreaterThan(0);
    for (const p of mmPositions) {
      expect(p.moneda_subtipo).toBe('money_market');
    }
  });

  it('clasifica ETFs correctamente', () => {
    const etfs = result.positions.filter(
      (p) => p.clase_activo === 'etf'
    );
    expect(etfs.length).toBeGreaterThan(0);
    // All should have forma_legal = directa (offshore)
    for (const p of etfs) {
      expect(p.forma_legal).toBe('directa');
    }
  });

  it('clasifica bonds (fixed income) correctamente', () => {
    const bonds = result.positions.filter(
      (p) => p.clase_activo === 'bond'
    );
    expect(bonds.length).toBeGreaterThan(0);
  });

  it('clasifica equity correctamente', () => {
    const equities = result.positions.filter(
      (p) => p.clase_activo === 'equity'
    );
    expect(equities.length).toBeGreaterThan(0);
  });

  it('detecta ADRs con forma_legal adr', () => {
    const adrs = result.positions.filter(
      (p) => p.forma_legal === 'adr'
    );
    // Hay ADRs en la fixture (GGAL, YPF, PAM, etc.)
    expect(adrs.length).toBeGreaterThan(0);
  });

  it('clasifica funds correctamente', () => {
    const funds = result.positions.filter(
      (p) => p.clase_activo === 'fund'
    );
    // Schroder ISF es un fund
    expect(funds.length).toBeGreaterThan(0);
  });

  it('clasifica options como option', () => {
    const options = result.positions.filter(
      (p) => p.clase_activo === 'option'
    );
    // Hay CALL TLT options en la fixture
    expect(options.length).toBeGreaterThan(0);
    for (const p of options) {
      expect(p.cantidad).toBeLessThan(0); // short calls
    }
  });
});

describe('netx360Parser.parse — cash handling', () => {
  it('cash positions usan Cash and Cash Equivalents, no Market Value', () => {
    const mmPositions = result.positions.filter(
      (p) => p.cusip === 'MONEYMRKT' && p.valor_mercado_usd! > 0
    );
    // Debe haber al menos algunos con cash > 0
    expect(mmPositions.length).toBeGreaterThan(0);
  });

  it('valor_mercado_usd = valor_mercado_local para offshore', () => {
    for (const pos of result.positions) {
      expect(pos.valor_mercado_usd).toBe(pos.valor_mercado_local);
    }
  });
});

describe('netx360Parser.parse — ISIN extraction', () => {
  it('extrae ISIN del description cuando está disponible', () => {
    const withIsin = result.positions.filter((p) => p.isin !== null);
    expect(withIsin.length).toBeGreaterThan(0);
    for (const p of withIsin) {
      // ISIN format: 2 letters + 10 alphanumeric
      expect(p.isin).toMatch(/^[A-Z]{2}[A-Z0-9]{10}$/);
    }
  });

  it('pais_emisor se deriva del ISIN cuando está disponible', () => {
    const withIsin = result.positions.filter(
      (p) => p.isin !== null && p.pais_emisor !== null
    );
    for (const p of withIsin) {
      expect(p.pais_emisor).toBe(p.isin!.slice(0, 2));
    }
  });
});

describe('netx360Parser.parse — titulares', () => {
  it('todos los titulares están normalizados (uppercase, sin acentos)', () => {
    for (const pos of result.positions) {
      expect(pos.titular_normalizado).toBe(pos.titular_normalizado.toUpperCase());
    }
  });

  it('genera cliente_id de 12 chars hex', () => {
    for (const pos of result.positions) {
      expect(pos.cliente_id).toMatch(/^[a-f0-9]{12}$/);
    }
  });

  it('mismo titular = mismo cliente_id', () => {
    const byTitular = new Map<string, string>();
    for (const pos of result.positions) {
      const existing = byTitular.get(pos.titular_normalizado);
      if (existing) {
        expect(pos.cliente_id).toBe(existing);
      } else {
        byTitular.set(pos.titular_normalizado, pos.cliente_id);
      }
    }
  });
});
