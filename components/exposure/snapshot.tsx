'use client';

import { useMemo, useState } from 'react';
import { DIMS, sectorLabel, type DimId } from '@/lib/exposure/classification';
import { ETF_DATA_AS_OF } from '@/lib/exposure/etf-data';
import {
  aumOf,
  consolidate,
  equityOf,
  sliceParts,
  sum,
  unclassifiedLines,
  valuesOf,
} from '@/lib/exposure/engine';
import type { ExposureAccount } from '@/lib/exposure/types';

type Pick = { accountId: string; dim: DimId; index: number };

function usd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) {
    return `${sign}USD ${(abs / 1_000_000).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1000) return `${sign}USD ${Math.round(abs / 1000).toLocaleString('es-AR')}k`;
  return `${sign}USD ${Math.round(abs).toLocaleString('es-AR')}`;
}

function pct(value: number): string {
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function day(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function shareOfBase(account: ExposureAccount, pick: Pick, amount: number): number {
  const base =
    pick.dim === 'sector' ? equityOf(account) : pick.dim === 'region' ? sum(account.region) : aumOf(account);
  if (base <= 0) return 0;
  return (amount / base) * 100;
}

function exposureOf(account: ExposureAccount, dim: DimId, index: number, lookThrough: boolean): number {
  const values = valuesOf(account, dim, lookThrough);
  const base = dim === 'sector' ? equityOf(account) : dim === 'region' ? sum(account.region) : aumOf(account);
  if (base <= 0) return 0;
  return ((values[index] ?? 0) / base) * 100;
}

export function ExposureSnapshot({
  accounts,
  fechas,
  rowLabel = 'Cuenta',
}: {
  accounts: ExposureAccount[];
  fechas: string[];
  rowLabel?: string;
}) {
  const [lookThrough, setLookThrough] = useState(true);
  const [sort, setSort] = useState<'aum' | 'name'>('aum');
  const [pick, setPick] = useState<Pick | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const book = useMemo(() => consolidate(accounts), [accounts]);
  const rows = useMemo(() => {
    const list = [...accounts];
    if (pick) {
      list.sort(
        (a, b) =>
          exposureOf(b, pick.dim, pick.index, lookThrough) - exposureOf(a, pick.dim, pick.index, lookThrough) ||
          aumOf(b) - aumOf(a),
      );
    } else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    else list.sort((a, b) => aumOf(b) - aumOf(a) || a.name.localeCompare(b.name, 'es'));
    return list;
  }, [accounts, lookThrough, pick, sort]);

  const missing = unclassifiedLines(book);

  function togglePick(next: Pick) {
    setShowMissing(false);
    setPick((current) =>
      current && current.accountId === next.accountId && current.dim === next.dim && current.index === next.index
        ? null
        : next,
    );
  }

  const dateLine =
    fechas.length === 0
      ? 'Sin fecha de reporte'
      : fechas.length === 1
        ? `Posiciones al ${day(fechas[0]!)}`
        : `Posiciones del ${day(fechas[0]!)} al ${day(fechas[fechas.length - 1]!)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {dateLine}. Composición de ETFs al {day(ETF_DATA_AS_OF)}. El valor es el de mercado en dólares, tal como
            viene del archivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className={`rounded-full border px-3 py-1 ${lookThrough ? 'border-foreground bg-foreground text-background' : 'border-border'}`}
            onClick={() => setLookThrough((value) => !value)}
          >
            {lookThrough ? 'Look-through de ETFs' : 'ETFs sin abrir'}
          </button>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1"
            onClick={() => {
              setPick(null);
              setSort((value) => (value === 'aum' ? 'name' : 'aum'));
            }}
          >
            Orden: {pick ? 'exposición' : sort === 'aum' ? 'AUM' : rowLabel.toLowerCase()}
          </button>
        </div>
      </div>

      {book.unclassified > 0 && (
        <button
          type="button"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-left text-sm"
          onClick={() => {
            setPick(null);
            setShowMissing((value) => !value);
          }}
        >
          Sin clasificar: {usd(book.unclassified)} en {missing.length} {missing.length === 1 ? 'activo' : 'activos'}.
          No entran en Otros.
        </button>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {DIMS.map((dim) => (
          <p key={dim.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{dim.title}</span>
            {dim.cats.map((cat, index) => (
              <span key={cat.label} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: cat.color }} />
                {dim.id === 'sector' ? sectorLabel(index, lookThrough) : cat.label}
              </span>
            ))}
          </p>
        ))}
      </div>

      <div className="space-y-3 md:hidden">
        <AccountCard
          account={book}
          lookThrough={lookThrough}
          pick={pick}
          showMissing={showMissing}
          missing={missing}
          onPick={togglePick}
          onTip={setTip}
        />
        {rows.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            lookThrough={lookThrough}
            pick={pick}
            showMissing={false}
            missing={[]}
            onPick={togglePick}
            onTip={setTip}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <div className="min-w-[960px]">
          <div className="grid grid-cols-[220px_1fr_1fr_1fr] gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span>{rowLabel}</span>
            {DIMS.map((dim) => (
              <span key={dim.id}>
                {dim.title}
                <span className="block">{dim.base}</span>
              </span>
            ))}
          </div>
          <AccountRow
            account={book}
            lookThrough={lookThrough}
            pick={pick}
            showMissing={showMissing}
            missing={missing}
            onPick={togglePick}
            onTip={setTip}
          />
          {rows.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              lookThrough={lookThrough}
              pick={pick}
              showMissing={false}
              missing={[]}
              onPick={togglePick}
              onTip={setTip}
            />
          ))}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

function Composition({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { name: string; source: string; amount: number; share: number }[];
}) {
  return (
    <section className="border-t border-border bg-muted/30 px-4 py-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta categoría no tiene activos en la selección.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={`${row.source}|${row.name}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{row.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{row.source}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                {usd(row.amount)}
                <span className="block text-xs text-muted-foreground">{pct(row.share)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountCard(props: RowProps) {
  const { account } = props;
  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{rowTitle(account)}</p>
          <p className="truncate text-xs text-muted-foreground">{rowSubtitle(account)}</p>
        </div>
        <p className="text-sm tabular-nums">{usd(aumOf(account))}</p>
      </header>
      <div className="space-y-3">
        {DIMS.map((dim) => (
          <div key={dim.id}>
            <p className="mb-1 text-xs text-muted-foreground">
              {dim.title} · {dim.base}
            </p>
            <Bar dim={dim.id} {...props} />
          </div>
        ))}
      </div>
      <RowDetail {...props} />
    </article>
  );
}

type RowProps = {
  account: ExposureAccount;
  lookThrough: boolean;
  pick: Pick | null;
  showMissing: boolean;
  missing: ReturnType<typeof unclassifiedLines>;
  onPick: (pick: Pick) => void;
  onTip: (tip: { text: string; x: number; y: number } | null) => void;
};

function rowTitle(account: ExposureAccount): string {
  if (account.id === '*') return 'Consolidado';
  if (account.broker) return account.cuenta;
  return account.name;
}

function rowSubtitle(account: ExposureAccount): string {
  if (account.id === '*') return `${account.lines.length} líneas`;
  return [account.broker, account.titular].filter(Boolean).join(' · ');
}

function AccountRow({ account, ...props }: RowProps) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="grid grid-cols-[220px_1fr_1fr_1fr] items-center gap-3 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{rowTitle(account)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {account.id === '*' ? usd(aumOf(account)) : rowSubtitle(account)}
          </p>
        </div>
        {DIMS.map((dim) => (
          <Bar key={dim.id} dim={dim.id} account={account} {...props} />
        ))}
      </div>
      <RowDetail account={account} {...props} />
    </div>
  );
}

function RowDetail({ account, pick, lookThrough, showMissing, missing }: RowProps) {
  if (showMissing && account.id === '*') {
    return (
      <Composition
        title="Sin clasificar"
        subtitle="Estos activos no tienen asset class, sector o región. No se esconden en Otros."
        rows={missing.map((line) => ({
          name: line.name,
          source: line.ticker,
          amount: line.amount,
          share: account.unclassified > 0 ? (line.amount / account.unclassified) * 100 : 0,
        }))}
      />
    );
  }
  if (!pick || pick.accountId !== account.id) return null;
  const meta = DIMS.find((dim) => dim.id === pick.dim);
  const label = pick.dim === 'sector' ? sectorLabel(pick.index, lookThrough) : meta?.cats[pick.index]?.label ?? '';
  const parts = sliceParts(account, pick.dim, pick.index, lookThrough);
  const partTotal = sum(parts.map((part) => part.amount));
  return (
    <Composition
      title={`${label} · ${rowTitle(account)}`}
      subtitle={`${meta?.title ?? ''}. ${pct(shareOfBase(account, pick, partTotal))} de la base de este portfolio.`}
      rows={parts.map((part) => ({
        name: part.name,
        source: part.source,
        amount: part.amount,
        share: partTotal > 0 ? (part.amount / partTotal) * 100 : 0,
      }))}
    />
  );
}

function Bar({ account, dim, lookThrough, pick, onPick, onTip }: RowProps & { dim: DimId }) {
  const meta = DIMS.find((item) => item.id === dim)!;
  const values = valuesOf(account, dim, lookThrough);
  const base = dim === 'sector' ? equityOf(account) : dim === 'region' ? sum(account.region) : aumOf(account);
  if (base <= 0) {
    return <p className="text-xs text-muted-foreground">{meta.empty}</p>;
  }
  return (
    <div className="flex h-7 overflow-hidden rounded-sm">
      {values.map((value, index) => {
        if (value <= 0) return null;
        const share = (value / base) * 100;
        const active = pick?.accountId === account.id && pick.dim === dim && pick.index === index;
        const dimmed = pick?.accountId === account.id && pick.dim === dim && !active;
        const label = dim === 'sector' ? sectorLabel(index, lookThrough) : meta.cats[index]?.label ?? '';
        const color = meta.cats[index]?.color ?? '#898781';
        return (
          <button
            key={`${dim}-${index}`}
            type="button"
            className="h-full min-w-[2px]"
            style={{ width: `${share}%`, background: color, opacity: dimmed ? 0.28 : 1 }}
            aria-label={`${label}, ${pct(share)}, ${usd(value)}`}
            aria-pressed={active && (pick?.accountId === account.id)}
            onClick={() => onPick({ accountId: account.id, dim, index })}
            onMouseEnter={(event) =>
              onTip({
                text: `${label} · ${pct(share)} · ${usd(value)}`,
                x: Math.min(event.clientX + 12, window.innerWidth - 220),
                y: event.clientY + 16,
              })
            }
            onMouseLeave={() => onTip(null)}
          />
        );
      })}
    </div>
  );
}
