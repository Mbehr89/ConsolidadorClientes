import type { Position } from './schema';
import {
  isLocalEquityOrEtfQuotedInPesos,
  isOffshore,
  statementUnitPriceCurrency,
} from './brokers';

const NUM_OPTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
};

/** Precio unitario ARS tal como conviene mostrarlo en tablas de posición. */
export function formatArsPrice(p: Position): string {
  if (isOffshore(p.broker)) return '—';
  if (
    statementUnitPriceCurrency(p.broker, p.clase_activo, p.moneda) === 'ARS' &&
    p.precio_mercado != null &&
    Number.isFinite(p.precio_mercado)
  ) {
    return `${p.precio_mercado.toLocaleString('es-AR', NUM_OPTS)} ARS`;
  }
  if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || !Number.isFinite(p.valor_mercado_local)) return '—';
  const arsPrice = p.valor_mercado_local / p.cantidad;
  if (!Number.isFinite(arsPrice)) return '—';
  return `${arsPrice.toLocaleString('es-AR', NUM_OPTS)} ARS`;
}

/** Precio unitario USD (offshore: archivo en USD; local equity/ETF: implícito desde valuación USD). */
export function formatUsdPrice(p: Position): string {
  if (isOffshore(p.broker)) {
    if (p.precio_mercado != null && Number.isFinite(p.precio_mercado)) {
      return `${p.precio_mercado.toLocaleString('es-AR', NUM_OPTS)} USD`;
    }
    if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || p.valor_mercado_usd == null) return '—';
    const usdPrice = p.valor_mercado_usd / p.cantidad;
    if (!Number.isFinite(usdPrice)) return '—';
    return `${usdPrice.toLocaleString('es-AR', NUM_OPTS)} USD`;
  }
  if (isLocalEquityOrEtfQuotedInPesos(p.broker, p.clase_activo)) {
    if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || p.valor_mercado_usd == null) return '—';
    const usdPrice = p.valor_mercado_usd / p.cantidad;
    if (!Number.isFinite(usdPrice)) return '—';
    return `${usdPrice.toLocaleString('es-AR', NUM_OPTS)} USD`;
  }
  if (
    statementUnitPriceCurrency(p.broker, p.clase_activo, p.moneda) === 'USD' &&
    p.precio_mercado != null &&
    Number.isFinite(p.precio_mercado)
  ) {
    return `${p.precio_mercado.toLocaleString('es-AR', NUM_OPTS)} USD`;
  }
  if (!Number.isFinite(p.cantidad) || p.cantidad === 0 || p.valor_mercado_usd == null) return '—';
  const usdPrice = p.valor_mercado_usd / p.cantidad;
  if (!Number.isFinite(usdPrice)) return '—';
  return `${usdPrice.toLocaleString('es-AR', NUM_OPTS)} USD`;
}
