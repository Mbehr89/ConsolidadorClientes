'use client';

import { FeeCell, OperationCell, StatusCell } from '@/components/aranceles/shared';
import { feeTypeLabel } from '@/lib/aranceles/fee-types';
import { formatDate, formatMoney } from '@/lib/aranceles/format';
import type { ArancelCommission } from '@/lib/aranceles/types';

export type OperationRow = ArancelCommission & { commission_con_iva?: number };

export function OperationsTable({
  rows,
  showClient = true,
  maxHeightClass = 'max-h-[560px]',
  feeLabel = 'Arancel',
  showFeeWithIva = false,
}: {
  rows: readonly OperationRow[];
  showClient?: boolean;
  maxHeightClass?: string;
  feeLabel?: string;
  /** Segunda columna: el mismo arancel bruto multiplicado por el IVA del tipo. */
  showFeeWithIva?: boolean;
}) {
  return (
    <div className={`${maxHeightClass} overflow-auto`}>
      <table className={`w-full text-sm ${showFeeWithIva ? 'min-w-[1080px]' : 'min-w-[900px]'}`}>
        <thead className="sticky top-0 border-b bg-card">
          <tr className="text-xs uppercase text-muted-foreground">
            <th className="p-2 text-left font-medium">Fecha</th>
            <th className="p-2 text-left font-medium">Boleto</th>
            {showClient && <th className="p-2 text-left font-medium">Cliente</th>}
            <th className="p-2 text-left font-medium">ALYC</th>
            <th className="p-2 text-left font-medium">Operación</th>
            <th className="p-2 text-left font-medium">Instrumento</th>
            <th className="p-2 text-right font-medium">Bruto</th>
            <th className="p-2 text-right font-medium">{feeLabel}</th>
            {showFeeWithIva && <th className="p-2 text-right font-medium">Arancel bruto (con IVA)</th>}
            <th className="p-2 text-left font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
              <td className="whitespace-nowrap p-2">{formatDate(r.trade_date)}</td>
              <td className="p-2 font-mono text-xs tabular-nums">{r.op_number ?? '—'}</td>
              {showClient && (
                <td className="p-2">
                  <div>{r.client}</div>
                  {r.client_external_id && (
                    <div className="text-xs text-muted-foreground">Cta. {r.client_external_id}</div>
                  )}
                </td>
              )}
              <td className="p-2">
                <div>{r.alyc}</div>
                <div className="text-xs text-muted-foreground">{feeTypeLabel(r)}</div>
                {!showClient && r.client_external_id && (
                  <div className="text-xs text-muted-foreground">Cta. {r.client_external_id}</div>
                )}
              </td>
              <td className="p-2 text-xs">
                <OperationCell operation={r.operation} />
                {(r.details?.modo || r.details?.aplica) && (
                  <div className="text-muted-foreground">
                    {[r.details.modo && `Modo ${r.details.modo}`, r.details.aplica && `Aplica ${r.details.aplica}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </td>
              <td className="p-2 font-mono text-xs text-muted-foreground">{r.instrument ?? '—'}</td>
              <td className="p-2 text-right tabular-nums text-muted-foreground">
                {r.amount != null ? formatMoney(r.amount, r.currency) : '—'}
              </td>
              <td className="p-2 text-right font-medium tabular-nums">
                <FeeCell row={r} />
              </td>
              {showFeeWithIva && (
                <td className="p-2 text-right font-medium tabular-nums">
                  {formatMoney(r.commission_con_iva ?? r.commission, r.commission_currency)}
                </td>
              )}
              <td className="p-2">
                <StatusCell row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
