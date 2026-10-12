import { caucionLeg, operationCategory } from '@/lib/aranceles/categories';
import { alycKey } from '@/lib/aranceles/dedup';
import type { ArancelCommission } from '@/lib/aranceles/types';

/** Tipo de arancel bruto: cada uno lleva su propio tratamiento para llegar al neto. */
export type FeeType =
  | 'publico'
  | 'privado'
  | 'acdi'
  | 'nota_debito'
  | 'nota_credito'
  | 'licitacion'
  | 'diferencia'
  | 'caucion'
  | 'mercado'
  | 'otro';

export const FEE_TYPES: readonly FeeType[] = [
  'publico',
  'privado',
  'acdi',
  'nota_debito',
  'nota_credito',
  'licitacion',
  'diferencia',
  'caucion',
  'mercado',
  'otro',
];

export const FEE_TYPE_LABEL: Record<FeeType, string> = {
  publico: 'Aranceles público',
  privado: 'Aranceles privado',
  acdi: 'ACDI (FCI)',
  nota_debito: 'Nota de débito',
  nota_credito: 'Nota de crédito',
  licitacion: 'Licitación (fee colocador)',
  diferencia: 'Dif. precios (SENEBI)',
  caucion: 'Cauciones',
  mercado: 'Operaciones de mercado',
  otro: 'Otro',
};

const LABEL_ORDER = new Map(FEE_TYPES.map((t, i) => [FEE_TYPE_LABEL[t], i]));

/** Orden fijo de los tipos (no alfabético) para listados y desgloses. */
export function compareFeeTypeLabels(a: string, b: string): number {
  return (LABEL_ORDER.get(a) ?? 99) - (LABEL_ORDER.get(b) ?? 99) || a.localeCompare(b, 'es');
}

function up(v: string | null | undefined): string {
  return (v ?? '').trim().toUpperCase();
}

/**
 * Especies de deuda pública (soberanos, letras del Tesoro, BCRA y provincias), con o sin sufijo D/C de moneda.
 * Lo que no coincide (acciones, CEDEARs, ETFs, ON, opciones) se toma como título privado.
 */
const PUBLIC_INSTRUMENT_PATTERNS: readonly RegExp[] = [
  /^(AL|GD|AE|GE)\d{2}[DC]?$/, // Bonares / Globales
  /^(TX|TZX|TZV|TV|TO|TY|TC|PR)\d/, // Boncer, tasa fija, consolidación
  /^(DICP|PARP|CUAP)[DC]?$/, // Discount / Par / Cuasipar
  /^TT[A-Z]\d{2}[DC]?$/, // duales TAMAR (TTM26, TTD26)
  /^T\d{1,2}[A-Z]\d[DC]?$/, // Boncap (T15E7)
  /^[SDX]\d{2}[A-Z]\d[DC]?$/, // Lecap, dólar linked, Lecer (S31O5, D30S6)
  /^BP(O[A-D]|Y|J)\d/, // BOPREAL
  /^(PBA|BA|BDC|CO|CH|PMM|ER|NDT|NDS|SFD|MZ)\d{2}[DC]?$/, // provincias y CABA
];

export function isPublicInstrument(instrument: string | null | undefined): boolean {
  const s = up(instrument);
  return s !== '' && PUBLIC_INSTRUMENT_PATTERNS.some((re) => re.test(s));
}

type FeeTypeInput = Pick<ArancelCommission, 'alyc' | 'segment' | 'operation' | 'commission'> &
  Partial<Pick<ArancelCommission, 'instrument'>>;

/** GMA no informa el tipo: SENEBI y caución salen del código de operación; el resto, de la especie. */
function gmaFeeType(c: FeeTypeInput): FeeType {
  if (operationCategory(c.operation) === 'senebi') return 'diferencia';
  if (caucionLeg(c.operation)) return 'caucion';
  return isPublicInstrument(c.instrument) ? 'publico' : 'privado';
}

/**
 * IEB: el tipo sale de la planilla de origen (segmento); en notas, de la columna Tipo
 * (y si faltara, del signo: las de crédito vienen negativas). GMA: ver `gmaFeeType`.
 * Otras ALYC: operaciones de mercado.
 */
export function feeTypeOf(c: FeeTypeInput): FeeType {
  const segment = (c.segment ?? '').trim().toLowerCase();
  const op = up(c.operation);
  switch (segment) {
    case 'aranceles_publico':
      return 'publico';
    case 'aranceles_privado':
      return 'privado';
    case 'aranceles':
      return op === 'PUBLICO' ? 'publico' : op === 'PRIVADO' ? 'privado' : 'otro';
    case 'acdi':
      return 'acdi';
    case 'notas':
      if (op.includes('DEBITO')) return 'nota_debito';
      if (op.includes('CREDITO')) return 'nota_credito';
      return c.commission < 0 ? 'nota_credito' : 'nota_debito';
    case 'licitaciones':
      return 'licitacion';
    case 'diferencias':
      return 'diferencia';
    case '': {
      const alyc = alycKey(c.alyc);
      if (alyc === 'ieb') return 'otro';
      return alyc === 'gma' ? gmaFeeType(c) : 'mercado';
    }
    default:
      return 'otro';
  }
}

export function feeTypeLabel(c: FeeTypeInput): string {
  return FEE_TYPE_LABEL[feeTypeOf(c)];
}
