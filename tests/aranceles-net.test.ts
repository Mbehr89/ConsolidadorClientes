import { describe, expect, it } from 'vitest';
import { applyImport, emptyHistory } from '@/lib/aranceles/history';
import { buildNetReport, computeNetLine, netAmountOf, netPlacement } from '@/lib/aranceles/net';
import { detectAccountChanges, summarizeProducers } from '@/lib/aranceles/producers';
import {
  DEFAULT_NET_RULES,
  coerceSettings,
  defaultSettings,
  personAlias,
  producerLabel,
  producerOf,
  type ArancelesSettings,
} from '@/lib/aranceles/settings';
import type { ArancelesHistory, NormalizedRow } from '@/lib/aranceles/types';

function row(op: string, commission: number, currency: string, over: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    client: 'Cliente',
    clientExternalId: '1',
    accountOfficer: null,
    date: '2026-08-15',
    settlementDate: null,
    instrument: null,
    operation: null,
    quantity: null,
    amount: null,
    netAmount: null,
    commission,
    commissionPct: null,
    currency,
    opNumber: op,
    feeStatus: 'ok',
    isMinFee: false,
    alyc: null,
    ...over,
  };
}

function load(h: ArancelesHistory, segment: string, rows: NormalizedRow[], alyc = 'IEB') {
  return applyImport(h, { alyc, filename: `${segment}.xlsx`, rows, segment, format: 'ieb' }).history;
}

