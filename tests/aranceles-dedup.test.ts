import { describe, expect, it } from 'vitest';
import { alycKey, findDuplicateGroups, findSharedIdGroups, normalizeOpNumber, operationKey } from '@/lib/aranceles/dedup';
import { applyImport, coerceHistory, collapseReissuedBoletos, emptyHistory, inheritMissingProducers, removeImports } from '@/lib/aranceles/history';
import type { ArancelesHistory, NormalizedRow } from '@/lib/aranceles/types';

function row(op: string | null, over: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    client: 'Cliente Uno',
    clientExternalId: '1001',
    accountOfficer: null,
    date: '2026-09-10',
    settlementDate: null,
    instrument: 'AL30',
    operation: 'COMPRA',
    quantity: 100,
    amount: 1000,
    netAmount: null,
    commission: 5,
    commissionPct: 0.5,
    currency: 'ARS',
    opNumber: op,
    feeStatus: 'ok',
    isMinFee: false,
    alyc: null,
    ...over,
  };
}

function load(h: ArancelesHistory, alyc: string, rows: NormalizedRow[], segment: string | null = null) {
  return applyImport(h, { alyc, filename: 'f.xlsx', rows, segment, format: 'gma' });
}

const month = (ops: string[]) => ops.map((op) => row(op));

