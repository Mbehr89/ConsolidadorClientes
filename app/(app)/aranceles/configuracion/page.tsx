'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBlock, LoadingBlock, inputClass, readJson } from '@/components/aranceles/shared';
import { formatDate, formatTotals } from '@/lib/aranceles/format';
import type { AccountProducerChange, ProducerSummary } from '@/lib/aranceles/producers';
import {
  GMA_BUCKETS,
  GMA_BUCKET_LABEL,
  NET_BUCKETS,
  NET_BUCKET_LABEL,
  newSettingsId,
  personAlias,
  producerLabel,
  type ArancelesSettings,
  type PersonAlias,
  type BucketRule,
  type GmaBucket,
  type NetBucket,
  type NetRuleVersion,
  type ProducerAgreement,
  type ProducerInfo,
} from '@/lib/aranceles/settings';
import { cn } from '@/lib/utils';

type SettingsPayload = {
  settings: ArancelesSettings;
  currentRules: NetRuleVersion;
  producers: ProducerSummary[];
  accountChanges: AccountProducerChange[];
  accountsWithoutProducer: number;
};

const today = () => new Date().toISOString().slice(0, 10);

function pct(v: number): string {
  return `${(Math.round(v * 1e6) / 1e4).toLocaleString('es-AR')}%`;
}

/** Input numérico que muestra porcentaje (0.65 → "65") sin pelear con lo que se está tipeando. */
function PctInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const shown = value == null ? '' : String(Math.round(value * 1e6) / 1e4);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <div className={cn('relative', className)}>
      <input
        className={cn(inputClass, 'pr-6 text-right tabular-nums')}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          setText(e.target.value);
          if (t.trim() === '') return onChange(undefined);
          const n = Number(t);
          if (Number.isFinite(n)) onChange(n / 100);
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

function IvaSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className={inputClass} value={value === 1 ? '1' : String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="1">Sin IVA</option>
      <option value="1.21">÷ 1,21</option>
      {value !== 1 && value !== 1.21 && <option value={String(value)}>÷ {value.toLocaleString('es-AR')}</option>}
    </select>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <CardHeader className="pb-2">
      <CardTitle className="text-lg">{title}</CardTitle>
      <p className="text-sm text-muted-foreground">{description}</p>
    </CardHeader>
  );
}

type RuleRow = { key: string; label: string; rule: BucketRule };

