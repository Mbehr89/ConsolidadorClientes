import { operationCategoryLabel } from '@/lib/aranceles/categories';
import { compareFeeTypeLabels, feeTypeLabel } from '@/lib/aranceles/fee-types';
import { feeInOperationCurrency } from '@/lib/aranceles/fees';
import { summarize, sortByDateDesc, type CurrencyTotals } from '@/lib/aranceles/history';
import {
  SEGMENT_DIMENSIONS,
  SEGMENT_LABEL,
  segmentLabel,
  type ArancelSegment,
} from '@/lib/aranceles/segments';
import { FEE_STATUS_LABEL, type ArancelCommission } from '@/lib/aranceles/types';

export type OperationExportRow = {
  tradeDate: string;
  settlementDate: string | null;
  opNumber: string | null;
  alyc: string;
  account: string | null;
  client: string;
  officer: string | null;
  manager: string | null;
  advisor: string | null;
  grupoAsesor: string | null;
  feeType: string;
  operation: string | null;
  category: string | null;
  instrument: string | null;
  quantity: number | null;
  currency: string;
  amount: number | null;
  commissionPct: number | null;
  commission: number;
  commissionCurrency: string;
  /** Sólo cuando el arancel vino en otra moneda que la operación. */
  fx: number | null;
  commissionInOpCurrency: number | null;
  expected: number | null;
  status: string;
  trading: string | null;
};

export type ClientExportData = {
  client: string;
  rangeLabel: string;
  /** "Manager: X · Advisor: Y · Grupo asesor: Z" según el mapping de cuentas. */
  segmentLabel: string;
  generatedAt: Date;
  rowCount: number;
  totals: CurrencyTotals;
  byMonth: { month: string; rows: number; totals: CurrencyTotals }[];
  rows: OperationExportRow[];
};

type ExportableCommission = ArancelCommission & Partial<ArancelSegment>;

export function toExportRow(c: ExportableCommission): OperationExportRow {
  const cross = c.commission_currency !== c.currency;
  return {
    tradeDate: c.trade_date,
    settlementDate: c.settlement_date,
    opNumber: c.op_number,
    alyc: c.alyc,
    account: c.client_external_id,
    client: c.client,
    officer: c.account_officer,
    manager: c.manager ?? null,
    advisor: c.advisor ?? null,
    grupoAsesor: c.grupo_asesor ?? null,
    feeType: c.tipo ?? feeTypeLabel(c),
    operation: c.operation,
    category: operationCategoryLabel(c.operation),
    instrument: c.instrument,
    quantity: c.quantity,
    currency: c.currency,
    amount: c.amount,
    commissionPct: c.commission_pct,
    commission: c.commission,
    commissionCurrency: c.commission_currency,
    fx: cross ? c.commission_fx : null,
    commissionInOpCurrency: cross ? feeInOperationCurrency(c) : null,
    expected: c.expected_commission,
    status: FEE_STATUS_LABEL[c.fee_status],
    trading: c.trading_group ? `Boletos ${c.trading_group.from}-${c.trading_group.to}` : null,
  };
}

function describeSegments(commissions: readonly ExportableCommission[]): string {
  if (!commissions.some((c) => c.manager !== undefined)) return '';
  return SEGMENT_DIMENSIONS.map((d) => {
    const values = [...new Set(commissions.map((c) => segmentLabel(c[d] ?? null)))].sort((a, b) =>
      d === 'tipo' ? compareFeeTypeLabels(a, b) : a.localeCompare(b, 'es')
    );
    return `${SEGMENT_LABEL[d]}: ${values.join(', ')}`;
  }).join(' · ');
}

export function buildClientExport(
  client: string,
  commissions: readonly ExportableCommission[],
  rangeLabel: string
): ClientExportData {
  const summary = summarize(commissions);
  return {
    client,
    rangeLabel,
    segmentLabel: describeSegments(commissions),
    generatedAt: new Date(),
    rowCount: commissions.length,
    totals: summary.totals,
    byMonth: [...summary.byMonth]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((m) => ({ month: m.key, rows: m.rows, totals: m.totals })),
    rows: sortByDateDesc(commissions).reverse().map(toExportRow),
  };
}

export function exportFilename(client: string, ext: 'xlsx' | 'pdf'): string {
  const slug = client
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `aranceles_${slug || 'cliente'}_${ymd}.${ext}`;
}
