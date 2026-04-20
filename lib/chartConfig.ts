/**
 * Paleta y estilos base para gráficos (Recharts / Chart.js).
 * Alineado al design system institucional (Altoo-style).
 */

export const CHART_COLORS = {
  primary: '#1B3B5A',
  secondary: '#6CA7D4',
  tertiary: '#2EA87E',
  quaternary: '#D8E2ED',
  negative: '#E05353',
  warning: '#F4A623',
} as const;

/** Escala de azules para donut / treemap / distribución */
export const CHART_BLUES = [
  '#1B3B5A',
  '#2B5278',
  '#3A6A96',
  '#6CA7D4',
  '#A0C4E3',
  '#C8DCF0',
  '#EEF3F8',
] as const;

/** Colores por broker (consistente con la paleta del sistema) */
export const BROKER_CHART_HEX: Record<string, string> = {
  MS: CHART_COLORS.secondary,
  NETX360: CHART_COLORS.tertiary,
  IEB: CHART_COLORS.warning,
  GMA: '#3A6A96',
};

export const CHART_STYLE = {
  grid: {
    stroke: '#D8E2ED',
    strokeDasharray: '3 3',
    strokeWidth: 0.5,
  },
  axis: {
    tick: { fontSize: 11, fill: '#8494A7' },
    axisLine: { stroke: '#D8E2ED' },
    tickLine: false,
  },
  tooltip: {
    contentStyle: {
      background: '#FFFFFF',
      border: '0.5px solid #D8E2ED',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(27,59,90,0.08)',
      fontSize: '12px',
      color: '#1B3B5A',
    },
  },
} as const;
