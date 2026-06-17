import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPortfolioWorkbookBuffer } from '@/lib/export/portfolio-exceljs';
import type { Position } from '@/lib/schema';

function samplePosition(overrides: Partial<Position> = {}): Position {
  return {
    broker: 'IEB',
    cuenta: '123',
    titular: 'Cliente Test',
    cliente_id: 'c1',
    fecha_reporte: '2026-06-01',
    ticker: 'GGAL',
    isin: null,
    cusip: null,
    descripcion: 'Grupo Financiero Galicia',
    clase_activo: 'equity',
    forma_legal: 'directa',
    pais_emisor: 'AR',
    moneda: 'ARS',
    moneda_subtipo: null,
    cantidad: 100,
    precio_mercado: 5000,
    valor_mercado_local: 500000,
    valor_mercado_usd: 400,
    accrued_interest_usd: null,
    pct_portfolio: 0.5,
    fx_source: 'manual',
    warnings: [],
    source_file: 'ieb.xlsx',
    source_row: 2,
  ...overrides,
  };
}

function formulaOf(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v != null && typeof v === 'object' && 'formula' in v) {
    return String((v as { formula: string }).formula);
  }
  return null;
}

describe('portfolio excel export formulas', () => {
  it('writes linked formulas for TC, valuations and weights', async () => {
    const positions = [
      samplePosition(),
      samplePosition({
        ticker: 'YPFD',
        moneda: 'USD',
        precio_mercado: 12,
        cantidad: 50,
        valor_mercado_usd: 600,
        valor_mercado_local: 0,
      }),
    ];
    const buf = await buildPortfolioWorkbookBuffer(positions, 1200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const portfolio = wb.getWorksheet('Portfolio_Consolidado');
    expect(portfolio).toBeTruthy();
    expect(portfolio!.getCell('I2').value).toBe(1200);

    const f6 = formulaOf(portfolio!.getCell('F6'));
    expect(f6).toContain('G6');
    expect(f6).toContain('Portfolio_Consolidado');
    expect(f6).toContain('I$2');

    const i6 = formulaOf(portfolio!.getCell('I6'));
    expect(i6).toBe('E6*G6');

    const j6 = formulaOf(portfolio!.getCell('J6'));
    expect(j6).toMatch(/I6\/\$I\$/);

    const totalI = formulaOf(portfolio!.getCell('I8'));
    expect(totalI).toMatch(/^SUM\(I6:I7\)$/);

    const byClass = wb.getWorksheet('Por_Asset_Class');
    expect(formulaOf(byClass!.getCell('B4'))).toContain('C4');
    expect(formulaOf(byClass!.getCell('D4'))).toMatch(/C4\/\$C\$/);

    const base = wb.getWorksheet('Base_Consolidada');
    const qArs = formulaOf(base!.getCell('Q2'));
    const rArs = formulaOf(base!.getCell('R2'));
    expect(qArs).toContain('M2="ARS"');
    expect(qArs).toContain('O2*P2');
    expect(rArs).toContain('M2="USD"');
    expect(rArs).toMatch(/O2\*P2.*\/.*I\$2/);

    const qUsd = formulaOf(base!.getCell('Q3'));
    const rUsd = formulaOf(base!.getCell('R3'));
    expect(base!.getCell('M3').value).toBe('USD');
    expect(rUsd).toContain('O3*P3');
    expect(qUsd).toMatch(/O3\*P3.*\*.*I\$2/);

    const flujo = wb.getWorksheet('Flujo_Bonos');
    if (flujo && formulaOf(flujo.getCell('J10'))) {
      expect(formulaOf(flujo.getCell('J10'))).toMatch(/E\d+\*F\d+\/100/);
      expect(formulaOf(flujo.getCell('L10'))).toMatch(/J\d+\+K\d+/);
    }
  });
});