describe('aranceles: neto IEB (calculadora)', () => {
  it('hoja pesos: mismo resultado que la planilla', () => {
    const lines = [
      computeNetLine('privado', 'ARS', 357548.09, 0),
      computeNetLine('publico', 'ARS', 129845.66, 0),
      computeNetLine('fci_ieb', 'ARS', 58472.64, 0),
    ];
    expect(lines[0]!.iibb).toBeCloseTo(19665.14495, 6);
    expect(lines[0]!.neto).toBeCloseTo(337882.94505, 6);
    expect(lines[0]!.aPagar).toBeCloseTo(219623.9142825, 6);
    expect(lines[1]!.aPagar).toBeCloseTo(79757.696655, 6);
    expect(lines[2]!.iibb).toBeCloseTo(3215.9952, 6);
    expect(lines[2]!.aPagar).toBeCloseTo(38679.65136, 6);
    expect(lines.reduce((s, l) => s + l.aPagar, 0)).toBeCloseTo(338061.2622975, 6);
  });

  it('hoja dólares: mismo resultado que la planilla (Dif. precios sin ÷ 1,21)', () => {
    const lines = [
      computeNetLine('privado', 'USD', 1.8, 0),
      computeNetLine('publico', 'USD', 75.16, 0),
      computeNetLine('diferencia', 'USD', 96.75, 0),
      computeNetLine('fci_ieb', 'USD', 0.61, 0),
    ];
    expect(lines.map((l) => l.aPagar)).toEqual([
      expect.closeTo(1.10565, 8),
      expect.closeTo(46.16703, 8),
      expect.closeTo(59.4286875, 8),
      expect.closeTo(0.403515, 8),
    ]);
    const total = lines.reduce((s, l) => s + l.aPagar, 0);
    expect(total).toBeCloseTo(107.1048825, 8);
    expect(total / 174.32).toBeCloseTo(0.6144153424736117, 10);
  });

  it('IVA: Dif. precios ÷ 1,21 sólo en pesos; fondos de terceros ÷ 1,21 en ambas', () => {
    expect(computeNetLine('diferencia', 'ARS', 100, 0).aPagar).toBeCloseTo((94.5 * 0.65) / 1.21, 10);
    expect(computeNetLine('fci_terceros', 'ARS', 100, 0).aPagar).toBeCloseTo((94.5 * 0.65) / 1.21, 10);
    expect(computeNetLine('fci_terceros', 'USD', 100, 0).aPagar).toBeCloseTo((94.5 * 0.65) / 1.21, 10);
    expect(computeNetLine('diferencia', 'USD_EXT', 100, 0).aPagar).toBeCloseTo(94.5 * 0.65, 10);
  });

  it('las notas suman o restan (con su signo) al bruto del tipo que indica su especie', () => {
    let h = load(emptyHistory(), 'aranceles_privado', [row('1', 1000, 'ARS', { operation: 'PRIVADO' })]);
    h = load(h, 'aranceles_publico', [row('2', 500, 'ARS', { operation: 'PUBLICO' })]);
    h = load(h, 'notas', [
      row('10', -200, 'ARS', { operation: 'NOTA_CREDITO', instrument: 'PRIVADO' }),
      row('11', 50, 'ARS', { operation: 'NOTA_DEBITO', instrument: 'PUBLICO' }),
    ]);
    const r = buildNetReport(h.commissions, 'month');
    const b = r.blocks[0]!;
    const priv = b.lines.find((l) => l.bucket === 'privado')!;
    const pub = b.lines.find((l) => l.bucket === 'publico')!;
    expect([priv.bruto, priv.notas, priv.brutoAjustado]).toEqual([1000, -200, 800]);
    expect(priv.aPagar).toBeCloseTo(800 * 0.945 * 0.65, 10);
    expect([pub.bruto, pub.notas, pub.brutoAjustado]).toEqual([500, 50, 550]);
    expect(b.totals.brutoAjustado).toBe(1350);
  });

  it('ACDI: FCI IEB al 70%, fondos de terceros al 65% ÷ 1,21', () => {
    expect(netPlacement({ alyc: 'IEB', segment: 'acdi', operation: 'FCI IEB', instrument: null, commission: 1 })).toEqual({
      bucket: 'fci_ieb',
      kind: 'bruto',
    });
    expect(
      netPlacement({ alyc: 'IEB', segment: 'acdi', operation: 'FCI TERCEROS', instrument: null, commission: 1 })
    ).toEqual({ bucket: 'fci_terceros', kind: 'bruto' });
    expect(netPlacement({ alyc: 'IEB', segment: 'acdi', operation: 'ACDI', instrument: null, commission: 1 })).toEqual({
      bucket: null,
      excluded: 'fci_sin_clasificar',
    });
  });

  it('licitaciones: línea propia con las reglas de títulos públicos; ALYC sin regla no entra', () => {
    let h = load(emptyHistory(), 'aranceles_privado', [row('1', 100, 'ARS', { operation: 'PRIVADO' })]);
    h = load(h, 'licitaciones', [row('5', 300, 'ARS', { operation: 'LICITACION' })]);
    h = applyImport(h, { alyc: 'Balanz', filename: 'b.xlsx', rows: [row('9', 40, 'ARS')], format: 'generic' }).history;
    const r = buildNetReport(h.commissions, 'month');
    expect(r.otherAlycRows).toBe(1);
    expect(r.blocks[0]!.totals.bruto).toBe(400);
    expect(r.blocks[0]!.excluded).toEqual([]);
    const lic = r.blocks[0]!.lines.find((l) => l.bucket === 'licitacion')!;
    expect(lic.aPagar).toBeCloseTo(computeNetLine('publico', 'ARS', 300, 0).aPagar, 10);
    expect(lic.label).toBe('Licitaciones');
  });

  it('separa por período y moneda (USD exterior con reglas de dólares, en su propia moneda)', () => {
    let h = load(emptyHistory(), 'aranceles_publico', [
      row('1', 10, 'USD', { operation: 'PUBLICO', date: '2026-08-01' }),
      row('2', 20, 'USD_EXT', { operation: 'PUBLICO', date: '2026-08-02' }),
      row('3', 30, 'ARS', { operation: 'PUBLICO', date: '2026-09-01' }),
    ]);
    h = load(h, 'acdi', [row('4', 1, 'USD', { operation: 'FCI IEB', date: '2026-09-03' })]);
    const r = buildNetReport(h.commissions, 'month');
    expect(r.blocks.map((b) => `${b.period} ${b.currency} ${b.sheet}`)).toEqual([
      '2026-09 ARS pesos',
      '2026-09 USD dolares',
      '2026-08 USD dolares',
      '2026-08 USD_EXT dolares',
    ]);
  });

  it('GMA: se paga el 60% del bruto (sin IIBB ni IVA); datos viejos "ESCO" cuentan como GMA', () => {
    let h = load(emptyHistory(), 'aranceles_publico', [row('1', 100, 'ARS', { operation: 'PUBLICO' })]);
    h = applyImport(h, { alyc: 'ESCO', filename: 'g.xlsx', rows: [row('9', 40, 'ARS'), row('10', 2, 'USD')], format: 'gma' }).history;
    const r = buildNetReport(h.commissions, 'month');
    expect(r.otherAlycRows).toBe(0);
    const gma = r.blocks.flatMap((b) => b.byAlyc.filter((x) => x.alyc === 'GMA').map((x) => [b.currency, x.totals.aPagar]));
    expect(gma).toEqual([
      ['ARS', expect.closeTo(24, 10)],
      ['USD', expect.closeTo(1.2, 10)],
    ]);
    expect(r.blocks[0]!.lines.find((l) => l.alyc === 'GMA')).toMatchObject({ bucket: 'privado', iibb: 0, share: 0.6, ivaDivisor: 1 });
    const ars = r.byCurrency.find((c) => c.currency === 'ARS')!;
    expect(ars.bruto).toBe(140);
    expect(ars.aPagar).toBeCloseTo(100 * 0.945 * 0.65 + 24, 10);
    expect(netAmountOf(h.commissions.find((c) => c.op_number === '9')!, defaultSettings())).toBeCloseTo(24, 10);
  });

  it('detalle mensual por broker × productor/manager × tipo, con subtotal por broker', () => {
    let h = load(emptyHistory(), 'aranceles_privado', [
      row('1', 100, 'ARS', { operation: 'PRIVADO', details: { productor_numero: '7' } }),
      row('2', 50, 'ARS', { operation: 'PRIVADO', details: { productor_numero: '8' } }),
      row('3', 10, 'ARS', { operation: 'PRIVADO', details: { productor_numero: '7' } }),
    ]);
    h = load(h, 'aranceles_publico', [row('4', 20, 'ARS', { operation: 'PUBLICO', details: { productor_numero: '7' } })]);
    h = applyImport(h, {
      alyc: 'GMA',
      filename: 'g.xlsx',
      rows: [
        row('9', 40, 'ARS', { operation: 'COMPRA', instrument: 'GGAL' }),
        row('10', 30, 'ARS', { operation: 'VENTA', instrument: 'AL30' }),
        row('11', 5, 'ARS', { operation: 'CSBNG', instrument: 'AL35' }),
        row('12', 2, 'ARS', { operation: 'APTOMFUTC' }),
      ],
      format: 'gma',
    }).history;
    const r = buildNetReport(h.commissions, 'month', defaultSettings(), {
      personaOf: (c, alyc) => (alyc === 'IEB' ? (c.details?.productor_numero ?? null) : 'MILI'),
    });
    const b = r.blocks[0]!;
    expect(b.lines.map((l) => [l.alyc, l.persona, l.bucket, l.bruto])).toEqual([
      ['IEB', '7', 'privado', 110],
      ['IEB', '7', 'publico', 20],
      ['IEB', '8', 'privado', 50],
      ['GMA', 'MILI', 'privado', 40],
      ['GMA', 'MILI', 'publico', 30],
      ['GMA', 'MILI', 'diferencia', 5],
      ['GMA', 'MILI', 'caucion', 2],
    ]);
    expect(b.lines.filter((l) => l.alyc === 'GMA').map((l) => l.label)).toEqual([
      'Títulos privados',
      'Títulos públicos',
      'Dif. precios (SENEBI)',
      'Cauciones',
    ]);
    expect(b.byAlyc.map((x) => [x.alyc, x.totals.bruto])).toEqual([
      ['IEB', 180],
      ['GMA', 77],
    ]);
    expect(b.totals.aPagar).toBeCloseTo(180 * 0.945 * 0.65 + 77 * 0.6, 10);
  });
});

