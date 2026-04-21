import { describe, expect, it } from 'vitest';
import { parseBondPaymentCalendarCsv } from '@/lib/bonds/parse-calendar';

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
});
