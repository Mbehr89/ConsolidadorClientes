'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Stat,
  StatusBadge,
  FeeCell,
  OperationCell,
  inputClass,
  readJson,
  tradingGroupTitle,
} from '@/components/aranceles/shared';
import { ExcludePersonaBroker, MonthRangeSelects } from '@/components/aranceles/report-filters';
import { caucionLeg } from '@/lib/aranceles/categories';
import {
  CONTROL_STATUSES,
  CONTROL_STATUS_LABEL,
  type ControlRow,
  type ControlSort,
  type ControlSortKey,
  type ControlStatus,
  type TradingReview,
} from '@/lib/aranceles/control';
import { currencyLabel, formatDate, formatMoney, formatNumber, formatTotals } from '@/lib/aranceles/format';
import {
  SEGMENT_LABEL,
  SIN_ASIGNAR,
  SIN_ASIGNAR_LABEL,
  type SegmentOptions,
  type SegmentedCommission,
} from '@/lib/aranceles/segments';
import { cn } from '@/lib/utils';

const DEFAULT_SORT: ControlSort = { by: 'estado', dir: 'asc' };
/** Primer clic: fecha de la más nueva a la más vieja; boleto de menor a mayor. */
const FIRST_DIR: Record<ControlSortKey, ControlSort['dir']> = { estado: 'asc', fecha: 'desc', boleto: 'asc' };

type ControlResponse = {
  alycs: { name: string; rows: number }[];
  months: string[];
  segmentOptions: SegmentOptions;
  summary: { status: ControlStatus; count: number }[];
  senebi: SegmentedCommission[];
  trading: TradingReview<SegmentedCommission>[];
  total: number;
  rows: ControlRow<SegmentedCommission>[];
};

function SortHeader({
  by,
  label,
  sort,
  onSort,
}: {
  by: ControlSortKey;
  label: string;
  sort: ControlSort;
  onSort: (by: ControlSortKey) => void;
}) {
  const active = sort.by === by;
  const Icon = !active || by === 'estado' ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="p-2 text-left font-medium" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={cn('inline-flex items-center gap-1 uppercase hover:text-foreground', active && 'text-foreground')}
        onClick={() => onSort(by)}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5', !active && 'opacity-40')} />
      </button>
    </th>
  );
}

function ControlStatusCell({ row }: { row: ControlRow<SegmentedCommission> }) {
  const s = row.control_status;
  const g = row.trading_group;
  return (
    <div className="flex flex-col items-start gap-1">
      {s === 'min_fee' ? (
        <Badge variant="outline" className="whitespace-nowrap">
          {CONTROL_STATUS_LABEL.min_fee}
        </Badge>
      ) : (
        <StatusBadge status={s} />
      )}
      {s === 'skipped' && caucionLeg(row.operation) === 'contado' && (
        <span className="text-xs text-muted-foreground">Pata contado: el arancel va en la pata futuro</span>
      )}
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

/** "1.234,56", "1234.56" o "1234,5" → número; vacío o inválido → null. */
function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function SenebiRow({ row, onSaved }: { row: SegmentedCommission; onSaved: () => void }) {
  const initial = row.manual_commission != null ? String(row.manual_commission).replace('.', ',') : '';
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(initial), [initial]);

  const parsed = parseAmount(value);
  const invalid = value.trim() !== '' && parsed == null;
  const dirty = value.trim() !== initial;

  const save = async () => {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/aranceles/manual-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, amount: parsed }),
      });
      const json = await readJson<{ id: string }>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar el importe');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  const charged = row.manual_commission != null;
  return (
    <tr className="border-b border-border/50">
      <td className="whitespace-nowrap p-2">{formatDate(row.trade_date)}</td>
      <td className="p-2 font-mono text-xs tabular-nums">{row.op_number ?? '—'}</td>
      <td className="p-2">{row.alyc}</td>
      <td className={cn('p-2', !row.manager && 'italic text-muted-foreground')}>{row.manager ?? SIN_ASIGNAR_LABEL}</td>
      <td className="p-2">
        <div>{row.client}</div>
        {row.client_external_id && <div className="text-xs text-muted-foreground">Cta. {row.client_external_id}</div>}
      </td>
      <td className="p-2 text-xs">
        <OperationCell operation={row.operation} />
      </td>
      <td className="p-2 font-mono text-xs text-muted-foreground">{row.instrument ?? '—'}</td>
      <td className="p-2 text-right tabular-nums text-muted-foreground">
        {row.amount != null ? formatMoney(row.amount, row.currency) : '—'}
      </td>
      <td className="p-2">
        <form
          className="flex items-center justify-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="text-xs text-muted-foreground">{currencyLabel(row.currency)}</span>
          <input
            className={cn(inputClass, 'h-8 w-28 text-right tabular-nums', invalid && 'border-destructive')}
            inputMode="decimal"
            placeholder="0,00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`Importe a cobrar, boleto ${row.op_number ?? ''}`}
          />
          <Button type="submit" size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || invalid || saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
        {error && <p className="mt-1 text-right text-xs text-destructive">{error}</p>}
      </td>
      <td className="p-2">
        <Badge variant={charged ? 'success' : 'warning'}>{charged ? 'Cargado' : 'Pendiente'}</Badge>
      </td>
    </tr>
  );
}

