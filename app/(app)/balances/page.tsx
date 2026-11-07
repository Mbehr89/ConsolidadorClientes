'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyBlock, ErrorBlock, LoadingBlock, inputClass } from '@/components/aranceles/shared';
import { formatMoney, formatMonthLong } from '@/lib/aranceles/format';
import {
  EXPENSE_KIND_LABEL,
  EXPENSE_KINDS,
  type BalanceExpense,
  type BalancePartner,
  type BalancesConfig,
  type ExpenseKind,
} from '@/lib/balances/config';
import {
  buildMonthBalances,
  type DisplayCurrency,
  type IncomeCell,
  type MonthBalance,
} from '@/lib/balances/compute';
import { cn } from '@/lib/utils';

type Payload = {
  config: BalancesConfig;
  income: IncomeCell[];
  grupos: string[];
};

const ALL = '*';
const NONE = '';

function parseAmount(raw: string): number | null {
  const n = Number(raw.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseShare(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n / 100;
}

function shareText(value: number): string {
  return String(Math.round(value * 10000) / 100);
}

function money(value: number | null, currency: DisplayCurrency): string {
  return value === null ? '—' : formatMoney(value, currency);
}

function grupoKey(grupo: string | null): string {
  return grupo ?? NONE;
}

export default function BalancesPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [config, setConfig] = useState<BalancesConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<string>(ALL);
  const [display, setDisplay] = useState<DisplayCurrency>('ARS');
  const saveSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/balances');
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || 'No se pudo armar el balance.');
      setPayload(body);
      setConfig(body.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo armar el balance.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next: BalancesConfig) => {
    const seq = ++saveSeq.current;
    setStatus('guardando');
    setSaveError(null);
    try {
      const res = await fetch('/api/balances', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: next }),
      });
      const body = (await res.json()) as { config?: BalancesConfig; error?: string };
      if (seq !== saveSeq.current) return;
      if (!res.ok || !body.config) throw new Error(body.error || 'No se pudo guardar.');
      setStatus('guardado');
    } catch (err) {
      if (seq !== saveSeq.current) return;
      setStatus('error');
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback(
    (next: BalancesConfig) => {
      setConfig(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(next), 400);
    },
    [persist]
  );

  const income = payload?.income ?? [];
  const grupos = payload?.grupos ?? [];
  const months = useMemo(() => {
    if (!config) return [];
    const selected = grupo === ALL ? '*' : grupo === NONE ? null : grupo;
    return buildMonthBalances(income, config, selected, display).slice().reverse();
  }, [config, income, grupo, display]);

  const totals = useMemo(() => {
    const closed = months.filter((m) => !m.missingFx);
    const sum = (pick: (m: MonthBalance) => number | null) => closed.reduce((s, m) => s + (pick(m) ?? 0), 0);
    return {
      income: months.length && closed.length === months.length ? sum((m) => m.income) : closed.length ? sum((m) => m.income) : null,
      salaries: closed.length ? sum((m) => m.salaries) : null,
      expenses: closed.length ? sum((m) => m.expenses) : null,
      result: months.every((m) => !m.missingFx) ? sum((m) => m.result) : null,
      partial: closed.length > 0 && closed.length < months.length,
    };
  }, [months]);

  if (loading) {
    return (
      <div className="page-shell max-w-6xl">
        <LoadingBlock label="Armando el balance…" />
      </div>
    );
  }
  if (error || !config) {
    return (
      <div className="page-shell max-w-6xl">
        <ErrorBlock message={error ?? 'No se pudo armar el balance.'} onRetry={() => void load()} />
      </div>
    );
  }

  const selectedGrupo = grupo === ALL || grupo === NONE ? null : grupo;
  const editingGroup = grupo !== ALL;

  return (
    <div className="page-shell max-w-6xl space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Balances</h2>
          <p className="page-subtitle">
            Resultado de cada grupo de asesores: el neto de aranceles, menos sueldos y gastos. Los dólares de cada mes se
            valúan al tipo de cambio que cargues y el flujo se ve entero en pesos o en dólares.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {status === 'guardando' && 'Guardando…'}
          {status === 'guardado' && 'Guardado'}
          {status === 'error' && (saveError ?? 'No se pudo guardar')}
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto pb-1">
          <GroupTab active={grupo === ALL} onClick={() => setGrupo(ALL)}>
            Todos
          </GroupTab>
          {grupos.map((g) => (
            <GroupTab key={g} active={grupo === g} onClick={() => setGrupo(g)}>
              {g}
            </GroupTab>
          ))}
          <GroupTab active={grupo === NONE} onClick={() => setGrupo(NONE)}>
            Sin grupo
          </GroupTab>
        </div>
        <div className="inline-flex shrink-0 rounded-md border border-border p-0.5">
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="Ingresos"
          value={money(totals.income, display)}
          hint={
            totals.result === null && months.some((m) => m.missingFx)
              ? 'Suma sólo los meses que ya tienen tipo de cambio'
              : 'Aranceles a pagar'
          }
        />
        <Summary
          label="Sueldos y gastos"
          value={
            totals.salaries === null || totals.expenses === null
              ? '—'
              : money(totals.salaries + totals.expenses, display)
          }
          hint="Se restan del ingreso"
        />
        <Summary
          label="Resultado"
          value={money(totals.result, display)}
          hint={totals.result === null && months.some((m) => m.missingFx) ? 'Falta el tipo de cambio de algún mes' : 'Ingresos menos egresos'}
        />
      </div>

      {editingGroup && (
        <PartnersCard
          grupo={selectedGrupo}
          partners={config.partners.filter((p) => grupoKey(p.grupo) === grupo)}
          onChange={(partners) =>
            update({
              ...config,
              partners: [...config.partners.filter((p) => grupoKey(p.grupo) !== grupo), ...partners],
            })
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Flujo mensual</CardTitle>
          <CardDescription>
            El dólar cable se suma al billete y usa el mismo tipo de cambio. El resultado de cada socio es el resultado
            del grupo por su % de beneficio. Al lado queda lo que sería por su % de equity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {months.length === 0 ? (
            <EmptyBlock
              title="Este grupo todavía no tiene flujo"
              description="Cuando haya aranceles devengados de sus cuentas, o cargues un sueldo o un gasto, el mes aparece acá."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Mes</th>
                    <th className="px-2 py-2 text-right font-medium">Aranceles $</th>
                    <th className="px-2 py-2 text-right font-medium">Aranceles U$D</th>
                    <th className="px-2 py-2 font-medium">Tipo de cambio</th>
                    <th className="px-2 py-2 text-right font-medium">Ingresos</th>
                    <th className="px-2 py-2 text-right font-medium">Sueldos</th>
                    <th className="px-2 py-2 text-right font-medium">Gastos</th>
                    <th className="px-2 py-2 text-right font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <MonthRows
                      key={m.month}
                      month={m}
                      display={display}
                      showPartners={editingGroup}
                      rate={config.fx.find((f) => f.month === m.month)?.arsPerUsd ?? null}
                      onRate={(rate) => {
                        const fx = config.fx.filter((f) => f.month !== m.month);
                        update({ ...config, fx: rate ? [...fx, { month: m.month, arsPerUsd: rate }] : fx });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ExpensesCard
        config={config}
        grupo={editingGroup ? selectedGrupo : undefined}
        grupos={grupos}
        defaultMonth={months[0]?.month ?? new Date().toISOString().slice(0, 7)}
        onChange={(expenses) => update({ ...config, expenses })}
      />
    </div>
  );
}

function GroupTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-md px-3 py-1.5 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function PartnersCard({
  grupo,
  partners,
  onChange,
}: {
  grupo: string | null;
  partners: BalancePartner[];
  onChange: (partners: BalancePartner[]) => void;
}) {
  const [name, setName] = useState('');
  const [equity, setEquity] = useState('50');
  const [profit, setProfit] = useState('50');
  const profitSum = partners.reduce((s, p) => s + p.profit, 0);
  const equitySum = partners.reduce((s, p) => s + p.equity, 0);

  function add() {
    const eq = parseShare(equity);
    const pr = parseShare(profit);
    const label = name.trim();
    if (!label || eq === null || pr === null) return;
    onChange([
      ...partners,
      { id: crypto.randomUUID(), name: label, grupo, equity: eq, profit: pr },
    ]);
    setName('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Socios</CardTitle>
        <CardDescription>
          El % de beneficio reparte el resultado del grupo. El % de equity es la participación en el capital y se muestra
          al lado, sin mezclarse con el reparto.
          {partners.length > 0 && (
            <>
              {' '}
              Beneficio asignado {(profitSum * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%. Capital{' '}
              {(equitySum * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%.
              {Math.abs(profitSum - 1) > 0.0001 && ' El beneficio que no suma 100% queda sin asignar.'}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {partners.length === 0 && (
          <p className="text-sm text-muted-foreground">Este grupo todavía no tiene socios. El resultado se ve igual, sin repartir.</p>
        )}
        <ul className="space-y-2">
          {partners.map((p) => (
            <li key={p.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
              <input
                className={inputClass}
                aria-label={`Nombre de ${p.name}`}
                defaultValue={p.name}
                key={`${p.id}-name`}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (!name) {
                    e.target.value = p.name;
                    return;
                  }
                  if (name !== p.name) onChange(partners.map((x) => (x.id === p.id ? { ...x, name } : x)));
                }}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Equity
                <input
                  className={inputClass}
                  inputMode="decimal"
                  aria-label={`Equity de ${p.name}`}
                  defaultValue={shareText(p.equity)}
                  key={`${p.id}-eq-${p.equity}`}
                  onBlur={(e) => {
                    const n = parseShare(e.target.value);
                    if (n === null) {
                      e.target.value = shareText(p.equity);
                      return;
                    }
                    onChange(partners.map((x) => (x.id === p.id ? { ...x, equity: n } : x)));
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Beneficio
                <input
                  className={inputClass}
                  inputMode="decimal"
                  aria-label={`Beneficio de ${p.name}`}
                  defaultValue={shareText(p.profit)}
                  key={`${p.id}-pr-${p.profit}`}
                  onBlur={(e) => {
                    const n = parseShare(e.target.value);
                    if (n === null) {
                      e.target.value = shareText(p.profit);
                      return;
                    }
                    onChange(partners.map((x) => (x.id === p.id ? { ...x, profit: n } : x)));
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar a ${p.name}`}
                onClick={() => onChange(partners.filter((x) => x.id !== p.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className={inputClass}
            placeholder="Nombre del socio"
            aria-label="Nombre del socio"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input className={inputClass} inputMode="decimal" aria-label="Equity del socio nuevo" placeholder="Equity %" value={equity} onChange={(e) => setEquity(e.target.value)} />
          <input className={inputClass} inputMode="decimal" aria-label="Beneficio del socio nuevo" placeholder="Beneficio %" value={profit} onChange={(e) => setProfit(e.target.value)} />
          <Button type="submit" size="sm" disabled={!name.trim() || parseShare(equity) === null || parseShare(profit) === null}>
            <Plus className="mr-1 h-4 w-4" />
            Agregar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MonthRows({
  month,
  display,
  showPartners,
  rate,
  onRate,
}: {
  month: MonthBalance;
  display: DisplayCurrency;
  showPartners: boolean;
  rate: number | null;
  onRate: (rate: number | null) => void;
}) {
  return (
    <>
      <tr className="border-b align-middle">
        <td className="px-2 py-2 capitalize">{formatMonthLong(month.month)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(month.arsIncome, 'ARS')}</td>
        <td className="px-2 py-2 text-right tabular-nums">
          {formatMoney(month.usdIncome, 'USD')}
          {month.cableIncome !== 0 && (
            <span className="block text-xs text-muted-foreground">incluye cable {formatMoney(month.cableIncome, 'USD')}</span>
          )}
        </td>
        <td className="px-2 py-2">
          <input
            className={cn(inputClass, 'w-28')}
            inputMode="decimal"
            aria-label={`Tipo de cambio de ${formatMonthLong(month.month)}`}
            placeholder="$ por U$D"
            defaultValue={rate ?? ''}
            key={`${month.month}-${rate ?? ''}`}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                onRate(null);
                return;
              }
              const n = parseAmount(raw);
              if (n === null || n === 0) {
                e.target.value = rate ? String(rate) : '';
                return;
              }
              onRate(n);
            }}
          />
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{money(month.income, display)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{money(month.salaries, display)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{money(month.expenses, display)}</td>
        <td className="px-2 py-2 text-right font-medium tabular-nums">{money(month.result, display)}</td>
      </tr>
      {showPartners && !month.missingFx && month.partners.length > 0 && (
        <tr className="border-b bg-muted/30">
          <td colSpan={8} className="px-2 py-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {month.partners.map((p) => (
                <span key={p.id}>
                  <span className="font-medium">{p.name}</span>{' '}
                  <span className="text-muted-foreground">
                    beneficio {(p.profit * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%
                  </span>{' '}
                  {money(p.byProfit, display)}
                  <span className="text-muted-foreground">
                    {' '}
                    · equity {(p.equity * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%{' '}
                    {money(p.byEquity, display)}
                  </span>
                </span>
              ))}
              {month.unassignedProfit !== null && Math.abs(month.unassignedProfit) > 0.005 && (
                <span className="text-muted-foreground">Sin asignar {money(month.unassignedProfit, display)}</span>
              )}
            </div>
          </td>
        </tr>
      )}
      {month.missingFx && (
        <tr className="border-b">
          <td colSpan={8} className="px-2 pb-2 text-xs text-amber-700 dark:text-amber-400">
            Sin tipo de cambio, {formatMonthLong(month.month)} queda en las dos monedas y no entra al resultado.
          </td>
        </tr>
      )}
    </>
  );
}

function ExpensesCard({
  config,
  grupo,
  grupos,
  defaultMonth,
  onChange,
}: {
  config: BalancesConfig;
  /** undefined = vista Todos: hay que elegir grupo en el formulario. */
  grupo: string | null | undefined;
  grupos: string[];
  defaultMonth: string;
  onChange: (expenses: BalanceExpense[]) => void;
}) {
  const [kind, setKind] = useState<ExpenseKind>('sueldo');
  const [label, setLabel] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [currency, setCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState(grupo ?? grupos[0] ?? NONE);

  useEffect(() => {
    if (grupo !== undefined) setTarget(grupo ?? NONE);
  }, [grupo]);

  const rows = config.expenses
    .filter((e) => grupo === undefined || grupoKey(e.grupo) === grupoKey(grupo ?? null))
    .slice()
    .sort((a, b) => b.month.localeCompare(a.month) || a.label.localeCompare(b.label));

  function add() {
    const value = parseAmount(amount);
    const text = label.trim();
    if (!text || value === null || value === 0 || !/^\d{4}-\d{2}$/.test(month)) return;
    const row: BalanceExpense = {
      id: crypto.randomUUID(),
      grupo: target === NONE ? null : target,
      kind,
      label: text,
      month,
      currency,
      amount: value,
    };
    onChange([...config.expenses, row]);
    setLabel('');
    setAmount('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sueldos y gastos</CardTitle>
        <CardDescription>
          Cada línea resta en el mes y el grupo que indiques. Un sueldo en dólares se valúa con el tipo de cambio de ese mes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select className={inputClass} aria-label="Tipo de gasto" value={kind} onChange={(e) => setKind(e.target.value as ExpenseKind)}>
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPENSE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input className={inputClass} placeholder="Concepto" aria-label="Concepto" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className={inputClass} type="month" aria-label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} />
          {grupo === undefined ? (
            <select className={inputClass} aria-label="Grupo del gasto" value={target} onChange={(e) => setTarget(e.target.value)}>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={NONE}>Sin grupo</option>
            </select>
          ) : (
            <select className={inputClass} aria-label="Moneda" value={currency} onChange={(e) => setCurrency(e.target.value as 'ARS' | 'USD')}>
              <option value="ARS">Pesos</option>
              <option value="USD">Dólares</option>
            </select>
          )}
          {grupo === undefined && (
            <select className={inputClass} aria-label="Moneda" value={currency} onChange={(e) => setCurrency(e.target.value as 'ARS' | 'USD')}>
              <option value="ARS">Pesos</option>
              <option value="USD">Dólares</option>
            </select>
          )}
          <input className={inputClass} inputMode="decimal" placeholder="Importe" aria-label="Importe" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button type="submit" className="lg:col-span-1" disabled={!label.trim() || parseAmount(amount) === null}>
            Agregar
          </Button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay sueldos ni gastos cargados.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {EXPENSE_KIND_LABEL[e.kind]} · {formatMonthLong(e.month)}
                    {grupo === undefined && ` · ${e.grupo ?? 'Sin grupo'}`}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar ${e.label}`}
                  onClick={() => onChange(config.expenses.filter((x) => x.id !== e.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
