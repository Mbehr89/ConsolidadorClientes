/**
 * Reglas de arancel conocidas por ALYC. Es la fuente única: el análisis (fees.ts / mappers)
 * las usa para los controles y la pantalla de Tarifas las muestra.
 */
export type KnownFeeRule = {
  id: string;
  alyc: string;
  operation: string;
  kind: 'minimum';
  /** 'ARS' o 'USD' (USD abarca MEP, cable y exterior). */
  currency: 'ARS' | 'USD';
  amount: number;
  /** confirmed: informada por el usuario / tarifario. observed: deducida de los datos, a confirmar. */
  status: 'confirmed' | 'observed';
  notes: string;
};

export const KNOWN_FEE_RULES: readonly KnownFeeRule[] = [
  {
    id: 'esco-caucion-ars',
    alyc: 'GMA',
    operation: 'Caución (boleto futuro)',
    kind: 'minimum',
    currency: 'ARS',
    amount: 19.9,
    status: 'confirmed',
    notes: 'Por cada caución en pesos. El boleto contado no lleva arancel.',
  },
  {
    id: 'esco-caucion-usd',
    alyc: 'GMA',
    operation: 'Caución (boleto futuro)',
    kind: 'minimum',
    currency: 'USD',
    amount: 0.2,
    status: 'confirmed',
    notes: 'Por cada caución en dólares. Si el arancel vino en pesos se convierte con el TC implícito.',
  },
  {
    id: 'esco-trading-ars',
    alyc: 'GMA',
    operation: 'Compra / venta',
    kind: 'minimum',
    currency: 'ARS',
    amount: 19.9,
    status: 'observed',
    notes: 'Se usa para marcar "Mínimo en notional alto" en operaciones de más de $1M.',
  },
  {
    id: 'esco-trading-usd',
    alyc: 'GMA',
    operation: 'Compra / venta',
    kind: 'minimum',
    currency: 'USD',
    amount: 0.2,
    status: 'observed',
    notes: 'Se usa para marcar "Mínimo en notional alto".',
  },
];

export function knownMinimum(ruleId: string): number {
  const rule = KNOWN_FEE_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Regla de arancel desconocida: ${ruleId}`);
  return rule.amount;
}
