import type { Position } from '@/lib/schema';
import { isCashBucketPosition } from '@/lib/cash-buckets';
import { computeBondYieldMetrics } from './metrics';
import { normalizeBondTicker, tickerEligibleForBondYield } from './ticker-normalize';
import type { BondPaymentEvent, BondYieldMetrics } from './types';

const YIELD_CLASSES = new Set(['bond', 'on', 'letra']);

/** Solo bonos / ON / letras reales: cash y MM no tienen TIR ni duration de calendario. */
export function isBondYieldPosition(p: Position): boolean {
  if (isCashBucketPosition(p)) return false;
  if (!YIELD_CLASSES.has(p.clase_activo)) return false;
  return tickerEligibleForBondYield(p.ticker);
}

/**
 * Misma metodología de precio sucio que en ficha cliente.
 * Devuelve null si el instrumento no debe tener TIR/duration (cash, equity, etc.).
 */
export function computeBondYieldMetricsForPosition(
  p: Position,
  events: BondPaymentEvent[],
  valuationDate: Date
): BondYieldMetrics | null {
  if (!isBondYieldPosition(p)) return null;
  const ticker = normalizeBondTicker(p.ticker);
  const nominal = Number.isFinite(p.cantidad) && p.cantidad > 0 ? p.cantidad : 100;
  const fxFromPosition =
    p.valor_mercado_usd != null && p.valor_mercado_usd > 0 && p.valor_mercado_local > 0
      ? p.valor_mercado_local / p.valor_mercado_usd
      : 1;
  const usdArsFxRate = Number.isFinite(fxFromPosition) && fxFromPosition > 0 ? fxFromPosition : 1;
  const unitPriceUsdFromStatement =
    p.precio_mercado != null && Number.isFinite(p.precio_mercado)
      ? p.moneda === 'USD'
        ? p.precio_mercado
        : p.precio_mercado / usdArsFxRate
      : null;
  const unitPriceUsdFromValuation =
    nominal > 0 && p.valor_mercado_usd != null && Number.isFinite(p.valor_mercado_usd)
      ? p.valor_mercado_usd / nominal
      : null;
  const unitPriceUsd = unitPriceUsdFromStatement ?? unitPriceUsdFromValuation;
  if (unitPriceUsd == null || !Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) return null;
  const dirtyPricePer100 = unitPriceUsd * 100;
  return computeBondYieldMetrics(events, ticker, valuationDate, dirtyPricePer100, nominal, usdArsFxRate);
}
