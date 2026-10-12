export type OperationCategory = 'caucion' | 'senebi';

export const OPERATION_CATEGORY_LABEL: Record<OperationCategory, string> = {
  caucion: 'Caución',
  senebi: 'Senebi',
};

/** La caución tiene dos boletos: contado (apertura, sin arancel) y futuro (cierre, lleva el arancel). */
export type CaucionLeg = 'contado' | 'futuro';

type OperationInfo = { category: OperationCategory; label: string; leg?: CaucionLeg };

const TOMADORA = 'Caución tomadora';
const COLOCADORA = 'Caución colocadora';

const OPERATION_BY_CODE: Record<string, OperationInfo> = {
  APTOMCONC: { category: 'caucion', label: TOMADORA, leg: 'contado' },
  APTOMFUTC: { category: 'caucion', label: TOMADORA, leg: 'futuro' },
  APCOLCON: { category: 'caucion', label: COLOCADORA, leg: 'contado' },
  APCOLFUT: { category: 'caucion', label: COLOCADORA, leg: 'futuro' },
  CSBNG: { category: 'senebi', label: 'Compra Senebi' },
  VSBNG: { category: 'senebi', label: 'Venta Senebi' },
};

function operationInfo(operation: string | null | undefined): OperationInfo | null {
  if (!operation) return null;
  return OPERATION_BY_CODE[operation.trim().toUpperCase()] ?? null;
}

export function operationCategory(operation: string | null | undefined): OperationCategory | null {
  return operationInfo(operation)?.category ?? null;
}

export function operationCategoryLabel(operation: string | null | undefined): string | null {
  return operationInfo(operation)?.label ?? null;
}

export function caucionLeg(operation: string | null | undefined): CaucionLeg | null {
  return operationInfo(operation)?.leg ?? null;
}
