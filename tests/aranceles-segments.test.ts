import { describe, expect, it } from 'vitest';
import { buildBrokerPeriodReport } from '@/lib/aranceles/reports';
import {
  SIN_ASIGNAR,
  filterBySegment,
  joinExclusions,
  segmentBreakdowns,
  segmentCommissions,
  segmentOptions,
} from '@/lib/aranceles/segments';
import type { ArancelCommission } from '@/lib/aranceles/types';
import type { MappingCuentasStore } from '@/lib/config-store/types';

function op(id: string, alyc: string, cuenta: string | null, commission: number): ArancelCommission {
  return {
    id,
    import_id: 'imp',
    alyc,
    client: `Cliente ${id}`,
    client_key: `cliente ${id}`,
    client_external_id: cuenta,
    account_officer: null,
    trade_date: '2026-09-10',
    settlement_date: null,
    instrument: 'AL30',
    operation: 'COMPRA',
    quantity: 1,
    amount: 1000,
    commission,
    commission_pct: null,
    currency: 'ARS',
    commission_currency: 'ARS',
    commission_fx: null,
    imported_status: 'ok',
    fee_status: 'ok',
    expected_commission: null,
    op_number: id,
    segment: null,
    is_min_fee: false,
    trading_group: null,
  };
}

const mapping: MappingCuentasStore = {
  MS: {},
  NETX360: {},
  GMA: {
    '1001': { titular: 'X', productor: 'ANA', advisor: 'LUIS', grupo_asesor: 'grupo familia' },
    '1002': { titular: 'Y', productor: ' BETO ', advisor: null, grupo_asesor: 'Oficina Vieja' },
    '1003': 'Solo titular',
  },
  IEB: {
    '55001': { titular: 'Z', productor: 'ANA', advisor: 'LUIS', grupo_asesor: null },
  },
};

const rows = segmentCommissions(
  [
    op('a', 'GMA', '1001', 10),
    op('b', 'GMA', '1002', 20),
    op('c', 'GMA', '1003', 30),
    op('d', 'IEB', '55001', 40),
    op('e', 'IEB', '1001', 50),
  ],
  mapping
);

describe('aranceles: manager / advisor / grupo asesor desde el mapping', () => {
  it('cruza ESCO con cuentas GMA e IEB con IEB', () => {
    expect(rows.map((r) => [r.manager, r.advisor, r.grupo_asesor])).toEqual([
      ['ANA', 'LUIS', 'Grupo Familia'],
      ['BETO', null, 'Oficina Vieja'],
      [null, null, null],
      ['ANA', 'LUIS', null],
      [null, null, null],
    ]);
  });

  it('filtra por valor y por "sin asignar"', () => {
    expect(filterBySegment(rows, { manager: 'ANA' }).map((r) => r.id)).toEqual(['a', 'd']);
    expect(filterBySegment(rows, { advisor: SIN_ASIGNAR }).map((r) => r.id)).toEqual(['b', 'c', 'e']);
    expect(filterBySegment(rows, { manager: 'ANA', grupo_asesor: 'Grupo Familia' }).map((r) => r.id)).toEqual(['a']);
  });

  it('lista opciones y totales con "Sin asignar" al final', () => {
    expect(segmentOptions(rows).manager).toEqual(['ANA', 'BETO', SIN_ASIGNAR]);
    expect(segmentOptions(rows.filter((r) => r.manager)).manager).toEqual(['ANA', 'BETO']);
    const byManager = segmentBreakdowns(rows).manager;
    expect(byManager.map((b) => [b.label, b.totals.ARS])).toEqual([
      ['ANA', 50],
      ['BETO', 20],
      ['Sin asignar', 80],
    ]);
  });

  it('agrupa las columnas del reporte por manager y las abre por ALYC', () => {
    const r = buildBrokerPeriodReport(rows, 'month', 'manager');
    expect(r.columns.map((c) => [c.group, c.alyc, r.columnTotals[c.key]])).toEqual([
      ['ANA', 'GMA', 10],
      ['ANA', 'IEB', 40],
      ['BETO', 'GMA', 20],
      ['Sin asignar', 'GMA', 30],
      ['Sin asignar', 'IEB', 50],
    ]);
  });

  it('productor / manager: manda el archivo (productor IEB, oficial GMA) y si falta, el mapping', () => {
    const fromFiles = segmentCommissions(
      [
        { ...op('f', 'IEB', '55001', 1), details: { productor: 'Milagros Behr', productor_numero: '251' } },
        { ...op('g', 'GMA', '1001', 1), account_officer: 'Behr, Claudio' },
        op('h', 'IEB', '55001', 1),
      ],
      mapping
    );
    expect(fromFiles.map((r) => [r.id, r.manager])).toEqual([
      ['f', 'MILI'],
      ['g', 'CLAUDIO'],
      ['h', 'ANA'],
    ]);
  });

  it('excluye varios pares productor – broker y lista las opciones por persona', () => {
    expect(segmentOptions(rows).excluir).toEqual([
      { key: 'GMA|ANA', label: 'ANA – GMA' },
      { key: 'IEB|ANA', label: 'ANA – IEB' },
      { key: 'GMA|BETO', label: 'BETO – GMA' },
      { key: `GMA|${SIN_ASIGNAR}`, label: 'Sin asignar – GMA' },
      { key: `IEB|${SIN_ASIGNAR}`, label: 'Sin asignar – IEB' },
    ]);
    const excluir = joinExclusions(['GMA|ANA', `IEB|${SIN_ASIGNAR}`]);
    expect(filterBySegment(rows, { excluir }).map((r) => r.id)).toEqual(['b', 'c', 'd']);
    expect(filterBySegment(rows, { manager: 'ANA', excluir }).map((r) => r.id)).toEqual(['d']);
  });

  it('agrupando por ALYC no agrega el nivel extra', () => {
    const r = buildBrokerPeriodReport(rows, 'month', 'alyc');
    expect(r.columns.every((c) => c.alyc === null)).toBe(true);
  });
});
