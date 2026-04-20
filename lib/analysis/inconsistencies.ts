import type { Position } from '@/lib/schema';
import { WARNING_CODES } from '@/lib/schema';

export type InconsistencyTipo =
  | 'precio_distinto'
  | 'cantidad_negativa'
  | 'fecha_desalineada'
  | 'duplicado_titular'
  | 'ticker_sin_clasificar'
  | 'titular_sin_mapear'
  | 'cash_negativo'
  | 'posicion_residual';

export type Inconsistency = {
  tipo: InconsistencyTipo;
  severity: 'error' | 'warning' | 'info';
  descripcion: string;
  posiciones_afectadas: number[];
  broker?: string;
  ticker?: string;
};

function hasWarning(p: Position, code: string): boolean {
  return p.warnings.some((w) => w === code || w.startsWith(`${code}:`));
}

function parseDay(d: string): number {
  return new Date(d + 'T12:00:00Z').getTime();
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((parseDay(a) - parseDay(b)) / 86_400_000));
}

/** Precio representativo por broker dentro de un grupo (media de precios > 0). */
function meanPriceForBroker(positions: Position[], indices: number[], broker: string): number | null {
  const vals: number[] = [];
  for (const i of indices) {
    const p = positions[i]!;
    if (p.broker !== broker) continue;
    const pr = p.precio_mercado;
    if (pr != null && pr > 0) vals.push(pr);
  }
  if (vals.length === 0) return null;
  return vals.reduce((s, x) => s + x, 0) / vals.length;
}

