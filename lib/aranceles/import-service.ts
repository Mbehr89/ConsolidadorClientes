import { REQUIRED_FIELDS } from '@/lib/aranceles/aliases';
import type { DedupConflict } from '@/lib/aranceles/dedup';
import { applyImport, removeImports, runFeeAnalysis } from '@/lib/aranceles/history';
import { IEB_SEGMENTS, type IebSegment } from '@/lib/aranceles/mappers/ieb';
import { normalizeParsed, parseImportBuffer, type ParsedImport } from '@/lib/aranceles/pipeline';
import {
  getArancelesDriveConfig,
  getArancelesDriveToken,
  loadHistory,
  mutateHistory,
} from '@/lib/aranceles/store';
import type {
  ArancelesHistory,
  ColumnMapping,
  DriveFileRecord,
  NormalizedRow,
} from '@/lib/aranceles/types';
import {
  downloadSpreadsheetFile,
  isImportableSpreadsheet,
  listFolderFilesRecursiveWithPath,
  normalizeDownloadedFilename,
  type DriveListFileWithPath,
} from '@/lib/drive/google-drive';

// ─── Período a partir de nombre / carpeta ───────────────

const PERIOD_RE_YM = /(20\d{2})[-_. ]?(0[1-9]|1[0-2])(?!\d)/;
const PERIOD_RE_MY = /(?<!\d)(0[1-9]|1[0-2])[-_. ](20\d{2})/;

export function detectPeriod(...sources: (string | null | undefined)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const ym = s.match(PERIOD_RE_YM);
    if (ym) return `${ym[1]}-${ym[2]}`;
    const my = s.match(PERIOD_RE_MY);
    if (my) return `${my[2]}-${my[1]}`;
  }
  return null;
}