/** IIBB + tabla de distribución / IVA por tipo de arancel de una ALYC. */
function AlycRulesBlock({
  title,
  shareLabel,
  iibbRate,
  onIibb,
  rows,
  onRow,
  onAllShares,
}: {
  title: string;
  shareLabel: string;
  iibbRate: number;
  onIibb: (v: number) => void;
  rows: RuleRow[];
  onRow: (key: string, patch: Partial<BucketRule>) => void;
  onAllShares?: (v: number) => void;
}) {
  const neto = 1 - iibbRate;
  const shares = new Set(rows.map((x) => x.rule.share));
  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <p className="mr-2 self-center text-sm font-semibold">{title}</p>
        <label className="space-y-1 text-xs text-muted-foreground">
          IIBB (sobre el bruto)
          <PctInput className="w-28" value={iibbRate} onChange={(v) => v != null && onIibb(v)} />
        </label>
        {onAllShares && (
          <label className="space-y-1 text-xs text-muted-foreground">
            {shareLabel} para todas
            <PctInput
              className="w-28"
              value={shares.size === 1 ? rows[0]?.rule.share : undefined}
              placeholder="varía"
              onChange={(v) => v != null && onAllShares(v)}
            />
          </label>
        )}
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-medium">Tipo de arancel {title}</th>
              <th className="p-2 text-right font-medium">{shareLabel}</th>
              <th className="p-2 text-left font-medium">IVA hoja pesos</th>
              <th className="p-2 text-left font-medium">IVA hoja dólares</th>
              <th className="p-2 text-right font-medium">Alíc. neta pesos</th>
              <th className="p-2 text-right font-medium">Alíc. neta dólares</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, rule }) => (
              <tr key={key} className="border-b border-border/50 last:border-0">
                <td className="p-2">{label}</td>
                <td className="p-2">
                  <PctInput className="ml-auto w-28" value={rule.share} onChange={(v) => v != null && onRow(key, { share: v })} />
                </td>
                <td className="p-2">
                  <IvaSelect value={rule.iva_pesos} onChange={(v) => onRow(key, { iva_pesos: v })} />
                </td>
                <td className="p-2">
                  <IvaSelect value={rule.iva_dolares} onChange={(v) => onRow(key, { iva_dolares: v })} />
                </td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{pct((neto * rule.share) / rule.iva_pesos)}</td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">{pct((neto * rule.share) / rule.iva_dolares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RulesSection({
  rules,
  currentId,
  onChange,
}: {
  rules: NetRuleVersion[];
  currentId: string;
  onChange: (rules: NetRuleVersion[]) => void;
}) {
  const [newFrom, setNewFrom] = useState(today());
  const sorted = [...rules].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const update = (id: string, patch: Partial<NetRuleVersion>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateBucket = (r: NetRuleVersion, b: NetBucket, patch: Partial<BucketRule>) =>
    update(r.id, { buckets: { ...r.buckets, [b]: { ...r.buckets[b], ...patch } } });
  const updateGma = (r: NetRuleVersion, keys: readonly GmaBucket[], patch: Partial<BucketRule>) => {
    const buckets = { ...r.gma.buckets };
    for (const b of keys) buckets[b] = { ...buckets[b], ...patch };
    update(r.id, { gma: { ...r.gma, buckets } });
  };
  const addVersion = () => {
    if (rules.some((r) => r.valid_from === newFrom)) return;
    const base = sorted.find((r) => r.valid_from <= newFrom) ?? sorted[sorted.length - 1]!;
    onChange([
      ...rules,
      { ...base, id: newSettingsId('rule'), valid_from: newFrom, notes: null, created_at: new Date().toISOString() },
    ]);
  };

  return (
    <Card>
      <SectionTitle
        title="Alícuotas de liquidación"
        description="Cada versión rige desde su fecha hasta la siguiente; las operaciones se liquidan con la versión vigente a su fecha. En ambas ALYC: a pagar = (bruto − IIBB) × distribución o retrocesión ÷ IVA. IEB: iguales para todos los productores salvo arreglo comercial. GMA: hoy sin IIBB ni IVA (dejá 0% y «Sin IVA» mientras no haga falta). USD y dólar exterior usan la hoja dólares, pero se informan por separado."
      />
      <CardContent className="space-y-6">
        {sorted.map((r) => (
          <div key={r.id} className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                Vigente desde
                <input
                  type="date"
                  className={cn(inputClass, 'w-40')}
                  value={r.valid_from}
                  onChange={(e) => e.target.value && update(r.id, { valid_from: e.target.value })}
                />
              </label>
              <label className="min-w-[240px] flex-1 space-y-1 text-xs text-muted-foreground">
                Notas
                <input
                  className={inputClass}
                  value={r.notes ?? ''}
                  onChange={(e) => update(r.id, { notes: e.target.value || null })}
                />
              </label>
              {r.id === currentId && <Badge variant="success">Vigente hoy</Badge>}
              {rules.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`¿Eliminar la versión vigente desde ${formatDate(r.valid_from)}?`)) {
                      onChange(rules.filter((x) => x.id !== r.id));
                    }
                  }}
                >
                  Eliminar
                </Button>
              )}
            </div>
            <AlycRulesBlock
              title="IEB"
              shareLabel="Distribución"
              iibbRate={r.iibb_rate}
              onIibb={(v) => update(r.id, { iibb_rate: v })}
              rows={NET_BUCKETS.map((b) => ({ key: b, label: NET_BUCKET_LABEL[b], rule: r.buckets[b] }))}
              onRow={(b, patch) => updateBucket(r, b as NetBucket, patch)}
            />
            <AlycRulesBlock
              title="GMA"
              shareLabel="Retrocesión"
              iibbRate={r.gma.iibb_rate}
              onIibb={(v) => update(r.id, { gma: { ...r.gma, iibb_rate: v } })}
              rows={GMA_BUCKETS.map((b) => ({ key: b, label: GMA_BUCKET_LABEL[b], rule: r.gma.buckets[b] }))}
              onRow={(b, patch) => updateGma(r, [b as GmaBucket], patch)}
              onAllShares={(v) => updateGma(r, GMA_BUCKETS, { share: v })}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Nueva versión desde
            <input type="date" className={cn(inputClass, 'w-40')} value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
          </label>
          <Button variant="outline" size="sm" disabled={!newFrom || rules.some((r) => r.valid_from === newFrom)} onClick={addVersion}>
            Agregar versión
          </Button>
          <p className="text-xs text-muted-foreground">Copia las alícuotas vigentes a esa fecha para que cambies sólo lo que se modificó.</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Texto separado por comas que no se re-formatea mientras se escribe. */
function NamesInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => setText((t) => (splitNames(t).join(', ') === joined ? t : joined)), [joined]);
  return (
    <input
      className={inputClass}
      value={text}
      placeholder="Milagros Behr, Behr Milagros…"
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitNames(e.target.value));
      }}
    />
  );
}