export function detectInconsistencies(positions: Position[]): Inconsistency[] {
  const out: Inconsistency[] = [];

  // 1) Precios distintos entre brokers: mismo ticker + fecha, precio relativo > 2%
  const byTickerFecha = new Map<string, number[]>();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const t = p.ticker?.trim();
    if (!t) continue;
    const k = `${t}|${p.fecha_reporte}`;
    let arr = byTickerFecha.get(k);
    if (!arr) {
      arr = [];
      byTickerFecha.set(k, arr);
    }
    arr.push(i);
  }
  for (const [k, indices] of byTickerFecha) {
    if (indices.length < 2) continue;
    const brokers = new Set<string>();
    for (const i of indices) {
      brokers.add(positions[i]!.broker);
    }
    if (brokers.size < 2) continue;
    const brokerMeans: { b: string; m: number }[] = [];
    for (const b of brokers) {
      const m = meanPriceForBroker(positions, indices, b);
      if (m != null) brokerMeans.push({ b, m });
    }
    if (brokerMeans.length < 2) continue;
    const prices = brokerMeans.map((x) => x.m);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    if (minP <= 0) continue;
    if ((maxP - minP) / minP > 0.02) {
      const [ticker, fecha] = k.split('|');
      const divergent = brokerMeans
        .sort((a, b) => a.m - b.m)
        .map((x) => `${x.b}: ${x.m.toFixed(4)}`)
        .join(' · ');
      out.push({
        tipo: 'precio_distinto',
        severity: 'warning',
        descripcion: `Precio de mercado diverge >2% entre brokers para ${ticker} (${fecha}). ${divergent}`,
        posiciones_afectadas: [...indices],
        ticker,
      });
    }
  }

  // 2) Cantidad negativa inesperada
  const negQty: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    if (p.cantidad < 0 && p.clase_activo !== 'option') negQty.push(i);
  }
  if (negQty.length > 0) {
    out.push({
      tipo: 'cantidad_negativa',
      severity: 'error',
      descripcion: `${negQty.length} posición(es) con cantidad < 0 y clase distinta de option (revisar short no etiquetado).`,
      posiciones_afectadas: negQty,
    });
  }

  // 3) Fechas desalineadas (>2 días entre fechas de reporte)
  const fechas = [...new Set(positions.map((p) => p.fecha_reporte))].sort();
  if (fechas.length >= 2) {
    let spread = 0;
    for (let a = 0; a < fechas.length; a++) {
      for (let b = a + 1; b < fechas.length; b++) {
        spread = Math.max(spread, dayDiff(fechas[a]!, fechas[b]!));
      }
    }
    if (spread > 2) {
      const counts = new Map<string, number>();
      for (const p of positions) {
        counts.set(p.fecha_reporte, (counts.get(p.fecha_reporte) ?? 0) + 1);
      }
      let mode = fechas[0]!;
      let maxC = 0;
      for (const [f, c] of counts) {
        if (c > maxC) {
          maxC = c;
          mode = f;
        }
      }
      const bad: number[] = [];
      for (let i = 0; i < positions.length; i++) {
        if (positions[i]!.fecha_reporte !== mode) bad.push(i);
      }
      if (bad.length > 0) {
        out.push({
          tipo: 'fecha_desalineada',
          severity: 'warning',
          descripcion: `Fechas de reporte con hasta ${spread} días de diferencia. Referencia (moda): ${mode}. Revisá ${bad.length} posición(es) con otra fecha.`,
          posiciones_afectadas: bad,
        });
      }
    }
  }

  // 4) Tickers sin clasificar
  const tickUnk: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    // Mantener consistencia con feedGlossary: cash/CASH no van al glosario pendiente.
    const isCashLike = p.clase_activo === 'cash' || p.ticker?.toUpperCase() === 'CASH';
    if (!isCashLike && hasWarning(p, WARNING_CODES.TICKER_NO_CONFIRMADO)) tickUnk.push(i);
  }
  if (tickUnk.length > 0) {
    out.push({
      tipo: 'ticker_sin_clasificar',
      severity: 'warning',
      descripcion: `${tickUnk.length} posición(es) con ticker no confirmado en glosario (${WARNING_CODES.TICKER_NO_CONFIRMADO}).`,
      posiciones_afectadas: tickUnk,
    });
  }

  // 5) Titulares sin mapear
  const titMap: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (hasWarning(positions[i]!, WARNING_CODES.TITULAR_NO_MAPEADO)) titMap.push(i);
  }
  if (titMap.length > 0) {
    out.push({
      tipo: 'titular_sin_mapear',
      severity: 'warning',
      descripcion: `${titMap.length} posición(es) con cuenta/titular sin mapping (${WARNING_CODES.TITULAR_NO_MAPEADO}).`,
      posiciones_afectadas: titMap,
    });
  }

  // 6) Cash negativo
  const cashNeg: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    if (p.clase_activo === 'cash' && (p.valor_mercado_usd ?? 0) < 0) cashNeg.push(i);
  }
  if (cashNeg.length > 0) {
    out.push({
      tipo: 'cash_negativo',
      severity: 'error',
      descripcion: `${cashNeg.length} línea(s) de cash con valor USD negativo.`,
      posiciones_afectadas: cashNeg,
    });
  }

  // 7) Posiciones residuales (monto casi cero)
  const residual: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i]!.valor_mercado_usd;
    const usd = v ?? 0;
    if (Math.abs(usd) < 1) residual.push(i);
  }
  if (residual.length > 0) {
    out.push({
      tipo: 'posicion_residual',
      severity: 'info',
      descripcion: `${residual.length} posición(es) con |valor USD| menor a 1 (residual / redondeo).`,
      posiciones_afectadas: residual,
    });
  }

  // 8) Duplicado titular: mismo titular_normalizado, distintos cliente_id
  const byTit = new Map<string, Set<string>>();
  for (const p of positions) {
    const k = p.titular_normalizado;
    let s = byTit.get(k);
    if (!s) {
      s = new Set<string>();
      byTit.set(k, s);
    }
    s.add(p.cliente_id);
  }
  for (const [titNorm, ids] of byTit) {
    if (ids.size <= 1) continue;
    const dupIdx: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      if (positions[i]!.titular_normalizado === titNorm) dupIdx.push(i);
    }
    const label = positions[dupIdx[0]!]!.titular;
    out.push({
      tipo: 'duplicado_titular',
      severity: 'warning',
      descripcion: `Titular «${label}» aparece con ${ids.size} cliente_id distintos (${[...ids].join(', ')}). Revisar aliases / mapping.`,
      posiciones_afectadas: dupIdx,
    });
  }

  return out;
}