describe('aranceles: identificación de operaciones y duplicados', () => {
  it('normaliza el n° de boleto', () => {
    for (const raw of ['76170', 76170, '76170.0', '076170', '76.170', ' 76170 ']) {
      expect(normalizeOpNumber(raw)).toBe('76170');
    }
    expect(normalizeOpNumber('')).toBeNull();
    expect(normalizeOpNumber('ab-12')).toBe('AB-12');
  });

  it('al reconocer una operación por id completa el detalle que le falte, sin pisar el que tiene', () => {
    const first = load(emptyHistory(), 'IEB', [row('1'), row('2', { details: { productor: 'Viejo' } })]);
    const second = load(first.history, 'IEB', [
      row('1', { details: { productor: 'Prod X', productor_numero: '77' } }),
      row('2', { details: { productor: 'Nuevo', productor_numero: '78' } }),
    ]);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.enriched).toBe(2);
    expect(second.history.commissions.map((c) => c.details)).toEqual([
      { productor: 'Prod X', productor_numero: '77' },
      { productor: 'Viejo', productor_numero: '78' },
    ]);
  });

  it('el mismo archivo subido dos veces no duplica nada', () => {
    const first = load(emptyHistory(), 'GMA', month(['1', '2', '3']));
    const second = load(first.history, 'GMA', month(['1', '2', '3']));
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(second.history.commissions).toHaveLength(3);
    expect(findDuplicateGroups(second.history.commissions)).toEqual([]);
  });

  it('mes parcial y después completo: sólo agrega lo nuevo', () => {
    const partial = load(emptyHistory(), 'GMA', month(['1', '2']));
    const full = load(partial.history, 'GMA', month(['1', '2', '3', '4']));
    expect(full.inserted).toBe(2);
    expect(full.duplicates).toBe(2);
    expect(full.history.commissions.map((c) => c.op_number).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('borrar el parcial no pierde operaciones que también están en el completo', () => {
    const partial = load(emptyHistory(), 'GMA', month(['1', '2']));
    const full = load(partial.history, 'GMA', month(['1', '2', '3']));
    const after = removeImports(full.history, [partial.importRecord!.id]);
    expect(after.commissions.map((c) => c.op_number).sort()).toEqual(['1', '2', '3']);
    expect(after.commissions.every((c) => c.import_id === full.importRecord!.id)).toBe(true);
    const none = removeImports(after, [full.importRecord!.id]);
    expect(none.commissions).toHaveLength(0);
  });

  it('borrar el completo deja sólo lo que vino en el parcial', () => {
    const partial = load(emptyHistory(), 'GMA', month(['1', '2']));
    const full = load(partial.history, 'GMA', month(['1', '2', '3']));
    const after = removeImports(full.history, [full.importRecord!.id]);
    expect(after.commissions.map((c) => c.op_number).sort()).toEqual(['1', '2']);
  });

  it('la ALYC escrita distinto o el n° con otro formato se reconocen como la misma operación', () => {
    const first = load(emptyHistory(), 'GMA', [row('76170')]);
    const second = load(first.history, ' gma ', [row('76170.0'), row('076171')]);
    expect(second.duplicates).toBe(1);
    expect(second.inserted).toBe(1);
    expect(second.importRecord?.alyc).toBe('GMA');
    expect(new Set(second.history.commissions.map((c) => c.alyc))).toEqual(new Set(['GMA']));
  });

  it('ESCO es el nombre viejo de GMA: se renombra al cargar y sus operaciones se reconocen', () => {
    const old = coerceHistory(load(emptyHistory(), 'ESCO', [row('76170')]).history);
    expect(old.commissions[0]?.alyc).toBe('GMA');
    expect(old.imports[0]?.alyc).toBe('GMA');
    const again = load(old, 'ESCO', [row('76170')]);
    expect(again.duplicates).toBe(1);
    expect(again.importRecord?.alyc).toBe('GMA');
    expect(alycKey('ESCO')).toBe(alycKey('GMA'));
  });

  it('el dólar cable (USD_C) se unifica en USD_EXT al cargar y se reconoce al reimportar', () => {
    const old = load(emptyHistory(), 'GMA', [row('900', { currency: 'USD_C' })]).history;
    const migrated = coerceHistory(old);
    expect(migrated.commissions[0]?.currency).toBe('USD_EXT');
    expect(migrated.commissions[0]?.commission_currency).toBe('USD_EXT');
    const again = load(migrated, 'GMA', [row('900', { currency: 'USD_EXT' })]);
    expect(again.duplicates).toBe(1);
    expect(again.conflicts).toHaveLength(0);
  });

  it('la misma operación con otro boleto no se suma: queda el boleto nuevo', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('97978301', { instrument: 'GOOGL', date: '2026-10-01', clientExternalId: '334190', amount: 149910, commission: 149910, quantity: null })],
      'aranceles_privado'
    );
    const second = load(
      first.history,
      'IEB',
      [
        row('105610553', { instrument: 'GOOGL', date: '2026-10-01', clientExternalId: '334190', amount: 149910, commission: 149910, quantity: null }),
        row('105700000', { instrument: 'MSFT', date: '2026-10-15', clientExternalId: '334190', amount: 100, commission: 100, quantity: null }),
      ],
      'aranceles_privado'
    );
    expect(second.inserted).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.history.commissions.map((c) => c.op_number).sort()).toEqual(['105610553', '105700000']);
  });

  it('al leer el historial deja una sola copia si el boleto cambió entre archivos', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('97978301', { instrument: 'GOOGL', amount: 149910, commission: 149910, quantity: null })],
      'aranceles_privado'
    );
    const old = first.history.commissions[0]!;
    const oldImport = { ...first.history.imports[0]!, imported_at: '2026-10-12T00:00:00.000Z' };
    const nextImport = { ...oldImport, id: 'imp_new', imported_at: '2026-11-06T00:00:00.000Z' };
    const cleaned = coerceHistory({
      ...first.history,
      imports: [oldImport, nextImport],
      commissions: [old, { ...old, id: 'nuevo', op_number: '105610553', import_id: 'imp_new' }],
    });
    expect(cleaned.commissions.map((c) => c.op_number)).toEqual(['105610553']);
  });

  it('el mismo arancel con otro boleto no entra aunque IEB haya cambiado el bruto', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('98015868', { instrument: 'YMCXO', date: '2026-10-05', clientExternalId: '352723', amount: 325786.52, commission: 206.98, quantity: null, currency: 'USD' })],
      'aranceles_privado'
    );
    const second = load(
      first.history,
      'IEB',
      [row('105659661', { instrument: 'YMCXO', date: '2026-10-05', clientExternalId: '352723', amount: 332823.84, commission: 206.98, quantity: null, currency: 'USD' })],
      'aranceles_privado'
    );
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]).toMatchObject({ op_number: '105659661', amount: 332823.84, commission: 206.98 });
    const third = load(
      second.history,
      'IEB',
      [row('105659661', { instrument: 'YMCXO', date: '2026-10-05', clientExternalId: '352723', amount: 332823.84, commission: 210, quantity: null, currency: 'USD' })],
      'aranceles_privado'
    );
    expect(third.inserted).toBe(0);
    expect(third.conflicts).toHaveLength(1);
    expect(third.history.commissions).toHaveLength(1);
    expect(third.history.commissions[0]?.commission).toBe(206.98);
  });

  it('FCI: dos boletos de la misma posición en un archivo quedan en el más alto', () => {
    const r = load(
      emptyHistory(),
      'IEB',
      [
        row('74593157', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 105452.87, quantity: 9091601.69, amount: 111751867.84 }),
        row('77103773', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 35407.17, quantity: 7115535.64, amount: 87866725.51 }),
      ],
      'acdi'
    );
    expect(r.inserted).toBe(1);
    expect(r.repeatedInFile).toBe(1);
    expect(r.conflicts).toHaveLength(0);
    expect(r.history.commissions).toHaveLength(1);
    expect(r.history.commissions[0]).toMatchObject({ op_number: '77103773', commission: 35407.17 });
  });

  it('FCI: si el boleto más alto viene primero, igual no se suma el otro', () => {
    const r = load(
      emptyHistory(),
      'IEB',
      [
        row('77103773', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 35407.17 }),
        row('74593157', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 105452.87 }),
      ],
      'acdi'
    );
    expect(r.history.commissions).toHaveLength(1);
    expect(r.history.commissions[0]?.op_number).toBe('77103773');
    expect(r.history.commissions[0]?.commission).toBe(35407.17);
  });

  it('FCI: un archivo posterior reemplaza la posición aunque cambien boleto, arancel y cantidad', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('74593157', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 105452.87, quantity: 100 })],
      'acdi'
    );
    const second = load(
      first.history,
      'IEB',
      [row('77103773', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 35407.17, quantity: 80 })],
      'acdi'
    );
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]).toMatchObject({ op_number: '77103773', commission: 35407.17, quantity: 80 });
  });

  it('FCI: el archivo más nuevo manda, aunque el boleto sea el original', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('77103773', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 35407.17 })],
      'acdi'
    );
    const second = load(
      first.history,
      'IEB',
      [row('74593157', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 105452.87 })],
      'acdi'
    );
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]).toMatchObject({ op_number: '74593157', commission: 105452.87 });
  });

  it('FCI: "Clase B" y "Clase B ARS" son la misma posición', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('74598593', { instrument: 'Ciclo Nova Ahorro Plus Clase B', date: '2026-09-01', commission: 14301.05 })],
      'acdi'
    );
    const second = load(
      first.history,
      'IEB',
      [row('77114898', { instrument: 'Ciclo Nova Ahorro Plus Clase B ARS', date: '2026-09-01', commission: 3054.5 })],
      'acdi'
    );
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]?.op_number).toBe('77114898');
  });

  it('FCI: dos suscripciones con boletos cercanos se conservan las dos', () => {
    const r = load(
      emptyHistory(),
      'IEB',
      [
        row('74590001', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 100, quantity: 10 }),
        row('74590080', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 40, quantity: 4 }),
      ],
      'acdi'
    );
    expect(r.inserted).toBe(2);
    expect(r.history.commissions).toHaveLength(2);
    const again = coerceHistory(r.history);
    expect(again.commissions).toHaveLength(2);
  });

  it('FCI: dos fondos el mismo día se conservan los dos', () => {
    const r = load(
      emptyHistory(),
      'IEB',
      [
        row('10', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 10 }),
        row('11', { instrument: 'Ciclo Nova Estrategico Clase A', date: '2026-09-01', commission: 4 }),
      ],
      'acdi'
    );
    expect(r.inserted).toBe(2);
    expect(r.history.commissions).toHaveLength(2);
  });

  it('FCI ya guardado dos veces: al leer queda la copia que volvió en un archivo posterior', () => {
    const first = load(
      emptyHistory(),
      'IEB',
      [row('74586455', { instrument: 'Ciclo Nova Ahorro Clase A', date: '2026-09-01', commission: 21.75, quantity: 1807.21 })],
      'acdi'
    );
    const kept = first.history.commissions[0]!;
    const oldImport = { ...first.history.imports[0]!, imported_at: '2026-10-12T00:00:00.000Z' };
    const late = { ...oldImport, id: 'imp_late', imported_at: '2026-11-06T00:00:00.000Z', filename: 'ACDI sept.xlsx' };
    const cleaned = coerceHistory({
      ...first.history,
      imports: [oldImport, late],
      commissions: [
        { ...kept, import_id: oldImport.id, also_in_imports: [late.id] },
        { ...kept, id: 'reemitido', op_number: '77092501', commission: 8.76, import_id: oldImport.id, also_in_imports: [] },
      ],
    });
    expect(cleaned.commissions).toHaveLength(1);
    expect(cleaned.commissions[0]).toMatchObject({ op_number: '74586455', commission: 21.75 });
  });

  it('dos boletos en la misma importación no se borran al leer', () => {
    const loaded = load(
      emptyHistory(),
      'IEB',
      [
        row('58966709', { instrument: 'PAMP', amount: 21380, commission: 21380 }),
        row('58966976', { instrument: 'PAMP', amount: 21380, commission: 21380 }),
      ],
      'aranceles_privado'
    );
    expect(collapseReissuedBoletos(loaded.history.commissions, loaded.history.imports)).toHaveLength(2);
  });

  it('dos boletos distintos dentro del mismo archivo se guardan los dos', () => {
    const r = load(
      emptyHistory(),
      'IEB',
      [row('1', { commission: 10, amount: 10 }), row('2', { commission: 10, amount: 10 })],
      'aranceles_privado'
    );
    expect(r.inserted).toBe(2);
    expect(r.conflicts).toHaveLength(0);
  });

  it('mismo n° con datos distintos: no se duplica ni se pisa, queda como conflicto', () => {
    const first = load(emptyHistory(), 'GMA', [row('500', { commission: 5 })]);
    const second = load(first.history, 'GMA', [row('500', { commission: 7.5 })]);
    expect(second.inserted).toBe(0);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]?.differences).toEqual(['arancel']);
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]?.commission).toBe(5);
  });

  it('el nombre del cliente escrito distinto no genera duplicado si la cuenta es la misma', () => {
    const first = load(emptyHistory(), 'GMA', [row('9', { client: 'PEREZ JUAN' })]);
    const second = load(first.history, 'GMA', [row('9', { client: 'Pérez, Juan' })]);
    expect(second.duplicates).toBe(1);
    expect(second.history.commissions).toHaveLength(1);
  });

  it('una línea repetida dentro del mismo archivo se guarda una sola vez', () => {
    const r = load(emptyHistory(), 'GMA', [row('1'), row('1'), row('2')]);
    expect(r.inserted).toBe(2);
    expect(r.repeatedInFile).toBe(1);
  });

  it('mismo n° repetido con datos distintos dentro del archivo: no entra ninguna y quedan como conflicto', () => {
    const r = load(emptyHistory(), 'GMA', [
      row('77', { commission: 1 }),
      row('77', { commission: 2 }),
      row('77', { commission: 3 }),
      row('78'),
    ]);
    expect(r.inserted).toBe(1);
    expect(r.conflicts).toHaveLength(3);
    expect(r.conflicts[0]?.differences[0]).toMatch(/mismo archivo/);
    expect(findSharedIdGroups(r.history.commissions)).toEqual([]);
  });

  it('detecta un n° compartido por operaciones distintas en el historial', () => {
    const a = load(emptyHistory(), 'GMA', [row('1')]);
    const other = { ...a.history.commissions[0]!, id: 'otro', commission: 99 };
    expect(findSharedIdGroups([...a.history.commissions, other])).toHaveLength(1);
    expect(findDuplicateGroups([...a.history.commissions, other])).toHaveLength(0);
  });

  it('ACDI: el mismo ID con otra fecha se actualiza y no se duplica ni queda en conflicto', () => {
    const first = load(emptyHistory(), 'IEB', [row('10', { date: '2026-01-01', instrument: 'Fondo X', commission: 5 })], 'acdi');
    const second = load(first.history, 'IEB', [row('10', { date: '2026-09-01', instrument: 'Fondo X', commission: 8 })], 'acdi');
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.history.commissions).toHaveLength(1);
    expect(second.history.commissions[0]).toMatchObject({ trade_date: '2026-09-01', commission: 8, instrument: 'Fondo X' });
    const again = load(second.history, 'IEB', [row('10', { date: '2026-09-01', instrument: 'Fondo X', commission: 8 })], 'acdi');
    expect(again.updated).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(again.history.commissions).toHaveLength(1);
  });

  it('IEB: el mismo ID en planillas distintas (aranceles vs ACDI) son operaciones distintas', () => {
    const a = load(emptyHistory(), 'IEB', [row('777')], 'aranceles_privado');
    const b = load(a.history, 'IEB', [row('777', { instrument: 'FCI X' })], 'acdi');
    expect(b.inserted).toBe(1);
    expect(b.history.commissions).toHaveLength(2);
    const c = load(b.history, 'IEB', [row('777')], 'aranceles_publico');
    expect(c.duplicates).toBe(1);
    expect(operationKey(c.history.commissions[0]!)).toBe('ieb|aranceles|777');
  });

  it('distintas ALYC pueden tener el mismo n° sin chocar', () => {
    const a = load(emptyHistory(), 'GMA', [row('100')]);
    const b = load(a.history, 'IEB', [row('100')], 'aranceles_privado');
    expect(b.inserted).toBe(1);
  });

  it('filas sin n°: se cuentan por contenido (no se pierden repeticiones legítimas)', () => {
    const a = load(emptyHistory(), 'OTRA', [row(null), row(null)]);
    expect(a.inserted).toBe(2);
    const b = load(a.history, 'OTRA', [row(null), row(null), row(null)]);
    expect(b.inserted).toBe(1);
    expect(b.duplicates).toBe(2);
  });

  it('una fila en dólares sin productor hereda el de la misma cuenta', () => {
    const mili = { productor: 'Milagros Behr', productor_numero: '251' };
    const claudio = { productor: 'Claudio Behr', productor_numero: '252' };
    const base = {
      id: 'a',
      import_id: 'i',
      alyc: 'IEB',
      client: 'IZZO',
      client_key: 'izzo',
      client_external_id: '341548',
      account_officer: 'Sin asignar',
      trade_date: '2026-09-01',
      settlement_date: null,
      instrument: 'YFCJO',
      operation: 'PRIVADO',
      quantity: null,
      amount: 1,
      commission: 22,
      commission_pct: null,
      currency: 'USD',
      commission_currency: 'USD',
      commission_fx: null,
      imported_status: 'ok' as const,
      fee_status: 'ok' as const,
      expected_commission: null,
      op_number: '1',
      segment: 'aranceles_privado',
      is_min_fee: false,
      trading_group: null,
      also_in_imports: [],
    };
    const rows = inheritMissingProducers([
      base,
      { ...base, id: 'b', trade_date: '2026-08-31', currency: 'USD', details: mili, op_number: '2' },
      { ...base, id: 'c', client_external_id: '352078', trade_date: '2026-09-10', currency: 'ARS', details: mili, op_number: '3' },
      { ...base, id: 'd', client_external_id: '352078', trade_date: '2026-09-04', currency: 'USD', details: undefined, op_number: '4' },
      { ...base, id: 'e', client_external_id: '352078', trade_date: '2026-06-12', currency: 'USD', details: claudio, op_number: '5' },
      { ...base, id: 'f', client_external_id: '999', trade_date: '2026-09-01', details: undefined, op_number: '6' },
      { ...base, id: 'g', client_external_id: '999', trade_date: '2026-09-02', details: mili, op_number: '7' },
      { ...base, id: 'h', client_external_id: '999', trade_date: '2026-09-02', details: claudio, op_number: '8' },
    ]);
    expect(rows.find((c) => c.id === 'a')?.details).toMatchObject(mili);
    expect(rows.find((c) => c.id === 'd')?.details).toMatchObject(mili);
    expect(rows.find((c) => c.id === 'e')?.details).toMatchObject(claudio);
    expect(rows.find((c) => c.id === 'f')?.details?.productor_numero).toBeUndefined();
  });

  it('detecta duplicados si el historial llega a tenerlos', () => {
    const a = load(emptyHistory(), 'GMA', [row('1')]);
    const copy = { ...a.history.commissions[0]!, id: 'otro' };
    expect(findDuplicateGroups([...a.history.commissions, copy])).toHaveLength(1);
  });
});
