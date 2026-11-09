import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExposureSnapshot } from '@/components/exposure/snapshot';
import type { ExposureAccount } from '@/lib/exposure/types';

const account: ExposureAccount = {
  id: 'MS::1',
  name: '1',
  broker: 'MS',
  cuenta: '111',
  titular: 'Ana',
  grupoId: null,
  asset: [100, 0, 0, 0],
  region: [100, 0, 0, 0, 0, 0],
  direct: { MSFT: 100 },
  etf: {},
  lines: [
    {
      ticker: 'MSFT',
      name: 'Microsoft',
      amount: 100,
      asset: 0,
      region: 0,
      sector: 0,
      vehicle: 'direct',
    },
  ],
  unclassified: 0,
};

describe('pantallazo', () => {
  it('dibuja el consolidado y la cuenta', () => {
    const html = renderToStaticMarkup(createElement(ExposureSnapshot, { accounts: [account], fechas: ['2026-11-06'] }));
    expect(html).toContain('Consolidado');
    expect(html).toContain('111');
    expect(html).toContain('Look-through de ETFs');
    expect(html).toContain('Posiciones al 06/11/2026');
    expect(html).toContain('Renta variable');
  });
});