function splitNames(t: string): string[] {
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function AliasesSection({ aliases, onChange }: { aliases: PersonAlias[]; onChange: (a: PersonAlias[]) => void }) {
  const update = (i: number, patch: Partial<PersonAlias>) => onChange(aliases.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <Card>
      <SectionTitle
        title="Nombres de productores / managers"
        description="Para que una misma persona aparezca igual en todas las ALYC (como en GMA). Se aplica al productor de IEB, al manager y advisor del mapping de cuentas y al oficial de cuenta. Se ignoran mayúsculas, acentos y el orden nombre/apellido: “Milagros Behr” y “Behr, Milagros” son lo mismo."
      />
      <CardContent className="space-y-3">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-48 p-2 text-left font-medium">Se muestra como</th>
              <th className="p-2 text-left font-medium">Nombres equivalentes (separados por coma)</th>
              <th className="w-24 p-2" />
            </tr>
          </thead>
          <tbody>
            {aliases.map((a, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="p-2">
                  <input className={inputClass} value={a.alias} onChange={(e) => update(i, { alias: e.target.value })} />
                </td>
                <td className="p-2">
                  <NamesInput value={a.nombres} onChange={(nombres) => update(i, { nombres })} />
                </td>
                <td className="p-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onChange(aliases.filter((_, j) => j !== i))}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button size="sm" variant="outline" onClick={() => onChange([...aliases, { alias: '', nombres: [] }])}>
          Agregar persona
        </Button>
      </CardContent>
    </Card>
  );
}

function ProducersSection({
  producers,
  info,
  aliases,
  onChange,
  withoutProducer,
}: {
  producers: ProducerSummary[];
  info: ProducerInfo[];
  aliases: PersonAlias[];
  onChange: (info: ProducerInfo[]) => void;
  withoutProducer: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const get = (numero: string): ProducerInfo =>
    info.find((p) => p.numero === numero) ?? { numero, codigo: null, nombre: null, notas: null };
  const set = (numero: string, patch: Partial<ProducerInfo>) => {
    const next = { ...get(numero), ...patch };
    const rest = info.filter((p) => p.numero !== numero);
    onChange(next.codigo || next.nombre || next.notas ? [...rest, next] : rest);
  };

  return (
    <Card>
      <SectionTitle
        title="Productores IEB"
        description="Armado con las columnas Productor y numeroProductor de los archivos de IEB. Podés asignarle a cada número su código de AP, un nombre y notas; sin código se muestra con el nombre de la tabla de arriba (p. ej. MILI). Las cuentas se cuentan con el productor efectivo (incluye los cambios de cuenta registrados)."
      />
      <CardContent className="p-0">
        {producers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Todavía no hay productores en el historial. Aparecen al importar (o reprocesar) los archivos de IEB.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 pl-6 text-left font-medium">N° productor</th>
                  <th className="p-2 text-left font-medium">En los archivos</th>
                  <th className="p-2 text-left font-medium">Código AP</th>
                  <th className="p-2 text-left font-medium">Nombre</th>
                  <th className="p-2 text-left font-medium">Notas</th>
                  <th className="p-2 text-right font-medium">Cuentas</th>
                  <th className="p-2 text-right font-medium">Operaciones</th>
                  <th className="p-2 pr-6 text-right font-medium">Bruto</th>
                </tr>
              </thead>
              <tbody>
                {producers.map((p) => {
                  const i = get(p.numero);
                  return (
                    <Fragment key={p.numero}>
                      <tr className="border-b border-border/50 align-top">
                        <td className="p-2 pl-6 font-medium tabular-nums">
                          {p.numero}
                          {p.acuerdoVigente && (
                            <div>
                              <Badge variant="warning">Arreglo vigente</Badge>
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-xs">
                          {p.nombresEnArchivos.join(' / ') || '—'}
                          {p.desde && (
                            <div className="text-muted-foreground">
                              {formatDate(p.desde)} – {formatDate(p.hasta)}
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            className={cn(inputClass, 'w-20')}
                            value={i.codigo ?? ''}
                            placeholder={personAlias(i.nombre || p.nombresEnArchivos[0], { person_aliases: aliases }) ?? ''}
                            onChange={(e) => set(p.numero, { codigo: e.target.value.trim() || null })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className={cn(inputClass, 'w-48')}
                            value={i.nombre ?? ''}
                            onChange={(e) => set(p.numero, { nombre: e.target.value || null })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className={cn(inputClass, 'w-56')}
                            value={i.notas ?? ''}
                            onChange={(e) => set(p.numero, { notas: e.target.value || null })}
                          />
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {p.cuentas.length > 0 ? (
                            <button className="underline" onClick={() => setOpen(open === p.numero ? null : p.numero)}>
                              {p.cuentas.length}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">{p.operaciones || '—'}</td>
                        <td className="p-2 pr-6 text-right text-xs tabular-nums">{formatTotals(p.bruto) || '—'}</td>
                      </tr>
                      {open === p.numero && (
                        <tr className="border-b border-border/50 bg-muted/30">
                          <td colSpan={8} className="px-6 py-3">
                            <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              {p.cuentas.map((c) => (
                                <div key={c.cuenta} className="flex justify-between gap-2">
                                  <span>
                                    <span className="tabular-nums text-muted-foreground">{c.cuenta}</span> {c.cliente}
                                  </span>
                                  <span className="tabular-nums text-muted-foreground">
                                    {c.operaciones} op. · {formatDate(c.desde)}–{formatDate(c.hasta)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {withoutProducer > 0 && (
          <p className="px-6 py-3 text-xs text-amber-700 dark:text-amber-400">
            {withoutProducer} cuentas de IEB no tienen número de productor en sus operaciones (archivos importados antes de
            leer esa columna: reprocesalos desde Importar).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AgreementsSection({
  agreements,
  producerOptions,
  onChange,
}: {
  agreements: ProducerAgreement[];
  producerOptions: { numero: string; label: string }[];
  onChange: (a: ProducerAgreement[]) => void;
}) {
  const empty = { productor: '', desde: today(), hasta: '', notas: '', shares: {} as Partial<Record<NetBucket, number>> };
  const [form, setForm] = useState(empty);
  const labelOf = (n: string) => producerOptions.find((p) => p.numero === n)?.label ?? n;
  const valid =
    form.productor && form.desde && (!form.hasta || form.hasta >= form.desde) && Object.values(form.shares).some((v) => v != null);

  return (
    <Card>
      <SectionTitle
        title="Arreglos comerciales"
        description="Distribución distinta a la estándar para un productor en un rango de fechas. Sólo pisa los tipos que completes; el resto sigue con la alícuota general."
      />
      <CardContent className="space-y-4">
        {agreements.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">Productor</th>
                  <th className="p-2 text-left font-medium">Vigencia</th>
                  <th className="p-2 text-left font-medium">Distribución</th>
                  <th className="p-2 text-left font-medium">Notas</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {[...agreements]
                  .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
                  .map((a) => (
                    <tr key={a.id} className="border-b border-border/50 last:border-0">
                      <td className="p-2">{labelOf(a.productor_numero)}</td>
                      <td className="p-2 tabular-nums">
                        {formatDate(a.valid_from)} – {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                      </td>
                      <td className="p-2 text-xs">
                        {NET_BUCKETS.filter((b) => a.shares[b] != null)
                          .map((b) => `${NET_BUCKET_LABEL[b]} ${pct(a.shares[b]!)}`)
                          .join(' · ')}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{a.notas}</td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => onChange(agreements.filter((x) => x.id !== a.id))}>
                          Eliminar
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <p className="text-sm font-medium">Nuevo arreglo</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Productor
              <select className={cn(inputClass, 'w-56')} value={form.productor} onChange={(e) => setForm({ ...form, productor: e.target.value })}>
                <option value="">Elegí…</option>
                {producerOptions.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Desde
              <input type="date" className={cn(inputClass, 'w-40')} value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Hasta (opcional)
              <input type="date" className={cn(inputClass, 'w-40')} value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
            </label>
            <label className="min-w-[200px] flex-1 space-y-1 text-xs text-muted-foreground">
              Notas
              <input className={inputClass} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            {NET_BUCKETS.map((b) => (
              <label key={b} className="space-y-1 text-xs text-muted-foreground">
                {NET_BUCKET_LABEL[b]}
                <PctInput
                  className="w-28"
                  placeholder="estándar"
                  value={form.shares[b]}
                  onChange={(v) => setForm({ ...form, shares: { ...form.shares, [b]: v } })}
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!valid}
            onClick={() => {
              const shares = Object.fromEntries(Object.entries(form.shares).filter(([, v]) => v != null));
              onChange([
                ...agreements,
                {
                  id: newSettingsId('agr'),
                  productor_numero: form.productor,
                  valid_from: form.desde,
                  valid_to: form.hasta || null,
                  shares,
                  notas: form.notas.trim() || null,
                  created_at: new Date().toISOString(),
                },
              ]);
              setForm(empty);
            }}
          >
            Agregar arreglo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TransfersSection({
  changes,
  settings,
  producerOptions,
  onChange,
}: {
  changes: AccountProducerChange[];
  settings: ArancelesSettings;
  producerOptions: { numero: string; label: string }[];
  onChange: (s: ArancelesSettings['account_transfers']) => void;
}) {
  const empty = { cuenta: '', productor: '', desde: today(), notas: '' };
  const [form, setForm] = useState(empty);
  const transfers = settings.account_transfers;
  const labelOf = (n: string | null) => (n ? producerOptions.find((p) => p.numero === n)?.label ?? n : '—');
  const fromFiles = changes.filter((c) => c.origen === 'archivo');

  return (
    <Card>
      <SectionTitle
        title="Cambios de cuenta entre productores"
        description="Los cambios que se ven en los archivos (una cuenta que aparece con otro numeroProductor) se detectan solos. Si una cuenta pasa a otro productor y el archivo todavía no lo refleja, registralo acá: desde esa fecha la cuenta se asigna al productor nuevo."
      />
      <CardContent className="space-y-4">
        {transfers.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Registrados</p>
            <div className="overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <tbody>
                  {[...transfers]
                    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
                    .map((t) => {
                      const c = changes.find((x) => x.origen === 'registrado' && x.cuenta === t.cuenta && x.fecha === t.valid_from);
                      return (
                        <tr key={t.id} className="border-b border-border/50 last:border-0">
                          <td className="p-2 tabular-nums">{formatDate(t.valid_from)}</td>
                          <td className="p-2">
                            <span className="tabular-nums text-muted-foreground">{t.cuenta}</span> {c?.cliente ?? ''}
                          </td>
                          <td className="p-2">
                            {labelOf(c?.desdeProductor ?? null)} → {labelOf(t.productor_numero)}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{t.notas}</td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => onChange(transfers.filter((x) => x.id !== t.id))}>
                              Eliminar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <p className="text-sm font-medium">Registrar cambio</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Cuenta (comitente)
              <input className={cn(inputClass, 'w-32')} value={form.cuenta} onChange={(e) => setForm({ ...form, cuenta: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Pasa a productor
              <input
                className={cn(inputClass, 'w-44')}
                list="aranceles-productores"
                value={form.productor}
                placeholder="N° de productor"
                onChange={(e) => setForm({ ...form, productor: e.target.value })}
              />
              <datalist id="aranceles-productores">
                {producerOptions.map((p) => (
                  <option key={p.numero} value={p.numero}>
                    {p.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Desde
              <input type="date" className={cn(inputClass, 'w-40')} value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
            </label>
            <label className="min-w-[200px] flex-1 space-y-1 text-xs text-muted-foreground">
              Notas
              <input className={inputClass} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!form.cuenta.trim() || !form.productor.trim() || !form.desde}
              onClick={() => {
                onChange([
                  ...transfers,
                  {
                    id: newSettingsId('trf'),
                    cuenta: form.cuenta.trim(),
                    productor_numero: form.productor.trim(),
                    valid_from: form.desde,
                    notas: form.notas.trim() || null,
                    created_at: new Date().toISOString(),
                  },
                ]);
                setForm(empty);
              }}
            >
              Registrar
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Detectados en los archivos</p>
          {fromFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna cuenta cambió de productor en los archivos importados.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <tbody>
                  {fromFiles.map((c, i) => (
                    <tr key={`${c.cuenta}-${c.fecha}-${i}`} className="border-b border-border/50 last:border-0">
                      <td className="p-2 tabular-nums">{formatDate(c.fecha)}</td>
                      <td className="p-2">
                        <span className="tabular-nums text-muted-foreground">{c.cuenta}</span> {c.cliente}
                      </td>
                      <td className="p-2">
                        {labelOf(c.desdeProductor)} → {labelOf(c.haciaProductor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ArancelesConfiguracionPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<ArancelesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (json: SettingsPayload) => {
    setData(json);
    setDraft(json.settings);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/aranceles/settings', { cache: 'no-store' });
      const json = await readJson<SettingsPayload>(res);
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar la configuración');
      apply(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.settings) !== JSON.stringify(draft), [data, draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/aranceles/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { ...draft, person_aliases: draft.person_aliases.filter((a) => a.alias.trim()) },
        }),
      });
      const json = await readJson<SettingsPayload>(res);
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar');
      apply(json);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  const producerOptions = useMemo(() => {
    if (!data || !draft) return [];
    return data.producers.map((p) => {
      const label = producerLabel(p.numero, draft, p.nombresEnArchivos[0]);
      return { numero: p.numero, label: label === p.numero ? label : `${p.numero} · ${label}` };
    });
  }, [data, draft]);

  if (loading && !data) return <LoadingBlock label="Cargando configuración…" />;
  if (!data || !draft) return error ? <ErrorBlock message={error} onRetry={() => void load()} /> : null;

  const patch = (p: Partial<ArancelesSettings>) => {
    setSaved(false);
    setDraft({ ...draft, ...p });
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card/95 px-4 py-3 backdrop-blur">
        <p className="text-sm text-muted-foreground">
          La configuración se guarda dentro del historial de aranceles (Drive) y afecta el cálculo del neto (pestaña
          Neto y Resumen) y el filtro por productor.
        </p>
        <div className="flex items-center gap-2">
          {saved && !dirty && <span className="text-sm text-emerald-700 dark:text-emerald-400">Guardado</span>}
          {dirty && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(data.settings)}>
              Descartar
            </Button>
          )}
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
      {error && <ErrorBlock message={error} />}

      <RulesSection rules={draft.net_rules} currentId={data.currentRules.id} onChange={(net_rules) => patch({ net_rules })} />
      <AliasesSection aliases={draft.person_aliases} onChange={(person_aliases) => patch({ person_aliases })} />
      <ProducersSection
        producers={data.producers}
        info={draft.producers}
        aliases={draft.person_aliases}
        withoutProducer={data.accountsWithoutProducer}
        onChange={(producers) => patch({ producers })}
      />
      <AgreementsSection
        agreements={draft.agreements}
        producerOptions={producerOptions}
        onChange={(agreements) => patch({ agreements })}
      />
      <TransfersSection
        changes={data.accountChanges}
        settings={draft}
        producerOptions={producerOptions}
        onChange={(account_transfers) => patch({ account_transfers })}
      />
    </div>
  );
}
