export interface PdfReportData {
  subtitle: string;
  /** Texto legible para la portada */
  reportDateLabel: string;
  /** Fecha usada en el disclaimer (última fecha de reporte o hoy) */
  quoteDate: string;
  totalAum: number;
  byBroker: { code: string; name: string; aum: number; pct: number }[];
  byClase: { key: string; aum: number; pct: number }[];
  topPositions: {
    ticker: string;
    desc: string;
    clase: string;
    broker: string;
    qty: number;
    usd: number;
    pct: number;
  }[];
  localOffshore: { tipo: string; aum: number; pct: number }[];
  byMoneda: { key: string; aum: number; pct: number }[];
  topPais: { pais: string; aum: number; pct: number }[];
}

export interface PdfOptions {
  /** Nombre del archivo .pdf */
  filename?: string;
  /** Data URL o URL de imagen (logo) */
  logoBase64?: string | null;
  /** Data URL o URL para marca de agua */
  watermarkBase64?: string | null;
  brandColors?: {
    primary?: string;
    rowAlt?: string;
  };
  /** Texto completo del disclaimer (si no se pasa, se usa el default con fecha) */
  disclaimerText?: string;
  /** Firma / pie del asesor (opcional) */
  advisorSignature?: string;
}

export interface PdfOptionsResolved {
  logoBase64: string | null;
  watermarkBase64: string | null;
  brandColors: { primary: string; rowAlt: string };
  disclaimerText: string;
  advisorSignature: string;
}

export const DEFAULT_BRAND_PRIMARY = '#1b3b5a';
export const DEFAULT_BRAND_ROW_ALT = '#eef3f8';

export function brokerOrder(code: string): number {
  const order = ['MS', 'NETX360', 'GMA', 'IEB'] as const;
  const i = order.indexOf(code as (typeof order)[number]);
  return i >= 0 ? i : 99;
}
