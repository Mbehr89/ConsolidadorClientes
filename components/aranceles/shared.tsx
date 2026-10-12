'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { operationCategoryLabel } from '@/lib/aranceles/categories';
import { feeInOperationCurrency } from '@/lib/aranceles/fees';
import {
  currencyEntries,
  currencyLabel,
  formatAmount,
  formatMoney,
  formatNumber,
  formatPct,
} from '@/lib/aranceles/format';
import { FEE_STATUS_LABEL, type ArancelCommission, type FeeStatus, type TradingGroup } from '@/lib/aranceles/types';

export function StatusBadge({ status }: { status: FeeStatus }) {
  if (status === 'ok') return <Badge variant="success">OK</Badge>;
  if (status === 'skipped') return <Badge variant="secondary">{FEE_STATUS_LABEL.skipped}</Badge>;
  return <Badge variant={status === 'missing' ? 'destructive' : 'warning'}>{FEE_STATUS_LABEL[status]}</Badge>;
}

export function tradingGroupTitle(g: TradingGroup, currency: string): string {
  const fmt = (v: number) =>
    g.basis === 'cantidad' ? `${formatNumber(v)} ${g.instrument ?? ''}`.trim() : formatMoney(v, currency);
  const where = g.consecutive === false ? `Mismo día, boletos ${g.from} a ${g.to} (no seguidos)` : `Boletos ${g.from}–${g.to}`;
  return `${where}: ventas ${fmt(g.sells)} · compras ${fmt(g.buys)}`;
}

export function StatusCell({
  row,
}: {
  row: Pick<ArancelCommission, 'fee_status' | 'trading_group' | 'currency'>;
}) {
  const g = row.trading_group;
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={row.fee_status} />
      {g && (
        <span title={tradingGroupTitle(g, row.currency)}>
          <Badge variant="outline" className="whitespace-nowrap border-sky-300 text-sky-700 dark:text-sky-300">
            Posible trading
          </Badge>
        </span>
      )}
    </div>
  );
}

export function OperationCell({ operation }: { operation: string | null }) {
  const category = operationCategoryLabel(operation);
  return (
    <>
      <div>{operation ?? '—'}</div>
      {category && <div className="text-muted-foreground">{category}</div>}
    </>
  );
}

export function FeeCell({
  row,
}: {
  row: Pick<ArancelCommission, 'commission' | 'commission_pct' | 'currency' | 'commission_currency' | 'commission_fx'>;
}) {
  const crossCurrency = row.commission_currency !== row.currency;
  return (
    <>
      <div>{formatMoney(row.commission, row.commission_currency)}</div>
      {row.commission_pct != null && (
        <div className="text-xs font-normal text-muted-foreground">{formatPct(row.commission_pct)}</div>
      )}
      {crossCurrency && (
        <div className="text-xs font-normal text-amber-600 dark:text-amber-400">
          ≈ {formatMoney(feeInOperationCurrency(row), row.currency)}
          {row.commission_fx != null && ` · TC ${formatNumber(row.commission_fx)}`}
        </div>
      )}
    </>
  );
}

/** Un renglón por moneda: etiqueta de moneda alineada + importe, para que no queden apretados en una sola línea. */
export function TotalsStack({
  totals,
  align = 'end',
  className,
}: {
  totals: Record<string, number>;
  align?: 'start' | 'end';
  className?: string;
}) {
  const entries = currencyEntries(totals);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div
      className={`grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      } ${className ?? ''}`}
    >
      {entries.map(([cur, v]) => (
        <div key={cur} className="contents">
          <span className="text-right text-xs text-muted-foreground">{currencyLabel(cur)}</span>
          <span className="text-right font-medium tabular-nums">{formatAmount(v)}</span>
        </div>
      ))}
    </div>
  );
}

export const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function LoadingBlock({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground animate-pulse">{label}</p>;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <span className="text-destructive">{message}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyBlock({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action}
      </CardContent>
    </Card>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(text.slice(0, 200) || `Error ${res.status}`);
  }
}