/** Mes anterior al de la fecha dada (los resúmenes se suben después del cierre). */
function previousMonth(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

function looksLikePeriod(s: string): boolean {
  return detectPeriod(s) != null || /^\d{4}$/.test(s.trim());
}

// ─── Preparación de un archivo ──────────────────────────

export type PreparedFile = {
  filename: string;
  imp: ParsedImport;
  rows: NormalizedRow[];
  errors: { index: number; message: string }[];
  skipped: number;
  needsMapping: boolean;
};

export function prepareFile(
  buffer: Uint8Array | ArrayBuffer,
  filename: string,
  opts: { fallbackDate?: string | null; forceSegment?: IebSegment; mapping?: ColumnMapping } = {}
): PreparedFile {
  const imp = parseImportBuffer(buffer, filename, {
    fallbackDate: opts.fallbackDate ?? null,
    forceSegment: opts.forceSegment,
  });
  if (imp.empty) {
    return { filename, imp, rows: [], errors: [], skipped: 0, needsMapping: false };
  }
  const mapping = opts.mapping ?? imp.mapping;
  const fields = new Set(Object.values(mapping));
  const hasDate = fields.has('date') || (Boolean(opts.fallbackDate) && imp.format === 'ieb');
  const needsMapping = !fields.has('client') || !hasDate;
  if (needsMapping) {
    return { filename, imp, rows: [], errors: [], skipped: 0, needsMapping: true };
  }
  const { rows, errors, skipped } = normalizeParsed(imp, mapping);
  return { filename, imp, rows, errors, skipped, needsMapping: false };
}

export function missingRequiredFields(mapping: ColumnMapping, hasFallbackDate: boolean): string[] {
  const fields = new Set(Object.values(mapping));
  return REQUIRED_FIELDS.filter((f) => !fields.has(f) && !(f === 'date' && hasFallbackDate));
}

// ─── Import manual (un archivo) ─────────────────────────

export async function commitManualImport(input: {
  prepared: PreparedFile;
  alycName: string;
  notes?: string | null;
}): Promise<{
  importId: string | null;
  rowCount: number;
  duplicates: number;
  repeatedInFile: number;
  conflicts: DedupConflict[];
  anomalyCount: number;
  scheduleCount: number;
}> {
  const { prepared } = input;
  return mutateHistory((history) => {
    const applied = applyImport(history, {
      alyc: input.alycName,
      filename: prepared.filename,
      rows: prepared.rows,
      format: String(prepared.imp.format),
      segment: prepared.imp.segment ?? null,
      notes: input.notes ?? null,
      source: 'manual',
    });
    const analyzed = runFeeAnalysis(applied.history);
    return {
      history: analyzed,
      result: {
        importId: applied.importRecord?.id ?? null,
        rowCount: applied.inserted,
        duplicates: applied.duplicates,
        repeatedInFile: applied.repeatedInFile,
        conflicts: applied.conflicts,
        anomalyCount: countAnomaliesForImport(analyzed, applied.importRecord?.id ?? null),
        scheduleCount: analyzed.fee_schedules.length,
      },
    };
  });
}

function countAnomaliesForImport(history: ArancelesHistory, importId: string | null): number {
  if (!importId) return 0;
  return history.commissions.filter(
    (c) =>
      c.import_id === importId &&
      (c.fee_status === 'missing' ||
        c.fee_status === 'zero' ||
        c.fee_status === 'below_expected' ||
        c.fee_status === 'min_on_large')
  ).length;
}

// ─── Período IEB (varios archivos) ──────────────────────

export type IebSegmentResult = {
  segment: string;
  filename: string | null;
  rowCount: number;
  duplicates?: number;
  conflicts?: number;
  empty: boolean;
  skipped?: boolean;
  error?: string;
};

export async function commitIebPeriod(input: {
  files: { segment: IebSegment; filename: string; buffer: Uint8Array }[];
  fallbackDate: string;
  periodLabel: string;
  alycName?: string;
}): Promise<{ totalRows: number; results: IebSegmentResult[]; anomalyCount: number }> {
  const alyc = input.alycName?.trim() || 'IEB';
  const prepared: { segment: IebSegment; p: PreparedFile | null; error?: string; filename: string }[] = [];
  for (const f of input.files) {
    try {
      prepared.push({
        segment: f.segment,
        filename: f.filename,
        p: prepareFile(f.buffer, f.filename, { fallbackDate: input.fallbackDate, forceSegment: f.segment }),
      });
    } catch (e) {
      prepared.push({ segment: f.segment, filename: f.filename, p: null, error: e instanceof Error ? e.message : 'Error de segmento' });
    }
  }

  return mutateHistory((history) => {
    let h = history;
    let totalRows = 0;
    const results: IebSegmentResult[] = [];
    const importIds: string[] = [];

    for (const seg of IEB_SEGMENTS) {
      const entry = prepared.find((x) => x.segment === seg.id);
      if (!entry) {
        results.push({ segment: seg.id, filename: null, rowCount: 0, empty: true, skipped: true });
        continue;
      }
      if (!entry.p) {
        results.push({ segment: seg.id, filename: entry.filename, rowCount: 0, empty: true, error: entry.error });
        continue;
      }
      if (entry.p.imp.empty || entry.p.rows.length === 0) {
        results.push({
          segment: seg.id,
          filename: entry.filename,
          rowCount: 0,
          empty: true,
          error: entry.p.imp.empty
            ? undefined
            : entry.p.errors[0]?.message ?? 'Sin filas válidas (revisá columnas o dejá el segmento vacío).',
        });
        continue;
      }
      const applied = applyImport(h, {
        alyc,
        filename: entry.filename,
        rows: entry.p.rows,
        format: 'ieb',
        segment: seg.id,
        periodLabel: input.periodLabel,
        notes: `IEB período ${input.periodLabel}`,
        source: 'manual',
      });
      h = applied.history;
      if (applied.importRecord) importIds.push(applied.importRecord.id);
      totalRows += applied.inserted;
      results.push({
        segment: seg.id,
        filename: entry.filename,
        rowCount: applied.inserted,
        duplicates: applied.duplicates + applied.repeatedInFile,
        conflicts: applied.conflicts.length,
        empty: false,
      });
    }

    const analyzed = runFeeAnalysis(h);
    const anomalyCount = importIds.reduce((s, id) => s + countAnomaliesForImport(analyzed, id), 0);
    return { history: analyzed, result: { totalRows, results, anomalyCount } };
  });
}

/** Borra la importación. Las operaciones que también venían en otro archivo se conservan. */
export async function deleteImport(importId: string): Promise<{ removedRows: number; keptShared: number }> {
  return mutateHistory((history) => {
    const before = history.commissions.length;
    const keptShared = history.commissions.filter(
      (c) => c.import_id === importId && (c.also_in_imports ?? []).some((id) => id !== importId)
    ).length;
    let h = removeImports(history, [importId]);
    // Si el archivo de Drive se queda sin importaciones, se olvida el registro para que vuelva a
    // aparecer como pendiente y se pueda reimportar.
    const drive_files: Record<string, DriveFileRecord> = {};
    for (const [id, rec] of Object.entries(h.drive_files)) {
      if (!rec.import_ids.includes(importId)) {
        drive_files[id] = rec;
        continue;
      }
      const remaining = rec.import_ids.filter((x) => x !== importId);
      if (remaining.length > 0) drive_files[id] = { ...rec, import_ids: remaining };
    }
    h = runFeeAnalysis({ ...h, drive_files });
    return { history: h, result: { removedRows: before - h.commissions.length, keptShared } };
  });
}

// ─── Drive ──────────────────────────────────────────────

export type DrivePendingFile = {
  id: string;
  name: string;
  path: string;
  modifiedTime: string | null;
  reason: 'new' | 'modified' | 'retry' | 'forced';
};

function pendingReason(
  f: DriveListFileWithPath,
  rec: DriveFileRecord | undefined,
  force: boolean
): DrivePendingFile['reason'] | null {
  if (!rec) return 'new';
  if (f.modifiedTime && rec.modified_time && f.modifiedTime !== rec.modified_time) return 'modified';
  if (rec.status === 'error') return 'retry';
  return force ? 'forced' : null;
}

export async function listDrivePending(opts: { force?: boolean } = {}): Promise<{
  totalInFolder: number;
  processedCount: number;
  pending: DrivePendingFile[];
  records: DriveFileRecord[];
}> {
  const cfg = getArancelesDriveConfig();
  if (!cfg.ok) throw new Error(`Faltan variables de Drive: ${cfg.missing.join(', ')}.`);
  const token = await getArancelesDriveToken(cfg.config);
  const [listed, history] = await Promise.all([
    listFolderFilesRecursiveWithPath(cfg.config.folderId, token),
    loadHistory(),
  ]);
  const candidates = listed.filter(isImportableSpreadsheet);
  const pending: DrivePendingFile[] = [];
  for (const f of candidates) {
    const reason = pendingReason(f, history.drive_files[f.id], Boolean(opts.force));
    if (!reason) continue;
    pending.push({
      id: f.id,
      name: f.name,
      path: f.path.join(' / '),
      modifiedTime: f.modifiedTime ?? null,
      reason,
    });
  }
  pending.sort((a, b) => (a.modifiedTime ?? '').localeCompare(b.modifiedTime ?? ''));
  const records = Object.values(history.drive_files).sort((a, b) =>
    b.processed_at.localeCompare(a.processed_at)
  );
  return { totalInFolder: candidates.length, processedCount: records.length, pending, records };
}

function alycForDriveFile(imp: ParsedImport, path: string[]): string {
  if (imp.format === 'gma' || imp.format === 'ieb') {
    const folder = path.find((p) => !looksLikePeriod(p));
    if (imp.format === 'ieb') return 'IEB';
    return folder ?? imp.suggestedAlycName ?? 'GMA';
  }
  return path.find((p) => !looksLikePeriod(p)) ?? imp.suggestedAlycName ?? 'Sin ALYC';
}

export type DriveSyncFileResult = {
  id: string;
  name: string;
  path: string;
  status: DriveFileRecord['status'];
  rowCount: number;
  duplicates: number;
  conflicts: number;
  message: string | null;
};

/**
 * Procesa hasta `limit` archivos pendientes de la carpeta de Drive y guarda el historial.
 * Un archivo modificado reemplaza las filas que había importado antes.
 */
export async function syncDriveAranceles(opts: { limit?: number; force?: boolean; ids?: string[] } = {}): Promise<{
  processed: DriveSyncFileResult[];
  pendingRemaining: number;
  anomalyCount: number;
}> {
  const cfg = getArancelesDriveConfig();
  if (!cfg.ok) throw new Error(`Faltan variables de Drive: ${cfg.missing.join(', ')}.`);
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const token = await getArancelesDriveToken(cfg.config);

  const [listed, history] = await Promise.all([
    listFolderFilesRecursiveWithPath(cfg.config.folderId, token),
    loadHistory(),
  ]);
  const byId = new Map(listed.map((f) => [f.id, f]));
  let pending = listed
    .filter(isImportableSpreadsheet)
    .filter((f) => pendingReason(f, history.drive_files[f.id], Boolean(opts.force)) != null)
    .sort((a, b) => (a.modifiedTime ?? '').localeCompare(b.modifiedTime ?? ''));
  if (opts.ids?.length) {
    const wanted = new Set(opts.ids);
    pending = opts.ids.map((id) => byId.get(id)).filter((f): f is DriveListFileWithPath => Boolean(f && wanted.has(f.id)));
  }
  const batch = pending.slice(0, limit);
  if (batch.length === 0) return { processed: [], pendingRemaining: 0, anomalyCount: 0 };

  type Prepared = { file: DriveListFileWithPath; filename: string; prepared: PreparedFile | null; error: string | null; period: string };
  const prepared: Prepared[] = [];
  for (const file of batch) {
    const filename = normalizeDownloadedFilename(file);
    const period =
      detectPeriod(file.name, ...[...file.path].reverse()) ??
      (file.modifiedTime ? previousMonth(file.modifiedTime) : previousMonth(new Date().toISOString()));
    try {
      const buffer = await downloadSpreadsheetFile(file, token);
      prepared.push({
        file,
        filename,
        period,
        prepared: prepareFile(new Uint8Array(buffer), filename, { fallbackDate: `${period}-01` }),
        error: null,
      });
    } catch (e) {
      prepared.push({ file, filename, period, prepared: null, error: e instanceof Error ? e.message : 'Error al leer el archivo' });
    }
  }

  return mutateHistory((current) => {
    let h = current;
    const processed: DriveSyncFileResult[] = [];
    const newImportIds: string[] = [];
    const now = new Date().toISOString();

    for (const item of prepared) {
      const { file } = item;
      const pathLabel = file.path.join(' / ');
      const prevRecord = h.drive_files[file.id];
      if (prevRecord?.import_ids.length) h = removeImports(h, prevRecord.import_ids);

      let record: DriveFileRecord;
      let rowCount = 0;
      let duplicates = 0;
      let conflicts = 0;

      if (!item.prepared) {
        record = {
          file_id: file.id, name: file.name, path: pathLabel, modified_time: file.modifiedTime ?? null,
          processed_at: now, status: 'error', message: item.error, import_ids: [],
        };
      } else if (item.prepared.needsMapping || item.prepared.imp.format === 'generic') {
        record = {
          file_id: file.id, name: file.name, path: pathLabel, modified_time: file.modifiedTime ?? null,
          processed_at: now, status: 'needs_mapping',
          message: 'Formato no reconocido: importalo a mano desde "Subir archivo" para mapear las columnas.',
          import_ids: [],
        };
      } else if (item.prepared.imp.empty || item.prepared.rows.length === 0) {
        record = {
          file_id: file.id, name: file.name, path: pathLabel, modified_time: file.modifiedTime ?? null,
          processed_at: now, status: 'empty',
          message: item.prepared.imp.empty ? 'Archivo vacío (normal en algunos segmentos IEB).' : item.prepared.errors[0]?.message ?? 'Sin filas válidas.',
          import_ids: [],
        };
      } else {
        const imp = item.prepared.imp;
        const applied = applyImport(h, {
          alyc: alycForDriveFile(imp, file.path),
          filename: item.filename,
          rows: item.prepared.rows,
          format: String(imp.format),
          segment: imp.segment ?? null,
          periodLabel: item.period,
          notes: pathLabel ? `Drive: ${pathLabel}` : 'Drive',
          source: 'drive',
          driveFileId: file.id,
          driveModifiedTime: file.modifiedTime ?? null,
        });
        h = applied.history;
        rowCount = applied.inserted;
        duplicates = applied.duplicates + applied.repeatedInFile;
        conflicts = applied.conflicts.length;
        if (applied.importRecord) newImportIds.push(applied.importRecord.id);
        const warnings: string[] = [];
        if (item.prepared.errors.length) warnings.push(`${item.prepared.errors.length} filas omitidas por datos inválidos`);
        if (applied.duplicates) warnings.push(`${applied.duplicates} operaciones ya estaban en el historial`);
        if (applied.enriched) warnings.push(`a ${applied.enriched} de ellas se les completó el productor / detalle`);
        if (applied.repeatedInFile) warnings.push(`${applied.repeatedInFile} líneas repetidas dentro del archivo`);
        if (conflicts) {
          warnings.push(
            `${conflicts} con un n° de operación ya cargado pero con datos distintos: no se importaron (revisalas en Importar)`
          );
        }
        record = {
          file_id: file.id, name: file.name, path: pathLabel, modified_time: file.modifiedTime ?? null,
          processed_at: now, status: 'imported',
          message: warnings.length ? warnings.join(' · ') : null,
          import_ids: applied.importRecord ? [applied.importRecord.id] : [],
        };
      }

      h = { ...h, drive_files: { ...h.drive_files, [file.id]: record } };
      processed.push({
        id: file.id,
        name: file.name,
        path: pathLabel,
        status: record.status,
        rowCount,
        duplicates,
        conflicts,
        message: record.message,
      });
    }

    const analyzed = processed.length ? runFeeAnalysis(h) : h;
    const anomalyCount = newImportIds.reduce((s, id) => s + countAnomaliesForImport(analyzed, id), 0);
    return {
      history: analyzed,
      result: { processed, pendingRemaining: Math.max(0, pending.length - batch.length), anomalyCount },
    };
  });
}
