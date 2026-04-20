import type { ClaseActivo, Position } from '@/lib/schema';

/** Suma `valor_mercado_usd` por clave devuelta por `fieldFn`. */
export function aggregateByField(
  positions: Position[],
  fieldFn: (p: Position) => string
): Record<string, number> {
  return positions.reduce<Record<string, number>>((acc, p) => {
    const key = fieldFn(p);
    const v = p.valor_mercado_usd ?? 0;
    acc[key] = (acc[key] ?? 0) + v;
    return acc;
  }, {});
}

export function totalAumUsd(positions: Position[]): number {
  return positions.reduce((s, p) => s + (p.valor_mercado_usd ?? 0), 0);
}

/** Clave moneda + subtipo (ej. ARS (MEP)). */
export function monedaDimensionKey(p: Position): string {
  if (p.moneda_subtipo) return `${p.moneda} (${p.moneda_subtipo})`;
  return p.moneda;
}

export function topPositions(positions: Position[], n: number, excludeCash: boolean): Position[] {
  let list = [...positions];
  if (excludeCash) list = list.filter((p) => p.clase_activo !== 'cash');
  return list
    .sort((a, b) => (b.valor_mercado_usd ?? 0) - (a.valor_mercado_usd ?? 0))
    .slice(0, n);
}

export interface TopClientRow {
  cliente_id: string;
  titular: string;
  aum_usd: number;
  pct: number;
  brokers_count: number;
}

export function topClients(positions: Position[], n: number): TopClientRow[] {
  const total = totalAumUsd(positions);
  const map = new Map<string, { titular: string; aum: number; brokers: Set<string> }>();
  for (const p of positions) {
    let e = map.get(p.cliente_id);
    if (!e) {
      e = { titular: p.titular, aum: 0, brokers: new Set<string>() };
      map.set(p.cliente_id, e);
    }
    e.aum += p.valor_mercado_usd ?? 0;
    e.brokers.add(p.broker);
  }
  const rows: TopClientRow[] = [...map.entries()].map(([cliente_id, v]) => ({
    cliente_id,
    titular: v.titular,
    aum_usd: v.aum,
    pct: total > 0 ? (v.aum / total) * 100 : 0,
    brokers_count: v.brokers.size,
  }));
  rows.sort((a, b) => b.aum_usd - a.aum_usd);
  return rows.slice(0, n);
}

export interface ConcentrationFlag {
  type: 'position' | 'cliente';
  description: string;
  value: number;
  threshold: number;
}

export function concentrationFlags(
  positions: Position[],
  thresholds: { positionPct: number; clientPct: number }
): ConcentrationFlag[] {
  const total = totalAumUsd(positions);
  if (total <= 0) return [];
  const flags: ConcentrationFlag[] = [];

  const byInstrument = aggregateInstrumentGroups(positions, true);
  for (const row of byInstrument) {
    const pct = (row.valor_usd / total) * 100;
    if (pct > thresholds.positionPct) {
      flags.push({
        type: 'position',
        description: row.ticker ? `${row.ticker} — ${row.descripcion.slice(0, 80)}` : row.descripcion.slice(0, 120),
        value: pct,
        threshold: thresholds.positionPct,
      });
    }
  }

  const totalForClients = total;
  const cmap = new Map<string, { titular: string; aum: number }>();
  for (const p of positions) {
    let e = cmap.get(p.cliente_id);
    if (!e) {
      e = { titular: p.titular, aum: 0 };
      cmap.set(p.cliente_id, e);
    }
    e.aum += p.valor_mercado_usd ?? 0;
  }
  for (const [, e] of cmap) {
    const pct = totalForClients > 0 ? (e.aum / totalForClients) * 100 : 0;
    if (pct > thresholds.clientPct) {
      flags.push({
        type: 'cliente',
        description: e.titular,
        value: pct,
        threshold: thresholds.clientPct,
      });
    }
  }

  return flags;
}

export function instrumentKey(p: Position): string {
  if (p.ticker) return `T:${p.ticker.trim()}`;
  if (p.isin) return `I:${p.isin.trim()}`;
  return `D:${p.descripcion.trim()}`;
}

export function uniqueInstrumentsCount(positions: Position[]): number {
  const s = new Set<string>();
  for (const p of positions) s.add(instrumentKey(p));
  return s.size;
}

export interface InstrumentGroupRow {
  key: string;
  ticker: string | null;
  descripcion: string;
  clase_activo: ClaseActivo;
  valor_usd: number;
  pct_book: number;
  titulares_count: number;
}

/** Agrupa por ticker / ISIN / descripción; útil para concentración por instrumento. */
export function aggregateInstrumentGroups(
  positions: Position[],
  excludeCash: boolean
): InstrumentGroupRow[] {
  let list = [...positions];
  if (excludeCash) list = list.filter((p) => p.clase_activo !== 'cash');
  const total = totalAumUsd(list);
  type Agg = {
    ticker: string | null;
    descripcion: string;
    valor: number;
    titulares: Set<string>;
    clase_por_usd: Map<ClaseActivo, number>;
  };
  const map = new Map<string, Agg>();
  for (const p of list) {
    const k = instrumentKey(p);
    let a = map.get(k);
    if (!a) {
      a = {
        ticker: p.ticker,
        descripcion: p.descripcion,
        valor: 0,
        titulares: new Set<string>(),
        clase_por_usd: new Map(),
      };
      map.set(k, a);
    }
    const v = p.valor_mercado_usd ?? 0;
    a.valor += v;
    a.titulares.add(p.cliente_id);
    a.clase_por_usd.set(p.clase_activo, (a.clase_por_usd.get(p.clase_activo) ?? 0) + v);
    if (!a.ticker && p.ticker) a.ticker = p.ticker;
  }
  const rows: InstrumentGroupRow[] = [];
  for (const [key, a] of map) {
    let clase: ClaseActivo = 'other';
    let maxUsd = 0;
    for (const [c, u] of a.clase_por_usd) {
      if (u > maxUsd) {
        maxUsd = u;
        clase = c;
      }
    }
    rows.push({
      key,
      ticker: a.ticker,
      descripcion: a.descripcion,
      clase_activo: clase,
      valor_usd: a.valor,
      pct_book: total > 0 ? (a.valor / total) * 100 : 0,
      titulares_count: a.titulares.size,
    });
  }
  rows.sort((x, y) => y.valor_usd - x.valor_usd);
  return rows;
}

export function topInstrumentGroups(positions: Position[], n: number, excludeCash: boolean): InstrumentGroupRow[] {
  return aggregateInstrumentGroups(positions, excludeCash).slice(0, n);
}
