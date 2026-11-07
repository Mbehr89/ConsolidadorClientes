'use client';

import { useEffect, useMemo, useState } from 'react';
import { ErrorBlock, LoadingBlock, inputClass } from '@/components/aranceles/shared';
import { formatMoney, formatMonthLong } from '@/lib/aranceles/format';
import type { BalancesConfig } from '@/lib/balances/config';
import { buildCompanyFlow, type CompanyFlow, type DisplayCurrency, type IncomeCell } from '@/lib/balances/compute';
import { cn } from '@/lib/utils';

type Payload = {
  config: BalancesConfig;
  income: IncomeCell[];
  grupos: string[];
};

const NONE = '';

function money(value: number, currency: DisplayCurrency): string {
  const formatted = formatMoney(Math.abs(value), currency);
  return value < 0 ? `(${formatted})` : formatted;
}

function pct(value: number): string {
  return `${(value * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

function sentence(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function nextMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  if (!year || !month) return ym;
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthSpan(months: string[]): string {
  const sorted = [...months].sort();
  const ranges: string[][] = [];
  for (const month of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && nextMonth(last[last.length - 1]!) === month) last.push(month);
    else ranges.push([month]);
  }
  return ranges
    .map((range) =>
      range.length === 1 ? formatMonthLong(range[0]!) : `${formatMonthLong(range[0]!)} a ${formatMonthLong(range[range.length - 1]!)}`
    )
    .join(', ');
}

function periodLabel(from: string, to: string): string {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  if (start === end) return sentence(formatMonthLong(start));
  return `${sentence(formatMonthLong(start))} a ${formatMonthLong(end)}`;
}

export default function BalanceStatementPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [display, setDisplay] = useState<DisplayCurrency>('ARS');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [byPartner, setByPartner] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/balances');
        const body = (await res.json()) as Payload & { error?: string };
        if (!res.ok) throw new Error(body.error || 'No se pudo armar el balance.');
        if (!cancelled) setPayload(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo armar el balance.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bounds = useMemo(() => {
    const months = [
      ...(payload?.income.map((c) => c.month) ?? []),
      ...(payload?.config.expenses.map((e) => e.month) ?? []),
    ].sort();
    return { min: months[0] ?? '', max: months[months.length - 1] ?? '' };
  }, [payload]);

  const options = useMemo(() => [...(payload?.grupos ?? []), NONE], [payload]);
  const selected = picked ?? options;
  const effectiveFrom = from ?? bounds.min;
  const effectiveTo = to ?? bounds.max;

  const flow = useMemo(() => {
    if (!payload || !effectiveFrom || !effectiveTo) {
      return { partners: [], lines: [], result: null, groupsWithoutPartners: [], omitted: [] } satisfies CompanyFlow;
    }
    const grupos = selected.map((g) => (g === NONE ? null : g));
    return buildCompanyFlow(payload.income, payload.config, grupos, effectiveFrom, effectiveTo, display);
  }, [payload, selected, effectiveFrom, effectiveTo, display]);

  if (loading) return <LoadingBlock label="Armando el balance…" />;
  if (error || !payload) {
    return <ErrorBlock message={error ?? 'No se pudo armar el balance.'} />;
  }

  const showPartners = byPartner && flow.partners.length > 0;
  const showUnassigned = showPartners && flow.lines.some((line) => Math.abs(line.unassigned) > 0.005);

  function toggleGroup(key: string) {
    const current = new Set(selected);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    setPicked([...current]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Desde
            <input className={inputClass} type="month" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Hasta
            <input className={inputClass} type="month" value={effectiveTo} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              'h-8 rounded-md border px-3 text-sm',
              byPartner ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'
            )}
            onClick={() => setByPartner((v) => !v)}
          >
            Por socio
          </button>
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(['ARS', 'USD'] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'h-8 rounded px-3 text-sm',
                  display === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                )}
                onClick={() => setDisplay(c)}
              >
                {c === 'ARS' ? 'Pesos' : 'Dólares'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {options.map((key) => {
          const on = selected.includes(key);
          return (
            <button
              key={key || 'none'}
              type="button"
              aria-pressed={on}
              onClick={() => toggleGroup(key)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm',
                on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'
              )}
            >
              {key || 'Sin grupo'}
            </button>
          );
        })}
      </div>

      <Statement
        flow={flow}
        display={display}
        period={periodLabel(effectiveFrom, effectiveTo)}
        groups={selected}
        showPartners={showPartners}
        showUnassigned={showUnassigned}
      />
    </div>
  );
}

function Statement({
  flow,
  display,
  period,
  groups,
  showPartners,
  showUnassigned,
}: {
  flow: CompanyFlow;
  display: DisplayCurrency;
  period: string;
  groups: string[];
  showPartners: boolean;
  showUnassigned: boolean;
}) {
  const groupNames = groups.map((g) => g || 'Sin grupo');
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="space-y-1 border-b border-border px-4 py-4 sm:px-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Estado de resultados</p>
        <h3 className="text-lg font-medium">{period}</h3>
        <p className="text-sm text-muted-foreground">
          {groupNames.length ? groupNames.join(' · ') : 'Ningún grupo seleccionado'}
          {' · '}
          {display === 'ARS' ? 'en pesos' : 'en dólares'}
        </p>
      </header>

      {flow.lines.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {flow.omitted.length ? (
            <>
              Falta el tipo de cambio para unificar estos meses en una sola moneda. Cargalo en{' '}
              <a className="underline" href="/balances/movimientos">
                Movimientos
              </a>
              .
            </>
          ) : (
            'No hay aranceles, sueldos ni gastos para este período y estos grupos.'
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium sm:px-6">Concepto</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                {showPartners &&
                  flow.partners.map((partner) => (
                    <th key={partner.key} className="px-3 py-2 text-right font-medium">
                      <span className="block text-foreground">{partner.name}</span>
                      <span className="block font-normal">
                        {partner.equity === null || partner.profit === null
                          ? 'según el grupo'
                          : `${pct(partner.equity)} equity · ${pct(partner.profit)} beneficio`}
                      </span>
                    </th>
                  ))}
                {showUnassigned && <th className="px-3 py-2 text-right font-medium">Sin asignar</th>}
              </tr>
            </thead>
            <tbody>
              {flow.lines.map((line) => {
                const result = line.id === 'result';
                return (
                  <tr key={line.id} className={cn('border-b', result && 'border-t-2 border-foreground/20 bg-muted/40 font-semibold')}>
                    <td className={cn('px-4 py-2 sm:px-6', line.level === 1 && 'pl-8 text-muted-foreground sm:pl-10', result && 'py-3')}>
                      {line.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.total, display)}</td>
                    {showPartners &&
                      flow.partners.map((partner) => (
                        <td key={partner.key} className="px-3 py-2 text-right tabular-nums">
                          {money(line.partners[partner.key] ?? 0, display)}
                        </td>
                      ))}
                    {showUnassigned && <td className="px-3 py-2 text-right tabular-nums">{money(line.unassigned, display)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(flow.omitted.length > 0 || flow.groupsWithoutPartners.length > 0) && (
        <footer className="space-y-1 border-t border-border px-4 py-3 text-xs text-amber-700 dark:text-amber-400 sm:px-6">
          {flow.omitted.length > 0 && (
            <p>
              {flow.omitted.length === 1 ? 'No entra' : 'No entran'}{' '}
              {Object.entries(
                flow.omitted.reduce<Record<string, string[]>>((acc, item) => {
                  const key = item.grupo ?? 'Sin grupo';
                  acc[key] = [...(acc[key] ?? []), item.month];
                  return acc;
                }, {})
              )
                .map(([grupo, months]) => `${monthSpan(months)} de ${grupo}`)
                .join('; ')}
              : falta el tipo de cambio.
            </p>
          )}
          {flow.groupsWithoutPartners.length > 0 && (
            <p>
              {flow.groupsWithoutPartners.map((g) => g ?? 'Sin grupo').join(', ')} no tiene socios: su resultado queda sin
              asignar.
            </p>
          )}
        </footer>
      )}
    </section>
  );
}
