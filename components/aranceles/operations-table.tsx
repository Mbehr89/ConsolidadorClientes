'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { FeeCell, OperationCell, StatusCell } from '@/components/aranceles/shared';
import { feeTypeLabel } from '@/lib/aranceles/fee-types';
import { formatDate, formatMoney } from '@/lib/aranceles/format';
import {
  DEFAULT_OPERATION_SORT,
  type OperationSort,
  type OperationSortKey,
} from '@/lib/aranceles/operation-sort';
import type { ArancelCommission } from '@/lib/aranceles/types';
import { cn } from '@/lib/utils';

export type OperationRow = ArancelCommission & { commission_con_iva?: number; tipo?: string | null };

function SortHeader({
  by,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  by: OperationSortKey;
  label: string;
  sort: OperationSort;
  onSort: (by: OperationSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.by === by;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn('p-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 uppercase hover:text-foreground',
          align === 'right' && 'w-full justify-end',
          active && 'text-foreground'
        )}
        aria-label={`Ordenar por ${label}`}
        onClick={() => onSort(by)}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', !active && 'opacity-40')} />
      </button>
    </th>
  );
}

export function OperationsTable({
  rows,
  showClient = true,
  maxHeightClass = 'max-h-[560px]',
  feeLabel = 'Arancel',
  showFeeWithIva = false,
  sort = DEFAULT_OPERATION_SORT,
  onSort,
}: {
  rows: readonly OperationRow[];
  showClient?: boolean;
  maxHeightClass?: string;
  feeLabel?: string;
  /** Segunda columna: el mismo arancel bruto multiplicado por el IVA del tipo. */
  showFeeWithIva?: boolean;
  sort?: OperationSort;
  onSort?: (by: OperationSortKey) => void;
}) {
  const sortBy = onSort ?? (() => undefined);
  return (
    <div className={`${maxHeightClass} overflow-auto`}>
      <table className={`w-full text-sm ${showFeeWithIva ? 'min-w-[1080px]' : 'min-w-[900px]'}`}>
        <thead className="sticky top-0 border-b bg-card">
          <tr className="text-xs uppercase text-muted-foreground">
            <SortHeader by="fecha" label="Fecha" sort={sort} onSort={sortBy} />
            <SortHeader by="boleto" label="Boleto" sort={sort} onSort={sortBy} />
            {showClient && <SortHeader by="cliente" label="Cliente" sort={sort} onSort={sortBy} />}
            <SortHeader by="alyc" label="ALYC" sort={sort} onSort={sortBy} />
            <SortHeader by="operacion" label="Operación" sort={sort} onSort={sortBy} />
            <SortHeader by="instrumento" label="Instrumento" sort={sort} onSort={sortBy} />
            <SortHeader by="bruto" label="Bruto" sort={sort} onSort={sortBy} align="right" />
            <SortHeader by="arancel" label={feeLabel} sort={sort} onSort={sortBy} align="right" />
            {showFeeWithIva && (
              <SortHeader by="arancel_iva" label="Arancel bruto (con IVA)" sort={sort} onSort={sortBy} align="right" />
            )}
            <SortHeader by="estado" label="Estado" sort={sort} onSort={sortBy} />
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
                <div className="text-xs text-muted-foreground">{r.tipo ?? feeTypeLabel(r)}</div>
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
