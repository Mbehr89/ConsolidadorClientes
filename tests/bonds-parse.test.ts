import { describe, expect, it } from 'vitest';
import { parseBondPaymentCalendarCsv, parseNumber } from '@/lib/bonds/parse-calendar';

describe('parseBondPaymentCalendarCsv', () => {
  it('parses minimal semicolon csv with required columns', () => {
    const csv = [
      'Fecha;Ticker;Flujo c/100 vn total',
      '01/01/2026;AL30;5',
      '01/07/2026;AL30;105',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(2);
    expect(ev[0]?.asset).toBe('AL30');
    expect(ev[0]?.flowPer100).toBe(5);
  });

  it('reads issuer from Base Emisor / Emisor column', () => {
    const csv = [
      'Fecha;Base Emisor;Ticker;Flujo c/100 vn total',
      '01/01/2026;Arcor;ARCO7;5',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(1);
    expect(ev[0]?.issuer).toBe('Arcor');
    expect(ev[0]?.asset).toBe('ARCO7');
  });

  it('maps coupon/amort/residual from J/K/L style columns', () => {
    const csv = [
      'Fecha;Base Emisor;Ticker;Interes (vn);Amortizacion (vn);Valor residual;Flujo de fondos c/100 vn total',
      '06/04/2026;Arcor;RC2CO;2,94%;;100,00%;2,94',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(1);
    expect(ev[0]?.couponPer100).toBeCloseTo(2.94, 6);
    expect(ev[0]?.amortizationPer100).toBeUndefined();
    expect(ev[0]?.residualPctOfPar).toBeCloseTo(100, 6);
    expect(ev[0]?.flowPer100).toBeCloseTo(2.94, 6);
  });

  it('parses decimal flow values without scale inflation', () => {
    const csv = [
      'Fecha;Ticker;Flujo c/100 vn total',
      '01/01/2026;AL30;39.82265971',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(1);
    expect(ev[0]?.flowPer100).toBeCloseTo(39.82265971, 8);
  });

  it('prefers c/100 vn flow over flujo total monetary column', () => {
    const csv = [
      'Fecha;Ticker;Flujo de fondos c/100 vn;Flujo de fondos total',
      '22/04/2026;AL30;9,50;28649964,81',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(1);
    expect(ev[0]?.flowPer100).toBeCloseTo(9.5, 6);
  });

  it('maps grouped two-row header total inside c/100 block', () => {
    const csv = [
      'Fecha,Base,,,Moneda,,Período,,Interés,,Amortización,,Factores,,,Flujo de fondos c/100 vn,,,Flujo de fondos total,,',
      'Efectiva,Emisor,Ticker,VN,Mon. pago,Mon. denom.,Base,Días,Tasa de int.,Interés (vn),Amortización (vn),Valor residual,Referencias,Índ./TC,Aj. capital,Interés,Amortización,Total,Interés,Amortización,Total',
      '6/4/2026,Arcor,RC2CO,\"100000000,00\",USD,USD,\"365,00\",\"182,00\",\"5,90%\",\"2,94%\",,\"100,00%\",,,,\"2,94\",,\"2,94\",\"2941917,81\",,\"2941917,81\"',
    ].join('\n');
    const ev = parseBondPaymentCalendarCsv(csv);
    expect(ev.length).toBe(1);
    expect(ev[0]?.flowPer100).toBeCloseTo(2.94, 6);
  });
});

describe('parseNumber', () => {
  it('supports locale separators in both styles', () => {
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56, 6);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56, 6);
    expect(parseNumber('39.82265971')).toBeCloseTo(39.82265971, 8);
    expect(parseNumber('39,82265971')).toBeCloseTo(39.82265971, 8);
  });
});