function SenebiCard({ rows, onSaved }: { rows: SegmentedCommission[]; onSaved: () => void }) {
  if (rows.length === 0) return null;
  const pending = rows.filter((r) => r.manual_commission == null).length;
  const charged: Record<string, number> = {};
  for (const r of rows) {
    if (r.manual_commission != null) charged[r.currency] = (charged[r.currency] ?? 0) + r.manual_commission;
  }
  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">SENEBI · arancel a cobrar</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={pending > 0 ? 'warning' : 'success'}>
              {pending > 0 ? `${pending} pendiente${pending === 1 ? '' : 's'}` : 'Todas cargadas'}
            </Badge>
            {Object.keys(charged).length > 0 && (
              <span className="text-muted-foreground">
                Cargado: <span className="font-medium text-foreground">{formatTotals(charged)}</span>
              </span>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          La ALYC liquida estas operaciones sin arancel. Cargá el importe a cobrar en la moneda de la operación: se suma
          al bruto y al neto de los reportes. Para borrarlo, dejá el campo vacío y guardá.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="p-2 text-left font-medium">Fecha</th>
                <th className="p-2 text-left font-medium">Boleto</th>
                <th className="p-2 text-left font-medium">ALYC</th>
                <th className="p-2 text-left font-medium">Productor / Manager</th>
                <th className="p-2 text-left font-medium">Cliente</th>
                <th className="p-2 text-left font-medium">Operación</th>
                <th className="p-2 text-left font-medium">Instrumento</th>
                <th className="p-2 text-right font-medium">Bruto</th>
                <th className="p-2 text-right font-medium">Importe a cobrar</th>
                <th className="p-2 text-left font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SenebiRow key={r.id} row={r} onSaved={onSaved} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const SIDE_LABEL = { buy: 'Compra', sell: 'Venta' } as const;

function TradingGroupBlock({ group }: { group: TradingReview<SegmentedCommission> }) {
  const first = group.members[0];
  const counterpart = group.members.filter((m) => m.control_status == null && m.commission > 0);
  const diff = Math.max(group.sells, group.buys) > 0 ? Math.abs(group.sells - group.buys) / Math.max(group.sells, group.buys) : 0;
  const byQuantity = group.basis === 'cantidad';
  const sideSummary = (side: 'buy' | 'sell') => {
    const legs = group.members.filter((m) => m.side === side);
    const amounts: Record<string, number> = {};
    for (const m of legs) amounts[m.currency] = (amounts[m.currency] ?? 0) + Math.abs(m.amount ?? 0);
    const units = side === 'sell' ? group.sells : group.buys;
    return (
      <>
        {byQuantity && (
          <span className="font-medium">
            {formatNumber(units)} {group.instrument ?? ''}
          </span>
        )}
        {byQuantity ? ' (' : ''}
        <span className={byQuantity ? undefined : 'font-medium'}>{formatTotals(amounts)}</span>
        {byQuantity ? ')' : ''}
        <span className="text-muted-foreground"> · {legs.length} boleto{legs.length === 1 ? '' : 's'}</span>
      </>
    );
  };
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="space-y-1 border-b bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm">
            <span className="font-semibold">{group.client}</span>
            {group.client_external_id && <span className="text-muted-foreground"> · Cta. {group.client_external_id}</span>}
            <span className="text-muted-foreground">
              {' '}
              · {group.alyc} · {first?.manager ?? SIN_ASIGNAR_LABEL} · {formatDate(group.trade_date)} ·{' '}
              {group.consecutive
                ? `boletos ${group.from}–${group.to}`
                : `boletos ${group.members.map((m) => m.op_number ?? '—').join(', ')}`}
            </span>
            <Badge variant="outline" className="ml-2 align-middle text-xs">
              {group.consecutive ? 'Boletos seguidos' : 'Mismo día'}
            </Badge>
          </p>
          <p className="flex flex-wrap gap-x-4 text-sm tabular-nums">
            <span>Ventas: {sideSummary('sell')}</span>
            <span>Compras: {sideSummary('buy')}</span>
            <span className="text-muted-foreground">
              Dif. {byQuantity ? 'en nominales ' : ''}
              {(diff * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%
            </span>
            <span>
              Arancel cobrado: <span className="font-medium">{formatTotals(group.charged)}</span>
            </span>
          </p>
        </div>
        {counterpart.length > 0 ? (
          <p className="text-xs text-teal-600 dark:text-teal-400">
            Arancel cobrado en{' '}
            {counterpart
              .map(
                (m) =>
                  `boleto ${m.op_number ?? '—'} (${m.side ? SIDE_LABEL[m.side].toLowerCase() : m.operation} ${m.instrument ?? ''}: ${formatMoney(m.commission, m.commission_currency)})`
              )
              .join(', ')}
          </p>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">Ninguna de las patas cobró el arancel completo.</p>
        )}
      </div>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left font-medium">Boleto</th>
            <th className="p-2 text-left font-medium">Operación</th>
            <th className="p-2 text-left font-medium">Instrumento</th>
            <th className="p-2 text-right font-medium">Bruto</th>
            <th className="p-2 text-right font-medium">Arancel</th>
            <th className="p-2 text-left font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {group.members.map((m) => {
            const isCounterpart = m.control_status == null && m.commission > 0;
            return (
              <tr
                key={m.id}
                className={cn('border-b border-border/40 last:border-0', isCounterpart && 'bg-teal-100/50 dark:bg-teal-600/10')}
              >
                <td className="p-2 font-mono text-xs tabular-nums">{m.op_number ?? '—'}</td>
                <td className="p-2">{m.side ? SIDE_LABEL[m.side] : m.operation ?? '—'}</td>
                <td className="p-2 font-mono text-xs text-muted-foreground">{m.instrument ?? '—'}</td>
                <td className="p-2 text-right tabular-nums">
                  {m.amount != null ? formatMoney(Math.abs(m.amount), m.currency) : '—'}
                </td>
                <td className="p-2 text-right tabular-nums">
                  <FeeCell row={m} />
                </td>
                <td className="p-2">
                  {isCounterpart ? (
                    <Badge variant="success">Cobró arancel</Badge>
                  ) : m.control_status === 'min_fee' ? (
                    <Badge variant="outline">{CONTROL_STATUS_LABEL.min_fee}</Badge>
                  ) : m.control_status ? (
                    <StatusBadge status={m.control_status} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradingCard({ groups }: { groups: TradingReview<SegmentedCommission>[] }) {
  if (groups.length === 0) return null;
  return (
    <Card className="border-sky-300 dark:border-sky-700">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-lg">
          Posible trading · {groups.length} grupo{groups.length === 1 ? '' : 's'} para revisar
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Compras y ventas del mismo cliente y día que se compensan (primero boletos seguidos, después cualquier
          boleto del día): por importe si son de la misma moneda, o por cantidad de la misma especie si son de
          monedas distintas (p. ej. dólar MEP / cable). Suele cobrarse el arancel en una sola de las patas: en verde,
          la operación donde sí se cobró.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((g) => (
          <div key={g.id} className="overflow-auto">
            <TradingGroupBlock group={g} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ArancelesControlPage() {
  const [alyc, setAlyc] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [manager, setManager] = useState('');
  const [excluir, setExcluir] = useState('');
  const [statusFilter, setStatusFilter] = useState<ControlStatus | ''>('');
  const [sort, setSort] = useState<ControlSort>(DEFAULT_SORT);
  const [data, setData] = useState<ControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (alyc) p.set('alyc', alyc);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (manager) p.set('manager', manager);
      if (excluir) p.set('excluir', excluir);
      if (statusFilter) p.set('status', statusFilter);
      p.set('sort', sort.by);
      p.set('dir', sort.dir);
      const res = await fetch(`/api/aranceles/control?${p.toString()}`, { cache: 'no-store' });
      const json = await readJson<ControlResponse>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar control');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [alyc, from, to, manager, excluir, statusFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSort = (by: ControlSortKey) =>
    setSort((prev) =>
      prev.by === by && by !== 'estado' ? { by, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: FIRST_DIR[by] }
    );
  const rows = data?.rows ?? [];
  const total = data?.summary.reduce((s, x) => s + x.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Operaciones donde la ALYC no informó arancel, cobró cero, cobró menos que lo habitual o sólo el mínimo, y las que
        el archivo trae sin arancel por ser lo habitual (p. ej. la pata contado de una caución). Sirve para reclamar lo
        que no se liquidó.
      </p>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs text-muted-foreground">
            ALYC
            <select className={inputClass} value={alyc} onChange={(e) => setAlyc(e.target.value)}>
              <option value="">Todas</option>
              {data?.alycs.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <MonthRangeSelects
            from={from}
            to={to}
            months={data?.months}
            onChange={(r) => {
              setFrom(r.from);
              setTo(r.to);
            }}
          />
          <label className="space-y-1 text-xs text-muted-foreground">
            {SEGMENT_LABEL.manager}
            <select className={inputClass} value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">Todos</option>
              {data?.segmentOptions.manager.map((o) => (
                <option key={o} value={o}>
                  {o === SIN_ASIGNAR ? SIN_ASIGNAR_LABEL : o}
                </option>
              ))}
            </select>
          </label>
          <ExcludePersonaBroker value={excluir} options={data?.segmentOptions.excluir ?? []} onChange={setExcluir} />
        </CardContent>
      </Card>

      {loading && !data && <LoadingBlock label="Revisando operaciones…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {data && (
        <>
          <SenebiCard rows={data.senebi} onSaved={() => void load()} />
          <TradingCard groups={data.trading} />

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <button type="button" className="text-left" onClick={() => setStatusFilter('')}>
              <Stat label="A revisar" value={formatNumber(total)} hint={statusFilter ? 'Ver todas' : undefined} />
            </button>
            {CONTROL_STATUSES.map((s) => {
              const count = data.summary.find((x) => x.status === s)?.count ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  className={statusFilter === s ? 'rounded-lg text-left ring-2 ring-primary' : 'text-left'}
                  onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                >
                  <Stat label={CONTROL_STATUS_LABEL[s]} value={formatNumber(count)} />
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <EmptyBlock
              title="Nada para revisar"
              description="Si una ALYC no informa arancel, cobra cero o por debajo de la tarifa sugerida, aparece acá."
              action={
                total === 0 && data.senebi.length === 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/aranceles/importar">Importar planillas</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[640px] overflow-auto">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead className="sticky top-0 border-b bg-card">
                      <tr className="text-xs uppercase text-muted-foreground">
                        <SortHeader by="estado" label="Estado" sort={sort} onSort={onSort} />
                        <SortHeader by="fecha" label="Fecha" sort={sort} onSort={onSort} />
                        <SortHeader by="boleto" label="Boleto" sort={sort} onSort={onSort} />
                        <th className="p-2 text-left font-medium">ALYC</th>
                        <th className="p-2 text-left font-medium">Productor / Manager</th>
                        <th className="p-2 text-left font-medium">Cliente</th>
                        <th className="p-2 text-left font-medium">Operación</th>
                        <th className="p-2 text-left font-medium">Instrumento</th>
                        <th className="p-2 text-right font-medium">Bruto</th>
                        <th className="p-2 text-right font-medium">Cobrado</th>
                        <th className="p-2 text-right font-medium" title="Fijo o mínimo habitual del cliente / ALYC">
                          Referencia
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
                          <td className="p-2">
                            <ControlStatusCell row={r} />
                          </td>
                          <td className="whitespace-nowrap p-2">{formatDate(r.trade_date)}</td>
                          <td className="p-2 font-mono text-xs tabular-nums">{r.op_number ?? '—'}</td>
                          <td className="p-2">{r.alyc}</td>
                          <td className={cn('p-2', !r.manager && 'italic text-muted-foreground')}>
                            {r.manager ?? SIN_ASIGNAR_LABEL}
                          </td>
                          <td className="p-2">
                            <div>{r.client}</div>
                            {r.client_external_id && (
                              <div className="text-xs text-muted-foreground">Cta. {r.client_external_id}</div>
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            <OperationCell operation={r.operation} />
                          </td>
                          <td className="p-2 font-mono text-xs text-muted-foreground">{r.instrument ?? '—'}</td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">
                            {r.amount != null ? formatMoney(r.amount, r.currency) : '—'}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            <FeeCell row={r} />
                          </td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">
                            {r.expected_commission != null ? formatMoney(r.expected_commission, r.currency) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.total > data.rows.length && (
                  <p className="p-3 text-xs text-muted-foreground">
                    Mostrando {data.rows.length} de {data.total}. Filtrá por ALYC o fechas para acotar.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
