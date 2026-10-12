import { coerceSettings } from '@/lib/aranceles/settings';
import type { ArancelesHistory } from '@/lib/aranceles/types';

export type BackupSummary = {
  filename: string;
  operations: number;
  lastOperationDate: string | null;
  lastOperationByAlyc: { alyc: string; date: string; operations: number }[];
};

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function backupFilename(lastOperationDate: string | null, operations: number): string {
  const date = lastOperationDate ?? 'sin operaciones';
  const ops = `${operations} ${operations === 1 ? 'operación' : 'operaciones'}`;
  return `Backup aranceles - ${date} - ${ops}.json`;
}

export function summarizeBackup(history: ArancelesHistory): BackupSummary {
  const byAlyc = new Map<string, { date: string | null; operations: number }>();
  let last: string | null = null;
  for (const c of history.commissions) {
    const date = /^\d{4}-\d{2}-\d{2}/.test(c.trade_date ?? '') ? c.trade_date.slice(0, 10) : null;
    last = maxDate(last, date);
    const entry = byAlyc.get(c.alyc) ?? { date: null, operations: 0 };
    entry.date = maxDate(entry.date, date);
    entry.operations += 1;
    byAlyc.set(c.alyc, entry);
  }
  return {
    filename: backupFilename(last, history.commissions.length),
    operations: history.commissions.length,
    lastOperationDate: last,
    lastOperationByAlyc: [...byAlyc.entries()]
      .filter((e): e is [string, { date: string; operations: number }] => e[1].date != null)
      .map(([alyc, e]) => ({ alyc, date: e.date, operations: e.operations }))
      .sort((a, b) => a.alyc.localeCompare(b.alyc, 'es')),
  };
}

export function exportFilename(lastOperationDate: string | null, operations: number): string {
  return backupFilename(lastOperationDate, operations).replace(/^Backup aranceles/, 'Historial aranceles');
}

export type HistoryContentItem = { label: string; detail: string };

/** Qué guarda el JSON del historial (y qué no), para explicarlo al exportar. */
export function describeHistoryContents(history: ArancelesHistory): {
  included: HistoryContentItem[];
  notIncluded: HistoryContentItem[];
} {
  const ops = history.commissions;
  const manual = ops.filter((c) => c.manual_commission != null).length;
  const trading = new Set(ops.map((c) => c.trading_group?.id).filter(Boolean)).size;
  const schedules = history.fee_schedules;
  const manualSchedules = schedules.filter((s) => s.source === 'manual').length;
  const s = coerceSettings(history.settings);
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  return {
    included: [
      {
        label: 'Operaciones con arancel',
        detail:
          `${n(ops.length, 'operación', 'operaciones')} de todas las ALYC, con su estado de control` +
          `, ${n(manual, 'arancel SENEBI cargado a mano', 'aranceles SENEBI cargados a mano')}` +
          ` y ${n(trading, 'grupo de posible trading', 'grupos de posible trading')}.`,
      },
      {
        label: 'Importaciones',
        detail: `${n(history.imports.length, 'archivo importado', 'archivos importados')} (con duplicados y conflictos) y ${n(
          Object.keys(history.drive_files).length,
          'archivo de Drive procesado',
          'archivos de Drive procesados'
        )}.`,
      },
      {
        label: 'Tarifas',
        detail: `${n(schedules.length, 'tarifa', 'tarifas')} por cliente (${manualSchedules} cargadas a mano, el resto inferidas).`,
      },
      {
        label: 'Configuración del neto',
        detail:
          `${n(s.net_rules.length, 'versión', 'versiones')} de alícuotas, ` +
          `${n(s.producers.length, 'productor', 'productores')}, ` +
          `${n(s.agreements.length, 'arreglo comercial', 'arreglos comerciales')}, ` +
          `${n(s.account_transfers.length, 'cambio de cuenta', 'cambios de cuenta')} y ` +
          `${n(s.person_aliases.length, 'alias de persona', 'alias de personas')}.`,
      },
    ],
    notIncluded: [
      {
        label: 'Mapping de cuentas',
        detail:
          'Advisor, grupo asesor y manager por cuenta comitente: se guardan en la configuración general del ' +
          'consolidador (Admin → Mapping cuentas), no en este archivo.',
      },
    ],
  };
}
