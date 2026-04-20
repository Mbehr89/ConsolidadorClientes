import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format number as currency
 */
export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format number as currency with decimals
 */
export function formatCurrencyPrecise(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format percentage
 */
export function formatPct(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format large numbers with K/M/B suffix
 */
export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function brokerColorClass(broker: string): string {
  switch (broker) {
    case 'MS':
      return 'broker-ms';
    case 'NETX360':
      return 'broker-netx360';
    case 'IEB':
      return 'broker-ieb';
    case 'GMA':
      return 'broker-gma';
    default:
      return '';
  }
}

export function titularTipoClass(tipo: 'persona' | 'juridica'): string {
  return tipo === 'juridica' ? 'titular-juridica' : 'titular-persona';
}
