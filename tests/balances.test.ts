import { describe, expect, it } from 'vitest';
import { applyImport, emptyHistory } from '@/lib/aranceles/history';
import { defaultSettings } from '@/lib/aranceles/settings';
import type { NormalizedRow } from '@/lib/aranceles/types';
import { coerceBalances } from '@/lib/balances/config';
import { buildMonthBalances, monthsMissingFx, unify } from '@/lib/balances/compute';
import { collectIncome } from '@/lib/balances/income';
import type { IncomeCell } from '@/lib/balances/compute';

function row(op: string, commission: number, currency: string, over: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    client: 'Cliente',
    clientExternalId: '1',
    accountOfficer: null,
    date: '2026-09-15',
    settlementDate: null,
    instrument: null,
    operation: 'PRIVADO',
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

const sept: IncomeCell = { month: '2026-09', grupo: 'Grupo Familia', ars: 1000, usd: 10, cable: 2 };
const empty = { partners: [], expenses: [], fx: [] };

describe('balances', () => {
  it('unifica a pesos con el tipo de cambio y a dólares al dividir', () => {
    expect(unify(1000, 12, 1000, 'ARS')).toBe(13000);
    expect(unify(1000, 12, 1000, 'USD')).toBe(13);
    expect(unify(1000, 0, null, 'ARS')).toBe(1000);
    expect(unify(0, 12, null, 'USD')).toBe(12);
    expect(unify(1000, 12, null, 'ARS')).toBeNull();
  });

  it('resta sueldos y gastos y reparte el resultado por beneficio y por equity', () => {
    const months = buildMonthBalances(
      [sept],
      {
        partners: [
          { id: 'a', name: 'Ana', grupo: 'Grupo Familia', equity: 0.7, profit: 0.6 },
          { id: 'b', name: 'Luis', grupo: 'Grupo Familia', equity: 0.3, profit: 0.4 },
        ],
        expenses: [
          { id: 's', grupo: 'Grupo Familia', kind: 'sueldo', label: 'Sueldo', month: '2026-09', currency: 'ARS', amount: 1000 },
          { id: 'g', grupo: 'Grupo Familia', kind: 'alquiler', label: 'Alquiler', month: '2026-09', currency: 'USD', amount: 2 },
        ],
        fx: [{ month: '2026-09', arsPerUsd: 1000 }],
      },
      'Grupo Familia',
      'ARS'
    );
    expect(months).toHaveLength(1);
    const m = months[0]!;
    expect(m.income).toBe(13000);
    expect(m.salaries).toBe(1000);
    expect(m.expenses).toBe(2000);
    expect(m.result).toBe(10000);
    expect(m.partners.map((p) => p.byProfit)).toEqual([6000, 4000]);
    expect(m.partners.map((p) => p.byEquity)).toEqual([7000, 3000]);
    expect(m.unassignedProfit).toBe(0);
    expect(m.cableIncome).toBe(2);
  });

  it('un % de beneficio que no suma 100 deja el resto sin asignar', () => {
    const [m] = buildMonthBalances(
      [{ month: '2026-09', grupo: null, ars: 100, usd: 0, cable: 0 }],
      {
        ...empty,
        partners: [{ id: 'a', name: 'Ana', grupo: null, equity: 1, profit: 0.25 }],
      },
      null,
      'ARS'
    );
    expect(m!.result).toBe(100);
    expect(m!.partners[0]!.byProfit).toBe(25);
    expect(m!.unassignedProfit).toBe(75);
    expect(m!.missingFx).toBe(false);
  });

  it('sin tipo de cambio no inventa el resultado cuando hay que convertir', () => {
    const [m] = buildMonthBalances([sept], empty, 'Grupo Familia', 'USD');
    expect(m!.result).toBeNull();
    expect(m!.missingFx).toBe(true);
    expect(monthsMissingFx([sept], empty)).toEqual(['2026-09']);
  });

  it('los gastos de otro grupo no entran', () => {
    const [m] = buildMonthBalances([sept], {
      ...empty,
      expenses: [
        { id: 'g', grupo: 'Oficina Vieja', kind: 'otro', label: 'Otro', month: '2026-09', currency: 'ARS', amount: 500 },
      ],
      fx: [{ month: '2026-09', arsPerUsd: 1000 }],
    }, 'Grupo Familia', 'ARS');
    expect(m!.expenses).toBe(0);
    expect(m!.result).toBe(13000);
  });

  it('el neto a pagar de cada grupo es el ingreso, y el dólar cable va aparte', () => {
    let h = emptyHistory();
    h = applyImport(h, {
      alyc: 'IEB',
      filename: 'priv.xlsx',
      segment: 'aranceles_privado',
      format: 'ieb',
      rows: [row('1', 1000, 'ARS'), row('2', 10, 'USD'), row('3', 2, 'USD_EXT')],
    }).history;
    const tagged = h.commissions.map((c, i) => ({ ...c, grupo_asesor: i === 0 ? 'Grupo Familia' : null }));
    const income = collectIncome(tagged, defaultSettings());
    const familia = income.find((c) => c.grupo === 'Grupo Familia');
    const sueltos = income.find((c) => c.grupo === null);
    expect(familia?.ars).toBeGreaterThan(0);
    expect(familia?.usd).toBe(0);
    expect(sueltos?.usd).toBeGreaterThan(0);
    expect(sueltos?.cable).toBeGreaterThan(0);
    expect(sueltos!.usd).not.toBeCloseTo(sueltos!.cable);
  });

  it('descarta un socio sin nombre y un tipo de cambio en cero', () => {
    const config = coerceBalances({
      partners: [
        { id: 'a', name: 'Ana', grupo: 'Grupo Familia', equity: 0.5, profit: 0.5 },
        { id: '', name: 'Nadie', equity: 1, profit: 1 },
        { id: 'b', name: 'Fuera', equity: 2, profit: 0 },
      ],
      expenses: [{ id: 'e', grupo: null, kind: 'sueldo', label: 'Sueldo', month: '2026-9', currency: 'ARS', amount: 10 }],
      fx: [
        { month: '2026-09', arsPerUsd: 0 },
        { month: '2026-09', arsPerUsd: 1400 },
        { month: '2026-10', arsPerUsd: 1450 },
      ],
    });
    expect(config.partners.map((p) => p.name)).toEqual(['Ana']);
    expect(config.expenses).toEqual([]);
    expect(config.fx).toEqual([
      { month: '2026-09', arsPerUsd: 1400 },
      { month: '2026-10', arsPerUsd: 1450 },
    ]);
  });
});