describe('aranceles: configuración del neto', () => {
  const withProducer = (op: string, commission: number, date: string, numero: string, cuenta = '100') =>
    row(op, commission, 'ARS', {
      operation: 'PRIVADO',
      date,
      clientExternalId: cuenta,
      details: { productor: `Productor ${numero}`, productor_numero: numero },
    });

  function base(): ArancelesSettings {
    return defaultSettings();
  }

  it('aplica la versión de alícuotas vigente a la fecha de cada operación', () => {
    const settings = base();
    settings.net_rules.push({
      ...DEFAULT_NET_RULES,
      id: 'v2',
      valid_from: '2026-09-01',
      buckets: { ...DEFAULT_NET_RULES.buckets, privado: { share: 0.6, iva_pesos: 1, iva_dolares: 1 } },
    });
    const h = load(emptyHistory(), 'aranceles_privado', [
      withProducer('1', 100, '2026-08-31', '7'),
      withProducer('2', 100, '2026-09-01', '7'),
    ]);
    const r = buildNetReport(h.commissions, 'year', settings);
    const line = r.blocks[0]!.lines[0]!;
    expect(line.aPagar).toBeCloseTo(94.5 * 0.65 + 94.5 * 0.6, 10);
    expect(line.share).toBeNull();
    expect(r.ruleVersionsUsed).toBe(2);
  });

  it('un arreglo comercial pisa la distribución sólo para ese productor, tipo y rango', () => {
    const settings = base();
    settings.agreements.push({
      id: 'a1',
      productor_numero: '7',
      valid_from: '2026-08-01',
      valid_to: '2026-08-31',
      shares: { privado: 0.8 },
      notas: null,
      created_at: '',
    });
    const h = load(emptyHistory(), 'aranceles_privado', [
      withProducer('1', 100, '2026-08-10', '7'),
      withProducer('2', 100, '2026-08-10', '8', '200'),
      withProducer('3', 100, '2026-09-10', '7'),
    ]);
    const r = buildNetReport(h.commissions, 'year', settings);
    expect(r.blocks[0]!.totals.aPagar).toBeCloseTo(94.5 * 0.8 + 94.5 * 0.65 * 2, 10);
    expect(r.agreementRows).toBe(1);
  });

  it('un cambio de cuenta registrado pisa el productor del archivo desde su fecha', () => {
    const settings = base();
    settings.account_transfers.push({
      id: 't1',
      cuenta: '100',
      productor_numero: '9',
      valid_from: '2026-09-01',
      notas: null,
      created_at: '',
    });
    const h = load(emptyHistory(), 'aranceles_privado', [
      withProducer('1', 100, '2026-08-10', '7'),
      withProducer('2', 100, '2026-09-10', '7'),
    ]);
    const [before, after] = h.commissions;
    expect(producerOf(before!, settings)).toBe('7');
    expect(producerOf(after!, settings)).toBe('9');
    const producers = summarizeProducers(h.commissions, settings, '2026-10-01');
    expect(producers.map((p) => [p.numero, p.operaciones])).toEqual([
      ['7', 1],
      ['9', 1],
    ]);
    const changes = detectAccountChanges(h.commissions, settings);
    expect(changes).toEqual([expect.objectContaining({ cuenta: '100', desdeProductor: '7', haciaProductor: '9', origen: 'registrado' })]);
  });

  it('detecta en los archivos una cuenta que cambió de productor', () => {
    const h = load(emptyHistory(), 'aranceles_privado', [
      withProducer('1', 100, '2026-08-10', '7'),
      withProducer('2', 100, '2026-09-10', '8'),
    ]);
    expect(detectAccountChanges(h.commissions, base())).toEqual([
      expect.objectContaining({ cuenta: '100', desdeProductor: '7', haciaProductor: '8', fecha: '2026-09-10', origen: 'archivo' }),
    ]);
  });

  it('homogeneiza nombres: productor IEB y oficial GMA se ven igual que el manager de GMA', () => {
    const s = defaultSettings();
    expect(personAlias('Milagros Behr', s)).toBe('MILI');
    expect(personAlias('Behr, Milagros', s)).toBe('MILI');
    expect(personAlias('MARTÍN  BEHR', s)).toBe('MARTIN');
    expect(personAlias('Behr, Claudio', s)).toBe('CLAUDIO');
    expect(personAlias('mili', s)).toBe('MILI');
    expect(personAlias('Florencia Casiraghi', s)).toBe('Florencia Casiraghi');
    expect(producerLabel('251', s, 'Milagros Behr')).toBe('MILI');
    expect(producerLabel('300', s, null)).toBe('300');
    s.producers.push({ numero: '251', codigo: 'MB', nombre: null, notas: null });
    expect(producerLabel('251', s, 'Milagros Behr')).toBe('MB');
    expect(coerceSettings({}).person_aliases.map((a) => a.alias)).toEqual(['MILI', 'MARTIN', 'CLAUDIO']);
  });

  it('coerceSettings completa tipos faltantes con la planilla', () => {
    const s = coerceSettings({ net_rules: [{ ...DEFAULT_NET_RULES, buckets: { privado: { share: 0.5, iva_pesos: 1, iva_dolares: 1 } } }] });
    expect(s.net_rules[0]!.buckets.privado.share).toBe(0.5);
    expect(s.net_rules[0]!.buckets.licitacion).toEqual(DEFAULT_NET_RULES.buckets.publico);
  });
});
