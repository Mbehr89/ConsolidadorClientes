import type { ArancelCommission, TradingGroup } from '@/lib/aranceles/types';

/** Boletos del mismo comitente cuya numeración salta como mucho esto se consideran consecutivos. */
export const TRADING_MAX_GAP = 3;
/** Diferencia relativa máxima entre ventas y compras (importe o cantidad). */
export const TRADING_TOLERANCE = 0.05;

type Side = 'buy' | 'sell';
type Candidate = { c: ArancelCommission; n: number; side: Side; gross: number; qty: number; instrument: string };

export function tradingSide(operation: string | null): Side | null {
  const op = (operation ?? '').trim().toUpperCase();
  if (op === 'COMPRA') return 'buy';
  if (op === 'VENTA') return 'sell';
  return null;
}

/** USD y USD (EXT) son dólares: sus importes se pueden sumar entre sí, no con pesos. */
function currencyFamily(currency: string): string {
  return currency.startsWith('USD') ? 'USD' : currency;
}

/** Misma especie en otra moneda: "AL30D" / "AL30C" → "AL30", "GGALD" → "GGAL". */
function baseInstrument(instrument: string | null): string {
  const s = (instrument ?? '').trim().toUpperCase();
  return s.length >= 5 && /[DC]$/.test(s) ? s.slice(0, -1) : s;
}

function balanced(sells: number, buys: number): boolean {
  if (sells <= 0 || buys <= 0) return false;
  return Math.abs(sells - buys) / Math.max(sells, buys) <= TRADING_TOLERANCE;
}

