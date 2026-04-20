/**
 * Broker metadata — info estática para clasificación fiscal y análisis.
 * Ampliar cuando se sume IBKR o un 5to broker.
 */
import type { BrokerCode } from './schema';

export interface BrokerMeta {
  code: BrokerCode;
  nombre: string;
  pais: 'AR' | 'US';
  tipo: 'local' | 'offshore';
  moneda_nativa: string; // ISO 4217
  /** Formato de fecha que usa el broker en sus reportes */
  date_format: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'native' | 'manual';
  /** Si el broker requiere mapping externo cuenta→titular */
  requiere_mapping_titular: boolean;
  /** Si el broker trae FX por fila */
  trae_fx_por_fila: boolean;
}

export const BROKERS: Record<BrokerCode, BrokerMeta> = {
  MS: {
    code: 'MS',
    nombre: 'Morgan Stanley',
    pais: 'US',
    tipo: 'offshore',
    moneda_nativa: 'USD',
    date_format: 'MM/DD/YYYY',
    requiere_mapping_titular: true,
    trae_fx_por_fila: false,
  },
  NETX360: {
    code: 'NETX360',
    nombre: 'Netx360 (Pershing / BNY Mellon)',
    pais: 'US',
    tipo: 'offshore',
    moneda_nativa: 'USD',
    date_format: 'native', // Excel Timestamp objects
    requiere_mapping_titular: false,
    trae_fx_por_fila: false,
  },
  GMA: {
    code: 'GMA',
    nombre: 'GMA',
    pais: 'AR',
    tipo: 'local',
    moneda_nativa: 'ARS',
    date_format: 'DD/MM/YYYY',
    requiere_mapping_titular: true,
    trae_fx_por_fila: true, // col 8: Cotización Moneda Local
  },
  IEB: {
    code: 'IEB',
    nombre: 'IEB (Invertir en Bolsa)',
    pais: 'AR',
    tipo: 'local',
    moneda_nativa: 'ARS',
    date_format: 'manual', // no trae fecha, popup obligatorio
    requiere_mapping_titular: false,
    trae_fx_por_fila: true, // columna TipoCambio (tasa ARS/USD por fila)
  },
} as const;

/**
 * Helper: devuelve si un broker es offshore (implicancia fiscal AR)
 */
export function isOffshore(broker: BrokerCode): boolean {
  return BROKERS[broker].tipo === 'offshore';
}

/**
 * Helper: lista de brokers que requieren mapping cuenta→titular
 */
export function brokersRequiringMapping(): BrokerCode[] {
  return (Object.keys(BROKERS) as BrokerCode[]).filter(
    (code) => BROKERS[code].requiere_mapping_titular
  );
}
