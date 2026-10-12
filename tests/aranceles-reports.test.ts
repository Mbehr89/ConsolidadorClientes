import { describe, expect, it } from 'vitest';
import {
  controlSummary,
  listControlRows,
  listSenebiToCharge,
  splitTradingReviews,
  type ControlSort,
} from '@/lib/aranceles/control';
import { filterCommissions, listMonths } from '@/lib/aranceles/history';
import { segmentCommissions } from '@/lib/aranceles/segments';
import {
  brokerColumnKey,
  buildBrokerPeriodReport,
  buildClientPeriodReport,
  periodKey,
  runningTotals,
} from '@/lib/aranceles/reports';
import type { ArancelCommission } from '@/lib/aranceles/types';

let seq = 0;
function fee(
  alyc: string,
  client: string,
  date: string,
  commission: number,
  commissionCurrency: string,
  opCurrency = commissionCurrency
): ArancelCommission {
  seq += 1;
  return {
    id: `c${seq}`,
    import_id: 'imp',
    alyc,
    client,
    client_key: client.toLowerCase(),
    client_external_id: null,
    account_officer: null,
    trade_date: date,
    settlement_date: null,
    instrument: 'AL30',
    operation: 'CPRA',
    quantity: 1,
    amount: 1000,
    commission,
    commission_pct: null,
    currency: opCurrency,
    commission_currency: commissionCurrency,
    commission_fx: null,
    imported_status: 'ok',
    fee_status: 'ok',
    expected_commission: null,
    op_number: String(seq),
    segment: null,
    is_min_fee: false,
    trading_group: null,
  };
}

const rows = [
  fee('GMA', 'Cliente A', '2026-01-10', 100, 'ARS'),
  fee('GMA', 'Cliente A', '2026-01-20', 2, 'USD'),
  fee('GMA', 'Cliente B', '2026-02-05', 50, 'ARS', 'USD_C'),
  fee('IEB', 'Cliente A', '2026-04-01', 30, 'ARS'),
  fee('IEB', 'Cliente B', '2026-04-15', 1.5, 'USD'),
];

describe('aranceles: reportes por período', () => {
  it('filtra por meses enteros: desde y hasta inclusive', () => {
    const dates = (from: string, to: string) =>
      filterCommissions(rows, { from, to }).map((c) => c.trade_date);
    expect(dates('2026-01', '2026-01')).toEqual(['2026-01-10', '2026-01-20']);
    expect(dates('2026-01', '2026-02')).toEqual(['2026-01-10', '2026-01-20', '2026-02-05']);
    expect(dates('2026-02', '')).toEqual(['2026-02-05', '2026-04-01', '2026-04-15']);
    expect(listMonths(rows)).toEqual(['2026-04', '2026-02', '2026-01']);
  });

  it('arma claves de período ordenables', () => {
    expect(periodKey('2026-03-15', 'month')).toBe('2026-03');
    expect(periodKey('2026-03-15', 'quarter')).toBe('2026-T1');
    expect(periodKey('2026-11-02', 'quarter')).toBe('2026-T4');
    expect(periodKey('2026-03-15', 'year')).toBe('2026');
  });

  it('agrupa por período, broker y moneda del arancel', () => {
    const r = buildBrokerPeriodReport(rows, 'month');
    expect(r.periods.map((p) => p.period)).toEqual(['2026-04', '2026-02', '2026-01']);
    expect(r.columns.map((c) => c.key)).toEqual(['gma|ARS', 'gma|USD', 'ieb|ARS', 'ieb|USD']);
    expect(r.currencies).toEqual(['ARS', 'USD']);

    const jan = r.periods.find((p) => p.period === '2026-01');
    expect(jan?.cells[brokerColumnKey('GMA', 'ARS')]).toBe(100);
    expect(jan?.cells[brokerColumnKey('GMA', 'USD')]).toBe(2);
    expect(jan?.rows).toBe(2);

    expect(r.columnTotals['gma|ARS']).toBe(150);
    expect(r.totals).toEqual({ ARS: 180, USD: 3.5 });
  });

  it('agrupa por trimestre', () => {
    const r = buildBrokerPeriodReport(rows, 'quarter');
    expect(r.periods.map((p) => p.period)).toEqual(['2026-T2', '2026-T1']);
    expect(r.periods[1]?.totals).toEqual({ ARS: 150, USD: 2 });
  });

  it('suma por cliente y período con acumulado', () => {
    const r = buildClientPeriodReport(rows, 'month');
    expect(r.periods).toEqual(['2026-01', '2026-02', '2026-04']);
    const a = r.clients.find((c) => c.name === 'Cliente A');
    expect(a?.byPeriod['2026-01']).toEqual({ ARS: 100, USD: 2 });
    expect(a?.total).toEqual({ ARS: 130, USD: 2 });
    expect(r.periodTotals['2026-04']).toEqual({ ARS: 30, USD: 1.5 });

    const running = runningTotals(r.periods, a?.byPeriod ?? {});
    expect(running['2026-02']).toEqual({ ARS: 100, USD: 2 });
    expect(running['2026-04']).toEqual({ ARS: 130, USD: 2 });
  });
});

