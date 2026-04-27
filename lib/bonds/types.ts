/**
 * Tipos alineados con BOND_PAYMENTS_ENGINE_README.md
 */
/** Impuesto: calendario puede traer el mismo pago bajo ley general o bajo Régimen AFIP (doble fila / columna). */
export type BondFlowRegime = 'afip' | 'normal';

export interface BondPaymentEvent {
  asset: string;
  /** Emisor (ej. columna B en planilla tipo “Base Emisor”). */
  issuer?: string;
  date: Date;
  currency: string;
  flowPer100: number;
  couponPer100?: number;
  amortizationPer100?: number;
  residualPctOfPar?: number;
  /**
   * Régimen de flujo (AFIP vs ley general). Si el CSV duplica bono+fecha, una fila debería ser `normal` y otra `afip`.
   * Sin etiqueta, el parser intenta columna, texto en el ticker, o el orden (1ª=general, 2ª=AFIP) cuando hay exactamente 2 filas.
   */
  flowRegime?: BondFlowRegime;
}

export interface BondYieldMetrics {
  ytmAnnualEffective: number | null;
  macaulayYears: number | null;
  modifiedDuration: number | null;
  convexity: number | null;
  npvAtZero: number;
  futureFlowsCount: number;
}

export interface BondCalculatorInputs {
  ticker: string;
  valuationDate: Date;
  /** Precio sucio por cada 100 de nominal (misma convención que el CSV). */
  dirtyPricePer100: number;
  /** Nominal en unidades del VN (típico 100 o el nominal real). */
  nominal: number;
  /** ARS por 1 USD; solo aplica si hay flujos en ARS. */
  usdArsFxRate: number;
}
