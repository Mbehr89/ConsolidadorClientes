import type { Position } from '@/lib/schema';
import { isCashBucketPosition } from '@/lib/cash-buckets';
import {
  assetKindOf,
  canonTicker,
  DIRECT_SECTOR,
  displayName,
  isEquityEtf,
  regionOfTicker,
  type DimId,
} from '@/lib/exposure/classification';
import { ETF_NO_LOOK_SECTOR, ETF_SECTORS, HOLD, HOLDING_NAMES } from '@/lib/exposure/etf-data';
import type { ExposureAccount, ExposureLine, RankedAsset, SlicePart } from '@/lib/exposure/types';

export function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

export function equityOf(account: Pick<ExposureAccount, 'direct' | 'etf'>): number {
  return sum(Object.values(account.direct)) + sum(Object.values(account.etf));
}

export function aumOf(account: Pick<ExposureAccount, 'asset'>): number {
  return sum(account.asset);
}

/** Sector de la renta variable. El look-through abre solo los ETFs de renta variable conocidos. */
export function sectorOf(account: Pick<ExposureAccount, 'direct' | 'etf'>, lookThrough: boolean): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const [ticker, amount] of Object.entries(account.direct)) {
    const sector = DIRECT_SECTOR[ticker];
    if (sector == null) continue;
    out[sector]! += amount;
  }
  for (const [ticker, amount] of Object.entries(account.etf)) {
    const weights = ETF_SECTORS[ticker];
    if (lookThrough && weights) {
      weights.forEach((weight, index) => {
        out[index]! += (amount * weight) / 100;
      });
    } else if (ETF_NO_LOOK_SECTOR[ticker] != null) {
      out[ETF_NO_LOOK_SECTOR[ticker]!]! += amount;
    }
  }
  return out;
}

export function valuesOf(account: ExposureAccount, dim: DimId, lookThrough: boolean): number[] {
  if (dim === 'sector') return sectorOf(account, lookThrough);
  return account[dim];
}

function addAmount(target: Record<string, number>, key: string, amount: number) {
  target[key] = (target[key] ?? 0) + amount;
}

export function consolidate(accounts: readonly ExposureAccount[]): ExposureAccount {
  const out: ExposureAccount = {
    id: '*',
    name: 'Consolidado',
    broker: '',
    cuenta: '',
    titular: '',
    grupoId: null,
    asset: [0, 0, 0, 0],
    region: [0, 0, 0, 0, 0, 0],
    direct: {},
    etf: {},
    lines: [],
    unclassified: 0,
  };
  for (const account of accounts) {
    out.asset = [
      out.asset[0] + account.asset[0],
      out.asset[1] + account.asset[1],
      out.asset[2] + account.asset[2],
      out.asset[3] + account.asset[3],
    ];
    out.region = [
      out.region[0] + account.region[0],
      out.region[1] + account.region[1],
      out.region[2] + account.region[2],
      out.region[3] + account.region[3],
      out.region[4] + account.region[4],
      out.region[5] + account.region[5],
    ];
    for (const [ticker, amount] of Object.entries(account.direct)) addAmount(out.direct, ticker, amount);
    for (const [ticker, amount] of Object.entries(account.etf)) addAmount(out.etf, ticker, amount);
    out.lines.push(...account.lines);
    out.unclassified += account.unclassified;
  }
  return out;
}

/** Qué activos arman un porcentaje. El sector con look-through abre la parte de cada ETF. */
export function sliceParts(account: ExposureAccount, dim: DimId, index: number, lookThrough: boolean): SlicePart[] {
  const parts: SlicePart[] = [];
  if (dim === 'asset' || dim === 'region') {
    for (const line of account.lines) {
      const bucket = dim === 'asset' ? line.asset : line.region;
      if (bucket !== index || line.amount === 0) continue;
      parts.push({ ticker: line.ticker, name: line.name, amount: line.amount, source: line.vehicle === 'etf' ? line.ticker : 'Directo' });
    }
  } else {
    for (const line of account.lines) {
      if (line.vehicle !== 'etf' && line.sector === index && line.amount !== 0) {
        parts.push({ ticker: line.ticker, name: line.name, amount: line.amount, source: 'Directo' });
      }
      if (line.vehicle === 'etf' && line.amount !== 0) {
        if (lookThrough && ETF_SECTORS[line.ticker]) {
          const weight = ETF_SECTORS[line.ticker]![index] ?? 0;
          if (weight > 0) {
            parts.push({
              ticker: line.ticker,
              name: displayName(line.ticker, line.name),
              amount: (line.amount * weight) / 100,
              source: `${line.ticker} · ${weight.toLocaleString('es-AR', { maximumFractionDigits: 2 })}% del ETF`,
            });
          }
        } else if (!lookThrough && ETF_NO_LOOK_SECTOR[line.ticker] === index) {
          parts.push({ ticker: line.ticker, name: displayName(line.ticker, line.name), amount: line.amount, source: 'ETF' });
        }
      }
    }
  }
  const merged = new Map<string, SlicePart>();
  for (const part of parts) {
    const key = `${part.ticker}|${part.source}`;
    const prev = merged.get(key);
    if (prev) prev.amount += part.amount;
    else merged.set(key, { ...part });
  }
  return [...merged.values()].filter((part) => Math.abs(part.amount) > 0.005).sort((a, b) => b.amount - a.amount);
}