describe('aranceles: control ordenado por fecha o boleto', () => {
  const anomaly = (date: string, op: string | null, status: ArancelCommission['fee_status']) => ({
    ...fee('IEB', 'Cliente A', date, 0, 'ARS'),
    op_number: op,
    fee_status: status,
  });
  const list = [
    anomaly('2026-03-01', '1002', 'zero'),
    anomaly('2026-01-15', '998', 'missing'),
    anomaly('2026-02-10', null, 'zero'),
    anomaly('2026-02-10', '5', 'below_expected'),
    { ...fee('IEB', 'Cliente A', '2026-04-01', 10, 'ARS'), op_number: '1' },
  ];
  const ops = (sort: ControlSort) => listControlRows(list, sort).map((c) => c.op_number);

  it('por boleto compara como número y deja los que no tienen n° al final', () => {
    expect(ops({ by: 'boleto', dir: 'asc' })).toEqual(['5', '998', '1002', null]);
    expect(ops({ by: 'boleto', dir: 'desc' })).toEqual(['1002', '998', '5', null]);
  });

  it('por fecha, y a igual fecha por boleto', () => {
    expect(ops({ by: 'fecha', dir: 'asc' })).toEqual(['998', '5', null, '1002']);
    expect(ops({ by: 'fecha', dir: 'desc' })).toEqual(['1002', '5', null, '998']);
  });
});

describe('aranceles: control incluye esperadas y mínimos; SENEBI va aparte', () => {
  const op = (operation: string, over: Partial<ArancelCommission> = {}): ArancelCommission => ({
    ...fee('GMA', 'Cliente A', '2026-05-02', 0, 'ARS'),
    operation,
    ...over,
  });
  const caucionContado = op('APTOMCONC', { fee_status: 'skipped', imported_status: 'skipped' });
  const minimo = op('CPRA', { commission: 5, fee_status: 'ok', is_min_fee: true });
  const normal = op('CPRA', { commission: 50 });
  const senebi = op('CSBNG', { fee_status: 'skipped', imported_status: 'skipped' });
  const senebiCobrado = op('VSBNG', { commission: 12 });
  const all = [caucionContado, minimo, normal, senebi, senebiCobrado];

  it('lista la pata contado ("esperada") y el arancel mínimo, no las SENEBI sin arancel', () => {
    expect(listControlRows(all).map((r) => [r.id, r.control_status])).toEqual([
      [caucionContado.id, 'skipped'],
      [minimo.id, 'min_fee'],
    ]);
    expect(controlSummary(all)).toEqual([
      { status: 'skipped', count: 1 },
      { status: 'min_fee', count: 1 },
    ]);
    expect(listSenebiToCharge(all).map((r) => r.id)).toEqual([senebi.id]);
  });

  it('agrupa el posible trading con la pata que sí cobró arancel y lo saca de la lista común', () => {
    const group = { id: 'g1', from: '100', to: '105', sells: 5000, buys: 5010 };
    const venta = (n: string) =>
      op('VENTA', { op_number: n, amount: 1000, commission: 19.9, fee_status: 'min_on_large', is_min_fee: true, trading_group: group });
    const ventas = ['100', '101', '102', '103', '105'].map(venta);
    const compra = op('COMPRA', { op_number: '104', amount: 5010, commission: 25, trading_group: group });
    const scoped = [...ventas, normal];
    const { groups, rest } = splitTradingReviews(scoped, [...ventas, compra, normal]);
    expect(rest).toEqual([normal]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => [m.op_number, m.side, m.control_status])).toEqual([
      ['100', 'sell', 'min_on_large'],
      ['101', 'sell', 'min_on_large'],
      ['102', 'sell', 'min_on_large'],
      ['103', 'sell', 'min_on_large'],
      ['104', 'buy', null],
      ['105', 'sell', 'min_on_large'],
    ]);
    expect(groups[0]!.charged.ARS).toBeCloseTo(19.9 * 5 + 25, 6);
  });

  it('el importe cargado a mano se usa como arancel en los reportes y sigue en el recuadro SENEBI', () => {
    const withFee = { ...senebi, manual_commission: 30 };
    const [seg] = segmentCommissions([withFee], null);
    expect(seg?.commission).toBe(30);
    expect(seg?.commission_currency).toBe('ARS');
    expect(seg?.fee_status).toBe('ok');
    expect(listSenebiToCharge([seg!]).map((r) => r.id)).toEqual([senebi.id]);
    expect(listControlRows([seg!])).toEqual([]);
  });
});