/** Corta en tramos donde cada boleto está a ≤ TRADING_MAX_GAP del anterior. */
function runs(sorted: Candidate[]): Candidate[][] {
  const out: Candidate[][] = [];
  let current: Candidate[] = [];
  for (const x of sorted) {
    const prev = current[current.length - 1];
    if (prev && x.n - prev.n > TRADING_MAX_GAP) {
      out.push(current);
      current = [];
    }
    current.push(x);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Dentro de cada tramo toma, de izquierda a derecha, la ventana más corta que equilibra. `measure` da el
 * valor de cada boleto y `accepts` puede descartar una ventana (y las más largas desde ese inicio).
 */
function matchWindows(
  run: Candidate[],
  measure: (x: Candidate) => number,
  accepts: (window: Candidate[]) => 'ok' | 'skip' | 'stop'
): { members: Candidate[]; sells: number; buys: number }[] {
  const out: { members: Candidate[]; sells: number; buys: number }[] = [];
  let i = 0;
  while (i < run.length) {
    let sells = 0;
    let buys = 0;
    let matchedAt = -1;
    for (let j = i; j < run.length; j++) {
      const x = run[j]!;
      if (x.side === 'sell') sells += measure(x);
      else buys += measure(x);
      if (j === i) continue;
      const verdict = accepts(run.slice(i, j + 1));
      if (verdict === 'stop') break;
      if (verdict === 'ok' && balanced(sells, buys)) {
        matchedAt = j;
        break;
      }
    }
    if (matchedAt < 0) {
      i += 1;
      continue;
    }
    out.push({ members: run.slice(i, matchedAt + 1), sells, buys });
    i = matchedAt + 1;
  }
  return out;
}

/**
 * Boletos del mismo día que no son seguidos: si todas las compras compensan todas las ventas va un solo
 * grupo; si no, se arman pares compra–venta, del más parecido al menos. `pairable` exige, p. ej., que
 * las dos patas sean de monedas distintas.
 */
function matchSameDay(
  legs: Candidate[],
  measure: (x: Candidate) => number,
  pairable: (a: Candidate, b: Candidate) => boolean
): { members: Candidate[]; sells: number; buys: number }[] {
  const buysAll = legs.filter((x) => x.side === 'buy');
  const sellsAll = legs.filter((x) => x.side === 'sell');
  if (buysAll.length === 0 || sellsAll.length === 0) return [];
  const sum = (xs: Candidate[]) => xs.reduce((s, x) => s + measure(x), 0);
  const wholeOk = legs.some((a) => legs.some((b) => a.side !== b.side && pairable(a, b)));
  if (wholeOk && balanced(sum(sellsAll), sum(buysAll))) {
    return [{ members: legs, sells: sum(sellsAll), buys: sum(buysAll) }];
  }
  const pairs: { buy: Candidate; sell: Candidate; diff: number }[] = [];
  for (const b of buysAll) {
    for (const s of sellsAll) {
      if (!pairable(b, s) || !balanced(measure(s), measure(b))) continue;
      pairs.push({ buy: b, sell: s, diff: Math.abs(measure(s) - measure(b)) / Math.max(measure(s), measure(b)) });
    }
  }
  pairs.sort((x, y) => x.diff - y.diff || x.buy.n - y.buy.n);
  const used = new Set<string>();
  const out: { members: Candidate[]; sells: number; buys: number }[] = [];
  for (const p of pairs) {
    if (used.has(p.buy.c.id) || used.has(p.sell.c.id)) continue;
    used.add(p.buy.c.id);
    used.add(p.sell.c.id);
    out.push({ members: [p.buy, p.sell], sells: measure(p.sell), buys: measure(p.buy) });
  }
  return out;
}

/**
 * Posible trading (GMA): compras y ventas del mismo comitente y día que se compensan. Suelen cobrar una
 * sola comisión (o una menor), así que se señalan.
 * 1. Con monedas distintas (p. ej. dólar MEP / cable: compra AL30 en USD y vende AL30 en pesos) los
 *    importes no se comparan: tiene que ser la misma especie y compensarse las cantidades.
 * 2. Con la misma moneda (USD y USD (EXT) cuentan juntos), se compensan los importes.
 * Primero se buscan boletos seguidos; con lo que queda, cualquier boleto del mismo día (`consecutive: false`).
 */
export function detectTradingGroups(
  commissions: readonly ArancelCommission[],
  gmaImportIds: ReadonlySet<string>
): ArancelCommission[] {
  const buckets = new Map<string, Candidate[]>();
  for (const c of commissions) {
    if (!gmaImportIds.has(c.import_id)) continue;
    const s = tradingSide(c.operation);
    const n = Number(c.op_number);
    if (!s || !Number.isFinite(n) || c.amount == null || c.amount === 0) continue;
    const k = `${c.alyc.toLowerCase()}|${c.client_key}|${c.trade_date}`;
    const list = buckets.get(k) ?? [];
    list.push({
      c,
      n,
      side: s,
      gross: Math.abs(c.amount),
      qty: Math.abs(c.quantity ?? 0),
      instrument: baseInstrument(c.instrument),
    });
    buckets.set(k, list);
  }

  const groupById = new Map<string, TradingGroup>();
  const assign = (
    members: Candidate[],
    sells: number,
    buys: number,
    basis: TradingGroup['basis'],
    consecutive = true
  ) => {
    const sorted = [...members].sort((a, b) => a.n - b.n);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const group: TradingGroup = {
      id: `${first.c.client_key}|${first.c.trade_date}|${consecutive ? '' : 'dia:'}${first.n}-${last.n}`,
      from: String(first.n),
      to: String(last.n),
      sells,
      buys,
      basis,
      instrument: basis === 'cantidad' ? first.instrument : null,
      consecutive,
    };
    for (const m of sorted) groupById.set(m.c.id, group);
  };
  const unassigned = (xs: Candidate[]) => xs.filter((x) => !groupById.has(x.c.id));

  for (const list of buckets.values()) {
    list.sort((a, b) => a.n - b.n);

    for (const run of runs(list)) {
      const matches = matchWindows(
        run,
        (x) => x.qty,
        (w) => {
          if (!w[0]!.instrument || w.some((x) => x.instrument !== w[0]!.instrument || x.qty <= 0)) return 'stop';
          return new Set(w.map((x) => x.c.currency)).size > 1 ? 'ok' : 'skip';
        }
      );
      for (const m of matches) assign(m.members, m.sells, m.buys, 'cantidad');
    }

    const byFamily = new Map<string, Candidate[]>();
    for (const x of list) {
      if (groupById.has(x.c.id)) continue;
      const f = currencyFamily(x.c.currency);
      byFamily.set(f, [...(byFamily.get(f) ?? []), x]);
    }
    for (const familyList of byFamily.values()) {
      for (const run of runs(familyList)) {
        for (const m of matchWindows(run, (x) => x.gross, () => 'ok')) assign(m.members, m.sells, m.buys, 'importe');
      }
    }

    // Mismo día aunque los boletos no sean seguidos: misma especie en monedas distintas (por cantidad)…
    const byInstrument = new Map<string, Candidate[]>();
    for (const x of unassigned(list)) {
      if (!x.instrument || x.qty <= 0) continue;
      byInstrument.set(x.instrument, [...(byInstrument.get(x.instrument) ?? []), x]);
    }
    for (const legs of byInstrument.values()) {
      for (const m of matchSameDay(legs, (x) => x.qty, (a, b) => a.c.currency !== b.c.currency)) {
        assign(m.members, m.sells, m.buys, 'cantidad', false);
      }
    }
    // …y misma moneda (por importe).
    const leftByFamily = new Map<string, Candidate[]>();
    for (const x of unassigned(list)) {
      const f = currencyFamily(x.c.currency);
      leftByFamily.set(f, [...(leftByFamily.get(f) ?? []), x]);
    }
    for (const legs of leftByFamily.values()) {
      for (const m of matchSameDay(legs, (x) => x.gross, () => true)) assign(m.members, m.sells, m.buys, 'importe', false);
    }
  }

  return commissions.map((c) => {
    const group = groupById.get(c.id) ?? null;
    if ((c.trading_group ?? null) === null && group === null) return c;
    return { ...c, trading_group: group };
  });
}
