import { describe, expect, it } from 'vitest';
import { alycKey, findDuplicateGroups, findSharedIdGroups, normalizeOpNumber, operationKey } from '@/lib/aranceles/dedup';
import { applyImport, coerceHistory, emptyHistory, removeImports } from '@/lib/aranceles/history';
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

  it('detecta duplicados si el historial llega a tenerlos', () => {
    const a = load(emptyHistory(), 'GMA', [row('1')]);
    const copy = { ...a.history.commissions[0]!, id: 'otro' };
    expect(findDuplicateGroups([...a.history.commissions, copy])).toHaveLength(1);
  });
});
