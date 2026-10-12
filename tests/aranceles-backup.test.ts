import { describe, expect, it } from 'vitest';
import { backupFilename, describeHistoryContents, exportFilename, summarizeBackup } from '@/lib/aranceles/backup';
import { applyImport, emptyHistory } from '@/lib/aranceles/history';
import type { NormalizedRow } from '@/lib/aranceles/types';

function row(op: string, date: string): NormalizedRow {
  return {
    client: 'Cliente',
    clientExternalId: '1',
    accountOfficer: null,
    date,
    settlementDate: null,
    instrument: 'AL30',
    operation: 'COMPRA',
    quantity: 1,
    amount: 100,
    netAmount: null,
    commission: 1,
    commissionPct: 1,
    currency: 'ARS',
    opNumber: op,
    feeStatus: 'ok',
    isMinFee: false,
    alyc: null,
  };
}

describe('aranceles: backup', () => {
  it('nombre con la última operación (de cualquier ALYC) y la cantidad', () => {
    let h = applyImport(emptyHistory(), {
      alyc: 'GMA',
      filename: 'a.xlsx',
      rows: [row('1', '2026-08-03'), row('2', '2026-09-15')],
    }).history;
    h = applyImport(h, { alyc: 'IEB', filename: 'b.xlsx', rows: [row('9', '2026-09-30')], segment: 'acdi' }).history;

    const s = summarizeBackup(h);
    expect(s.filename).toBe('Backup aranceles - 2026-09-30 - 3 operaciones.json');
    expect(s.lastOperationDate).toBe('2026-09-30');
    expect(s.lastOperationByAlyc).toEqual([
      { alyc: 'GMA', date: '2026-09-15', operations: 2 },
      { alyc: 'IEB', date: '2026-09-30', operations: 1 },
    ]);
  });

  it('historial vacío y singular', () => {
    expect(summarizeBackup(emptyHistory()).filename).toBe('Backup aranceles - sin operaciones - 0 operaciones.json');
    expect(backupFilename('2026-01-02', 1)).toBe('Backup aranceles - 2026-01-02 - 1 operación.json');
  });

  it('exportar: explica que el JSON trae operaciones y configuración, pero no el mapping de cuentas', () => {
    const h = applyImport(emptyHistory(), { alyc: 'GMA', filename: 'a.xlsx', rows: [row('1', '2026-09-01')] }).history;
    expect(exportFilename('2026-09-01', 1)).toBe('Historial aranceles - 2026-09-01 - 1 operación.json');
    const c = describeHistoryContents(h);
    expect(c.included.map((i) => i.label)).toEqual([
      'Operaciones con arancel',
      'Importaciones',
      'Tarifas',
      'Configuración del neto',
    ]);
    expect(c.included[0]!.detail).toContain('1 operación de todas las ALYC');
    expect(c.included[1]!.detail).toContain('1 archivo importado');
    expect(c.notIncluded.map((i) => i.label)).toEqual(['Mapping de cuentas']);
  });
});