export function rankAssets(accounts: readonly ExposureAccount[], limit = 14): RankedAsset[] {
  const direct: Record<string, number> = {};
  const etfAmounts: Record<string, number> = {};
  for (const account of accounts) {
    for (const [ticker, amount] of Object.entries(account.direct)) addAmount(direct, ticker, amount);
    for (const [ticker, amount] of Object.entries(account.etf)) addAmount(etfAmounts, ticker, amount);
  }
  const equity = sum(Object.values(direct)) + sum(Object.values(etfAmounts));
  const under = new Map<string, { name: string; direct: number; via: number }>();
  const touch = (key: string, name: string) => {
    const row = under.get(key) ?? { name, direct: 0, via: 0 };
    under.set(key, row);
    return row;
  };
  for (const [ticker, amount] of Object.entries(direct)) {
    touch(ticker, HOLDING_NAMES[ticker] ?? ticker).direct += amount;
  }
  for (const [ticker, amount] of Object.entries(etfAmounts)) {
    for (const [key, name, weight] of HOLD[ticker] ?? []) {
      touch(key, name).via += (amount * weight) / 100;
    }
  }
  return [...under.entries()]
    .map(([key, row]) => ({
      key,
      name: row.name,
      direct: row.direct,
      via: row.via,
      total: row.direct + row.via,
      pctOfEquity: equity > 0 ? ((row.direct + row.via) / equity) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function marketValue(position: Position): number | null {
  const value = position.valor_mercado_usd;
  if (value == null || !Number.isFinite(value)) return null;
  if (position.clase_activo === 'option' && value === 0) return null;
  if (value === 0) return null;
  return value;
}

function toLine(position: Position, amount: number): ExposureLine {
  const text = `${position.ticker ?? ''} ${position.descripcion}`;
  const cash = isCashBucketPosition(position) || assetKindOf(null, position.clase_activo, text) === 3;
  const ticker = cash ? 'CASH' : canonTicker(position.ticker) ?? (position.descripcion.trim() || 'SIN ticker');
  const asset = cash ? 3 : assetKindOf(ticker === 'CASH' ? null : ticker, position.clase_activo, text);
  const etf = !cash && isEquityEtf(ticker);
  const sector = !cash && !etf && asset === 0 ? DIRECT_SECTOR[ticker] ?? null : null;
  const region = asset === 3 ? null : regionOfTicker(ticker, position.pais_emisor);
  return {
    ticker,
    name: etf ? displayName(ticker, position.descripcion) : (HOLDING_NAMES[ticker] ?? position.descripcion.trim()) || ticker,
    amount,
    asset,
    region,
    sector,
    vehicle: etf ? 'etf' : asset === 0 && sector != null ? 'direct' : 'other',
  };
}

function blankAccount(id: string, sample: Position): ExposureAccount {
  return {
    id,
    name: sample.cuenta,
    broker: sample.broker,
    cuenta: sample.cuenta,
    titular: sample.titular,
    grupoId: sample.grupo_id,
    asset: [0, 0, 0, 0],
    region: [0, 0, 0, 0, 0, 0],
    direct: {},
    etf: {},
    lines: [],
    unclassified: 0,
  };
}

/** Arma una fila por cuenta a partir de las posiciones ya parseadas en el navegador. */
export function accountsFromPositions(positions: readonly Position[]): ExposureAccount[] {
  const map = new Map<string, ExposureAccount>();
  for (const position of positions) {
    const amount = marketValue(position);
    if (amount == null) continue;
    const id = `${position.broker}::${position.cuenta}`;
    const account = map.get(id) ?? blankAccount(id, position);
    if (!account.titular.includes(position.titular)) {
      account.titular = account.titular ? `${account.titular} · ${position.titular}` : position.titular;
    }
    account.grupoId = account.grupoId ?? position.grupo_id;
    const line = toLine(position, amount);
    account.lines.push(line);
    if (line.asset != null) account.asset[line.asset] += amount;
    if (line.region != null) account.region[line.region] += amount;
    const missing =
      line.asset == null ||
      (line.asset !== 3 && line.region == null) ||
      (line.asset === 0 && line.vehicle !== 'etf' && line.sector == null);
    if (missing) account.unclassified += amount;
    if (line.vehicle === 'etf') addAmount(account.etf, line.ticker, amount);
    else if (line.vehicle === 'direct') addAmount(account.direct, line.ticker, amount);
    map.set(id, account);
  }
  return [...map.values()].sort((a, b) => aumOf(b) - aumOf(a) || a.name.localeCompare(b.name, 'es'));
}

export function isUnclassified(line: ExposureLine): boolean {
  return (
    line.asset == null ||
    (line.asset !== 3 && line.region == null) ||
    (line.asset === 0 && line.vehicle !== 'etf' && line.sector == null)
  );
}

export function unclassifiedLines(account: ExposureAccount): ExposureLine[] {
  const byTicker = new Map<string, ExposureLine>();
  for (const line of account.lines) {
    if (!isUnclassified(line)) continue;
    const prev = byTicker.get(line.ticker);
    if (prev) prev.amount += line.amount;
    else byTicker.set(line.ticker, { ...line });
  }
  return [...byTicker.values()].sort((a, b) => b.amount - a.amount);
}
