'use client';

import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/aranceles/shared';
import {
  EMPTY_REPORT_FILTERS,
  ReportFiltersBar,
  useArancelesReport,
  type ReportFilters,
} from '@/components/aranceles/report-filters';
import { currencyLabel, formatDate, formatMoney, formatPeriod } from '@/lib/aranceles/format';
import {
  NET_ALYCS,
  NET_BUCKETS,
  NET_BUCKET_LABEL,
  sumNetLines,
  type NetAlyc,
  type NetBlock,
  type NetLine,
  type NetReport,
  type NetTotals,
} from '@/lib/aranceles/net';
import type { NetRuleVersion } from '@/lib/aranceles/settings';
import { cn } from '@/lib/utils';

function pct(v: number): string {
  return `${(v * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

function money(v: number, currency: string): string {
  return v === 0 ? '—' : formatMoney(v, currency);
}

const PERSONA_SOURCE: Record<NetAlyc, string> = { IEB: 'productor', GMA: 'oficial de cuenta' };

const ALYC_STYLE: Record<NetAlyc, { badge: string; band: string; accent: string; dot: string }> = {
  IEB: {
    badge: 'bg-navy-100 text-navy-700 dark:bg-navy-700/60 dark:text-navy-100',
    band: 'bg-navy-50 dark:bg-navy-900/40',
    accent: 'border-l-navy-500 dark:border-l-navy-300',
    dot: 'bg-navy-300',
  },
  GMA: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-100',
    band: 'bg-violet-50 dark:bg-violet-950/40',
    accent: 'border-l-violet-500 dark:border-l-violet-300',
    dot: 'bg-violet-300',
  },
};

/** Columna "A pagar": siempre resaltada para que se lea de un vistazo. */
const PAY_CELL = 'bg-teal-100/60 text-teal-600 dark:bg-teal-600/15 dark:text-teal-400';

const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2';

function AlycBadge({ alyc }: { alyc: NetAlyc }) {
  return (
    <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide', ALYC_STYLE[alyc].badge)}>
      {alyc}
    </span>
  );
}

function Expander({ open, visible = true }: { open: boolean; visible?: boolean }) {
  if (!visible) return <span className="inline-block w-4" />;
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function CountPill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{children}</span>;
}

function personaLabel(l: Pick<NetLine, 'persona'>): string {
  return l.persona ?? 'Sin asignar';
}

type PersonaGroup = { key: string; alyc: NetAlyc; persona: string | null; lines: NetLine[] };

function groupByPersona(lines: readonly NetLine[]): PersonaGroup[] {
  const map = new Map<string, PersonaGroup>();
  for (const l of lines) {
    const key = `${l.alyc}|${l.persona ?? ''}`;
    const g = map.get(key) ?? { key, alyc: l.alyc, persona: l.persona, lines: [] };
    g.lines.push(l);
    map.set(key, g);
  }
  return [...map.values()];
}

function useToggleSet() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return { open, toggle };
}

type RowVariant = 'row' | 'sub' | 'subtotal' | 'total';

/**
 * Detalle de un mes y moneda: una banda por broker, una fila por productor/manager con su total; al hacer
 * clic se abre el detalle por tipo de arancel.
 */
function DetailTable({ block }: { block: NetBlock }) {
  const { lines, currency } = block;
  const { open, toggle } = useToggleSet();
  const hasNotas = lines.some((l) => l.notas !== 0);
  const multiAlyc = block.byAlyc.length > 1;
  const cols = 8 + (hasNotas ? 2 : 0);
  const byAlyc = NET_ALYCS.filter((a) => lines.some((l) => l.alyc === a)).map((alyc) => {
    const own = lines.filter((l) => l.alyc === alyc);
    return { alyc, own, groups: groupByPersona(own) };
  });

  const valueCells = (t: NetTotals | NetLine, variant: RowVariant = 'row') => {
    const dim = variant === 'sub' && 'text-muted-foreground';
    return (
      <>
        <td className={cn(TD, 'text-right tabular-nums', dim)}>{money(t.bruto, currency)}</td>
        {hasNotas && (
          <td className={cn(TD, 'text-right tabular-nums', dim, t.notas < 0 && 'text-red-600 dark:text-red-400')}>
            {money(t.notas, currency)}
          </td>
        )}
        {hasNotas && <td className={cn(TD, 'text-right tabular-nums', dim)}>{money(t.brutoAjustado, currency)}</td>}
        <td className={cn(TD, 'text-right tabular-nums text-muted-foreground')}>{money(-t.iibb, currency)}</td>
        <td className={cn(TD, 'text-right tabular-nums', dim)}>{money(t.neto, currency)}</td>
        <td className={cn(TD, 'text-right text-xs text-muted-foreground')}>
          {'share' in t ? (
            <>
              {t.share != null ? pct(t.share) : 'varias'}
              {t.ivaDivisor != null && t.ivaDivisor !== 1 && ` ÷ ${t.ivaDivisor.toLocaleString('es-AR')}`}
              {t.withAgreement > 0 && (
                <div className="text-amber-700 dark:text-amber-400">{t.withAgreement} op. con arreglo</div>
              )}
            </>
          ) : (
            t.alicuota != null && `Alíc. neta ${pct(t.alicuota)}`
          )}
        </td>
        <td
          className={cn(
            TD,
            'text-right tabular-nums',
            PAY_CELL,
            variant === 'sub' ? 'font-normal' : 'font-semibold',
            variant === 'total' && 'text-[15px]'
          )}
        >
          {money(t.aPagar, currency)}
        </td>
      </>
    );
  };

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className={cn(TH, 'text-left')}>Productor / Manager</th>
            <th className={cn(TH, 'text-left')}>Tipo</th>
            <th className={cn(TH, 'text-right')}>Bruto</th>
            {hasNotas && <th className={cn(TH, 'text-right')}>Notas déb./créd.</th>}
            {hasNotas && <th className={cn(TH, 'text-right')}>Bruto ajustado</th>}
            <th className={cn(TH, 'text-right')}>IIBB</th>
            <th className={cn(TH, 'text-right')}>Comisión neta</th>
            <th className={cn(TH, 'text-right')}>Distribución</th>
            <th className={cn(TH, 'text-right font-semibold', PAY_CELL)}>A pagar</th>
          </tr>
        </thead>
        <tbody>
          {byAlyc.map(({ alyc, own, groups }) => {
            const st = ALYC_STYLE[alyc];
            const alone = groups.length === 1;
            return (
              <Fragment key={alyc}>
                {!alone && (
                  <tr className={cn('border-y', st.band)}>
                    <td className={cn(TD, 'py-2.5')} colSpan={2}>
                      <span className="inline-flex items-center gap-2">
                        <AlycBadge alyc={alyc} />
                        {multiAlyc && <span className="text-xs font-medium text-muted-foreground">Subtotal</span>}
                      </span>
                    </td>
                    {multiAlyc ? valueCells(sumNetLines(own), 'subtotal') : <td colSpan={cols - 2} />}
                  </tr>
                )}
                {groups.map((g) => {
                  const single = g.lines.length === 1 ? g.lines[0]! : null;
                  const isOpen = open.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className={cn(
                          'border-b border-border/60',
                          !single && 'cursor-pointer hover:bg-muted/50',
                          isOpen && 'bg-muted/40'
                        )}
                        onClick={single ? undefined : () => toggle(g.key)}
                      >
                        <td
                          className={cn(
                            TD,
                            'border-l-[3px] font-medium',
                            isOpen ? st.accent : 'border-l-transparent',
                            !g.persona && 'italic text-muted-foreground'
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Expander open={isOpen} visible={!single} />
                            {alone && <AlycBadge alyc={alyc} />}
                            {personaLabel(g)}
                          </span>
                        </td>
                        <td className={cn(TD, 'text-muted-foreground')}>
                          {single ? single.label : <CountPill>{g.lines.length} tipos</CountPill>}
                        </td>
                        {valueCells(single ?? sumNetLines(g.lines))}
                      </tr>
                      {!single &&
                        isOpen &&
                        g.lines.map((l, i) => (
                          <tr
                            key={l.key}
                            className={cn('text-[13px]', st.band, i === g.lines.length - 1 && 'border-b border-border/60')}
                          >
                            <td className={cn(TD, 'border-l-[3px] py-1.5', st.accent)} />
                            <td className={cn(TD, 'py-1.5')}>
                              <span className="inline-flex items-center gap-2">
                                <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                                {l.label}
                              </span>
                            </td>
                            {valueCells(l, 'sub')}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {byAlyc.reduce((n, a) => n + a.groups.length, 0) > 1 && (
            <tr className="border-t-2 border-foreground/20 bg-muted/60 font-semibold">
              <td className={cn(TD, 'py-2.5')} colSpan={2}>
                Total {currencyLabel(currency)}
              </td>
              {valueCells(block.totals, 'total')}
            </tr>
          )}
          {block.excluded.length > 0 && (
            <tr>
              <td colSpan={cols} className="px-3 py-2">
                <ExcludedNote excluded={block.excluded} currency={currency} />
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

type PersonaTotal = {
  key: string;
  alyc: NetAlyc;
  persona: string | null;
  aPagar: Record<string, number>;
  rows: number;
  byTipo: Map<string, { label: string; aPagar: Record<string, number> }>;
};

function addTo(target: Record<string, number>, currency: string, v: number) {
  target[currency] = (target[currency] ?? 0) + v;
}

/** Todo el rango: a pagar por broker × productor/manager y moneda; al hacer clic, por tipo de arancel. */
function PersonaTotals({ report }: { report: NetReport }) {
  const { open, toggle } = useToggleSet();
  const currencies = report.byCurrency.map((c) => c.currency);
  const map = new Map<string, PersonaTotal>();
  for (const b of report.blocks) {
    for (const l of b.lines) {
      const key = `${l.alyc}|${l.persona ?? ''}`;
      const p: PersonaTotal = map.get(key) ?? { key, alyc: l.alyc, persona: l.persona, aPagar: {}, rows: 0, byTipo: new Map() };
      addTo(p.aPagar, b.currency, l.aPagar);
      p.rows += l.rows;
      const t = p.byTipo.get(l.bucket) ?? { label: l.label, aPagar: {} as Record<string, number> };
      addTo(t.aPagar, b.currency, l.aPagar);
      p.byTipo.set(l.bucket, t);
      map.set(key, p);
    }
  }
  const all = [...map.values()];
  if (all.length === 0) return null;
  const alycs = NET_ALYCS.filter((a) => all.some((p) => p.alyc === a));
  const multiAlyc = alycs.length > 1;

  const amountCells = (v: Record<string, number>, variant: RowVariant = 'row') =>
    currencies.map((c) => (
      <td
        key={c}
        className={cn(
          TD,
          'text-right tabular-nums',
          PAY_CELL,
          variant === 'sub' ? 'font-normal' : 'font-semibold',
          variant === 'total' && 'text-[15px]'
        )}
      >
        {money(v[c] ?? 0, c)}
      </td>
    ));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Total a pagar por productor / manager</CardTitle>
        <p className="text-sm text-muted-foreground">
          Todo el rango elegido. Hacé clic en un productor para ver privados, públicos, licitaciones, ACDI, etc.
        </p>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={cn(TH, 'text-left')}>Productor / Manager</th>
                <th className={cn(TH, 'text-right')}>Operaciones</th>
                {currencies.map((c) => (
                  <th key={c} className={cn(TH, 'text-right font-semibold', PAY_CELL)}>
                    A pagar {currencyLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alycs.map((alyc) => {
                const st = ALYC_STYLE[alyc];
                const rows = all
                  .filter((p) => p.alyc === alyc)
                  .sort(
                    (a, b) =>
                      (a.persona == null ? 1 : 0) - (b.persona == null ? 1 : 0) ||
                      (a.persona ?? '').localeCompare(b.persona ?? '', 'es')
                  );
                const subtotal: Record<string, number> = {};
                for (const p of rows) for (const [c, v] of Object.entries(p.aPagar)) addTo(subtotal, c, v);
                const alone = rows.length === 1;
                return (
                  <Fragment key={alyc}>
                    {!alone && (
                      <tr className={cn('border-y', st.band)}>
                        <td className={cn(TD, 'py-2.5')}>
                          <span className="inline-flex items-center gap-2">
                            <AlycBadge alyc={alyc} />
                            {multiAlyc && <span className="text-xs font-medium text-muted-foreground">Subtotal</span>}
                          </span>
                        </td>
                        <td className={cn(TD, 'text-right tabular-nums text-muted-foreground')}>
                          {multiAlyc && rows.reduce((s, p) => s + p.rows, 0).toLocaleString('es-AR')}
                        </td>
                        {multiAlyc ? amountCells(subtotal, 'subtotal') : <td colSpan={currencies.length} />}
                      </tr>
                    )}
                    {rows.map((p) => {
                      const expandable = p.byTipo.size > 1;
                      const isOpen = open.has(p.key);
                      const tipos = [...p.byTipo.values()];
                      return (
                        <Fragment key={p.key}>
                          <tr
                            className={cn(
                              'border-b border-border/60',
                              expandable && 'cursor-pointer hover:bg-muted/50',
                              isOpen && 'bg-muted/40'
                            )}
                            onClick={expandable ? () => toggle(p.key) : undefined}
                          >
                            <td
                              className={cn(
                                TD,
                                'border-l-[3px] font-medium',
                                isOpen ? st.accent : 'border-l-transparent',
                                !p.persona && 'italic text-muted-foreground'
                              )}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <Expander open={isOpen} visible={expandable} />
                                {alone && <AlycBadge alyc={alyc} />}
                                {personaLabel(p)}
                                {expandable && !isOpen && <CountPill>{p.byTipo.size} tipos</CountPill>}
                              </span>
                            </td>
                            <td className={cn(TD, 'text-right tabular-nums text-muted-foreground')}>
                              {p.rows.toLocaleString('es-AR')}
                            </td>
                            {amountCells(p.aPagar)}
                          </tr>
                          {isOpen &&
                            tipos.map((t, i) => (
                              <tr
                                key={t.label}
                                className={cn('text-[13px]', st.band, i === tipos.length - 1 && 'border-b border-border/60')}
                              >
                                <td className={cn(TD, 'border-l-[3px] py-1.5 pl-10', st.accent)} colSpan={2}>
                                  <span className="inline-flex items-center gap-2">
                                    <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                                    {t.label}
                                  </span>
                                </td>
                                {amountCells(t.aPagar, 'sub')}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            {all.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-foreground/20 bg-muted/60 font-semibold">
                  <td className={cn(TD, 'py-2.5')} colSpan={2}>
                    Total
                  </td>
                  {amountCells(Object.fromEntries(report.byCurrency.map((c) => [c.currency, c.aPagar])), 'total')}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Resumen de un período: una fila por moneda con lo que paga cada broker. */
function PeriodSummary({ blocks }: { blocks: NetBlock[] }) {
  const alycs = NET_ALYCS.filter((a) => blocks.some((b) => b.byAlyc.some((x) => x.alyc === a)));
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left font-medium">Moneda</th>
            <th className="p-2 text-right font-medium">Bruto</th>
            {alycs.map((a) => (
              <th key={a} className="p-2 text-right font-medium">
                A pagar {a}
              </th>
            ))}
            <th className={cn('p-2 text-right font-semibold', PAY_CELL)}>Total a pagar</th>
            <th className="p-2 text-right font-medium">Alíc. neta</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.currency} className="border-b border-border/50 last:border-0">
              <td className="p-2 font-medium">{currencyLabel(b.currency)}</td>
              <td className="p-2 text-right tabular-nums text-muted-foreground">{money(b.totals.brutoAjustado, b.currency)}</td>
              {alycs.map((a) => (
                <td key={a} className="p-2 text-right tabular-nums">
                  {money(b.byAlyc.find((x) => x.alyc === a)?.totals.aPagar ?? 0, b.currency)}
                </td>
              ))}
              <td className={cn('p-2 text-right font-semibold tabular-nums', PAY_CELL)}>{money(b.totals.aPagar, b.currency)}</td>
              <td className="p-2 text-right text-xs tabular-nums text-muted-foreground">
                {b.totals.alicuota != null ? pct(b.totals.alicuota) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExcludedNote({ excluded, currency }: { excluded: NetBlock['excluded']; currency: string }) {
  if (excluded.length === 0) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      No incluido en el cálculo:{' '}
      {excluded.map((e) => `${e.label}: ${formatMoney(e.amount, currency)} (${e.rows} op.)`).join(' · ')}
    </p>
  );
}

function TotalsSummary({ report }: { report: NetReport }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {report.byCurrency.map((t) => (
          <Card key={t.currency}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase text-muted-foreground">Total a pagar · {currencyLabel(t.currency)}</p>
              <p className="text-2xl font-semibold tabular-nums">{formatMoney(t.aPagar, t.currency)}</p>
              <p className="text-xs text-muted-foreground">
                sobre {formatMoney(t.bruto, t.currency)} de bruto
                {t.bruto !== 0 && ` · alícuota neta ${pct(t.aPagar / t.bruto)}`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {report.totals.map((t) => (
          <span key={`${t.alyc}|${t.currency}`}>
            {t.alyc} · {currencyLabel(t.currency)}:{' '}
            <span className="font-medium tabular-nums text-foreground">{formatMoney(t.totals.aPagar, t.currency)}</span>
            {t.totals.alicuota != null && ` (${pct(t.totals.alicuota)} de ${formatMoney(t.totals.brutoAjustado, t.currency)})`}
          </span>
        ))}
      </div>
    </div>
  );
}

function RulesCard({ report }: { report: NetReport | undefined }) {
  if (!report) return null;
  const rules: NetRuleVersion = report.currentRules;
  return (
    <Card>
      <CardContent className="space-y-1 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Cómo se calcula · alícuotas vigentes desde {formatDate(rules.valid_from)}{' '}
          <Link href="/aranceles/configuracion" className="font-normal underline">
            (editar en Configuración)
          </Link>
        </p>
        <p>
          <span className="font-medium text-foreground">GMA:</span> a pagar = {pct(rules.gma_share)} del bruto.
        </p>
        <p>
          <span className="font-medium text-foreground">IEB:</span> bruto ajustado = bruto + notas de débito/crédito
          (con su signo, en el tipo que indica su especie) · IIBB = {pct(rules.iibb_rate)} del bruto ajustado ·
          Comisión neta = bruto ajustado − IIBB · A pagar = comisión neta × distribución ÷ IVA.
        </p>
        <p>
          {NET_BUCKETS.map((b) => {
            const r = rules.buckets[b];
            const iva =
              r.iva_pesos !== 1 && r.iva_dolares !== 1
                ? ` ÷ ${r.iva_pesos.toLocaleString('es-AR')}`
                : r.iva_pesos !== 1
                  ? ` ÷ ${r.iva_pesos.toLocaleString('es-AR')} sólo en pesos`
                  : r.iva_dolares !== 1
                    ? ` ÷ ${r.iva_dolares.toLocaleString('es-AR')} sólo en dólares`
                    : '';
            return `${NET_BUCKET_LABEL[b]} ${pct(r.share)}${iva}`;
          }).join(' · ')}
        </p>
        {(report.ruleVersionsUsed > 1 || report.agreementRows > 0) && (
          <p className="text-amber-700 dark:text-amber-400">
            {report.ruleVersionsUsed > 1 &&
              `En este rango se aplicaron ${report.ruleVersionsUsed} versiones de alícuotas según la fecha de cada operación. `}
            {report.agreementRows > 0 && `${report.agreementRows} operaciones se liquidaron con un arreglo comercial.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ArancelesTotalesNetosPage() {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { data, loading, error, reload } = useArancelesReport<NetReport>('net', filters);
  const report = data?.report;

  const periods = report ? [...new Set(report.blocks.map((b) => b.period))] : [];
  const allOpen = periods.length > 0 && periods.every((p) => open.has(p));
  const toggle = (p: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="space-y-6">
      <ReportFiltersBar
        filters={filters}
        onChange={setFilters}
        alycs={data?.alycs ?? []}
        months={data?.months}
        segmentOptions={data?.segmentOptions}
      />

      {loading && !data && <LoadingBlock label="Calculando el neto…" />}
      {error && <ErrorBlock message={error} onRetry={() => void reload()} />}

      {report && report.blocks.length === 0 && (
        <EmptyBlock title="No hay aranceles para liquidar" description="Con estos filtros no hay operaciones de IEB ni de GMA." />
      )}

      {report && report.blocks.length > 0 && (
        <div className={cn('space-y-6', loading && 'opacity-60 transition-opacity')}>
          <TotalsSummary report={report} />
          <PersonaTotals report={report} />

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setOpen(allOpen ? new Set() : new Set(periods))}>
              {allOpen ? 'Contraer todo' : 'Ampliar todo'}
            </Button>
          </div>

          {periods.map((period) => {
            const blocks = report.blocks.filter((b) => b.period === period);
            const isOpen = open.has(period);
            return (
              <Card key={period}>
                <CardHeader className="pb-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    aria-expanded={isOpen}
                    onClick={() => toggle(period)}
                  >
                    <CardTitle className="text-lg capitalize">{formatPeriod(period)}</CardTitle>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      {isOpen ? 'Ocultar detalle' : 'Ver detalle'}
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                </CardHeader>
                <CardContent className="space-y-5">
                  <PeriodSummary blocks={blocks} />
                  {isOpen && (
                    <div className="space-y-4 border-t pt-5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Detalle por productor / manager · hacé clic en una fila para abrir los tipos
                      </p>
                      {blocks.map((b) => (
                        <div key={b.currency} className="overflow-hidden rounded-lg border">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted/40 px-3 py-2">
                            <p className="text-sm font-semibold">{currencyLabel(b.currency)}</p>
                            <p className="text-xs text-muted-foreground">
                              IEB hoja {b.sheet} · Productor / Manager:{' '}
                              {b.byAlyc.map((x) => `${x.alyc} ${PERSONA_SOURCE[x.alyc]} del archivo`).join(', ')}; si no
                              figura, manager del mapping de cuentas
                            </p>
                          </div>
                          {b.lines.length > 0 ? (
                            <DetailTable block={b} />
                          ) : (
                            <div className="space-y-1 p-3">
                              <p className="text-sm text-muted-foreground">Sin aranceles liquidables.</p>
                              <ExcludedNote excluded={b.excluded} currency={b.currency} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {report.otherAlycRows > 0 && (
            <p className="text-xs text-muted-foreground">
              {report.otherAlycRows} operaciones de otras ALYC no tienen regla de neto y no entran en esta liquidación.
            </p>
          )}
        </div>
      )}

      <RulesCard report={report} />
    </div>
  );
}
