'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FEE_STATUS_LABEL, type FeeStatus } from '@/lib/aranceles/types';

export function StatusBadge({ status }: { status: FeeStatus }) {
  if (status === 'ok') return <Badge variant="success">OK</Badge>;
  if (status === 'skipped') return <Badge variant="secondary">{FEE_STATUS_LABEL.skipped}</Badge>;
  return <Badge variant={status === 'missing' ? 'destructive' : 'warning'}>{FEE_STATUS_LABEL[status]}</Badge>;
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

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
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
