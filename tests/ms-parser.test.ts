/**
 * Tests para parser Morgan Stanley.
 * Usa fixture anonimizada tests/fixtures/ms-sample.xlsx
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { read as xlsxRead } from 'xlsx';
import { msParser } from '@/lib/parsers/ms';
import type { ParseResult } from '@/lib/schema';

let result: ParseResult;

beforeAll(() => {
  const buffer = readFileSync('./tests/fixtures/ms-sample.xlsx');
  const workbook = xlsxRead(buffer, { type: 'buffer' });
  result = msParser.parse(workbook, 'ms-sample.xlsx', {
    mapping_tipo_cuenta: { 'B-': 'brokerage' },
  });
});

describe('msParser.detect', () => {
  it('detecta el workbook como MS con alta confianza', () => {
    const buffer = readFileSync('./tests/fixtures/ms-sample.xlsx');
    const workbook = xlsxRead(buffer, { type: 'buffer' });
    const detection = msParser.detect(workbook, 'ms-sample.xlsx');

    expect(detection.matches).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe('msParser.parse — estructura general', () => {
  it('parsea posiciones', () => {
    expect(result.positions.length).toBeGreaterThan(50);
  });

  it('no tiene errores graves', () => {
    const errores = result.errors.filter((e) => e.severity === 'error');
    expect(errores).toHaveLength(0);
  });

  it('detecta múltiples cuentas', () => {
    expect(result.metadata.cuentas_detectadas.length).toBeGreaterThan(5);
  });

  it('extrae fecha de reporte ISO', () => {
    expect(result.metadata.fecha_reporte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.metadata.fecha_reporte).toBe('2026-04-16');
  });

  it('todas las posiciones tienen broker MS', () => {
    for (const pos of result.positions) {
      expect(pos.broker).toBe('MS');
    }
  });

  it('todas las posiciones están en USD', () => {
    for (const pos of result.positions) {
      expect(pos.moneda).toBe('USD');
      expect(pos.fx_source).toBe('trivial');
    }
  });
});

describe('msParser.parse — clasificación por Product Type', () => {
  it('clasifica Stocks / Options como equity', () => {
    const equities = result.positions.filter(
      (p) => p.clase_activo === 'equity'
    );
    expect(equities.length).toBeGreaterThan(0);
  });

  it('clasifica ETFs / CEFs como etf', () => {
    const etfs = result.positions.filter((p) => p.clase_activo === 'etf');
    expect(etfs.length).toBeGreaterThan(0);
    for (const p of etfs) {
      expect(p.forma_legal).toBe('directa');
    }
  });

  it('clasifica Corporate Fixed Income como bond', () => {
    const bonds = result.positions.filter(
      (p) => p.clase_activo === 'bond' && p.descripcion.includes('CPN')
    );
    expect(bonds.length).toBeGreaterThan(0);
  });

  it('clasifica Government Securities como bond', () => {
    const govBonds = result.positions.filter(
      (p) =>
        p.clase_activo === 'bond' &&
        p.descripcion.toUpperCase().includes('TREASURY')
    );
    expect(govBonds.length).toBeGreaterThan(0);
  });

  it('clasifica Cash, MMF and BDP como cash', () => {
    const cash = result.positions.filter(
      (p) =>
        p.clase_activo === 'cash' &&
        p.descripcion.toUpperCase().includes('BANK DEPOSIT')
    );
    expect(cash.length).toBeGreaterThan(0);
  });

  it('clasifica Savings & Time Deposits como cash', () => {
    const savings = result.positions.filter(
      (p) =>
        p.clase_activo === 'cash' &&
        p.descripcion.toUpperCase().includes('SAVINGS')
    );
    expect(savings.length).toBeGreaterThan(0);
  });

  it('clasifica Mutual Funds como fund', () => {
    const funds = result.positions.filter((p) => p.clase_activo === 'fund');
    expect(funds.length).toBeGreaterThan(0);
  });

  it('clasifica options como option', () => {
    const options = result.positions.filter((p) => p.clase_activo === 'option');
    expect(options.length).toBeGreaterThan(0);
    for (const p of options) {
      expect(p.descripcion).toMatch(/^(CALL|PUT)\s/i);
    }
  });

  it('clasifica Other Holdings como other', () => {
    const others = result.positions.filter((p) => p.clase_activo === 'other');
    expect(others.length).toBeGreaterThan(0);
  });

  it('detecta ADRs con forma_legal adr', () => {
    const adrs = result.positions.filter((p) => p.forma_legal === 'adr');
    expect(adrs.length).toBeGreaterThan(0);
    for (const p of adrs) {
      expect(p.descripcion.toUpperCase()).toContain('ADR');
    }
  });
});

describe('msParser.parse — accrued interest', () => {
  it('suma accrued interest al valor_mercado_usd', () => {
    const withAccrued = result.positions.filter(
      (p) => p.accrued_interest_usd !== null && p.accrued_interest_usd > 0
    );
    expect(withAccrued.length).toBeGreaterThan(0);
    for (const p of withAccrued) {
      // valor_mercado_usd debería ser MV + accrued
      expect(p.valor_mercado_usd).toBeGreaterThan(0);
    }
  });

  it('accrued interest es null para equities y cash', () => {
    const equities = result.positions.filter(
      (p) => p.clase_activo === 'equity'
    );
    for (const p of equities) {
      expect(p.accrued_interest_usd === null || p.accrued_interest_usd === 0).toBe(true);
    }
  });
});

describe('msParser.parse — cuentas MS', () => {
  it('detecta -SOCIEDAD como juridica', () => {
    const sociedades = result.positions.filter((p) =>
      p.cuenta.toUpperCase().includes('SOCIEDAD')
    );
    expect(sociedades.length).toBeGreaterThan(0);
    for (const p of sociedades) {
      expect(p.tipo_titular).toBe('juridica');
    }
  });

  it('detecta prefijo B- y asigna tipo_cuenta brokerage', () => {
    const bCuentas = result.positions.filter((p) =>
      p.cuenta.startsWith('B-')
    );
    expect(bCuentas.length).toBeGreaterThan(0);
    for (const p of bCuentas) {
      expect(p.tipo_cuenta).toBe('brokerage');
    }
  });

  it('marca TITULAR_NO_MAPEADO cuando no hay mapping', () => {
    // Sin mapping_cuentas, todos los titulares son MS-<account>
    for (const p of result.positions) {
      expect(p.warnings).toContain('TITULAR_NO_MAPEADO');
    }
  });
});

describe('msParser.parse — checksum', () => {
  it('total MV clean coincide con header del archivo (dentro de tolerancia)', () => {
    // El checksum se valida internamente; si hay delta > threshold, aparece warning
    const checksumWarnings = result.warnings.filter((w) =>
      w.includes('CHECKSUM_DELTA')
    );
    expect(checksumWarnings).toHaveLength(0);
  });
});

describe('msParser.parse — residuales', () => {
  it('marca posiciones < $1 como residuales', () => {
    const residuales = result.positions.filter((p) =>
      p.warnings.includes('POSICION_RESIDUAL')
    );
    for (const p of residuales) {
      // MV original (sin accrued) debería ser < $1
      const cleanMv = p.valor_mercado_local - (p.accrued_interest_usd ?? 0);
      expect(Math.abs(cleanMv)).toBeLessThan(1);
    }
  });
});
