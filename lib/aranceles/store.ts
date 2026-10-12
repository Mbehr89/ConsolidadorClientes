import { promises as fs } from 'node:fs';
import path from 'node:path';
import { summarizeBackup, type BackupSummary } from '@/lib/aranceles/backup';
import { findDuplicateGroups, findSharedIdGroups } from '@/lib/aranceles/dedup';
import { coerceHistory, emptyHistory } from '@/lib/aranceles/history';
import type { ArancelesHistory } from '@/lib/aranceles/types';
import {
  DRIVE_SCOPE_FULL,
  createFileInFolder,
  downloadFileText,
  findFileInFolder,
  getDriveFileMeta,
  getServiceAccountAccessToken,
  getServiceAccountFromEnv,
  updateFileContent,
  type ServiceAccountCredentials,
} from '@/lib/drive/google-drive';

const DEFAULT_HISTORY_FILENAME = 'aranceles-historial.json';
const LOCAL_HISTORY_FILE = path.join(process.cwd(), '.local-store', DEFAULT_HISTORY_FILENAME);
const LOCAL_BACKUP_DIR = path.join(process.cwd(), '.local-store', 'backups-aranceles');
const JSON_MIME = 'application/json';

export type ArancelesDriveConfig = {
  folderId: string;
  historyFileId: string | null;
  historyFilename: string;
  creds: ServiceAccountCredentials;
};

export type ArancelesStorageInfo =
  | { backend: 'drive'; folderId: string; historyFilename: string }
  | { backend: 'local'; path: string; missingDriveVars: string[] };

export function getArancelesDriveConfig():
  | { ok: true; config: ArancelesDriveConfig }
  | { ok: false; missing: string[] } {
  const folderId = process.env.GOOGLE_DRIVE_ARANCELES_FOLDER_ID?.trim();
  const sa = getServiceAccountFromEnv();
  const missing: string[] = [];
  if (!folderId) missing.push('GOOGLE_DRIVE_ARANCELES_FOLDER_ID');
  if (!sa.ok) missing.push(...sa.missing);
  if (missing.length > 0 || !sa.ok) return { ok: false, missing };
  return {
    ok: true,
    config: {
      folderId: folderId!,
      historyFileId: process.env.GOOGLE_DRIVE_ARANCELES_HISTORY_FILE_ID?.trim() || null,
      historyFilename:
        process.env.GOOGLE_DRIVE_ARANCELES_HISTORY_FILENAME?.trim() || DEFAULT_HISTORY_FILENAME,
      creds: sa.creds,
    },
  };
}

export function getArancelesStorageInfo(): ArancelesStorageInfo {
  const cfg = getArancelesDriveConfig();
  if (cfg.ok) {
    return {
      backend: 'drive',
      folderId: cfg.config.folderId,
      historyFilename: cfg.config.historyFilename,
    };
  }
  return { backend: 'local', path: LOCAL_HISTORY_FILE, missingDriveVars: cfg.missing };
}

export async function getArancelesDriveToken(config: ArancelesDriveConfig): Promise<string> {
  return getServiceAccountAccessToken(config.creds.clientEmail, config.creds.privateKey, DRIVE_SCOPE_FULL);
}

// ─── Cache por instancia (evita bajar el JSON en cada request) ──

type Loaded = { history: ArancelesHistory; fileId: string | null; modifiedTime: string | null };

const g = globalThis as typeof globalThis & {
  __arancelesCache?: Loaded;
  __arancelesWriteChain?: Promise<unknown>;
};

function parseHistoryText(text: string): ArancelesHistory {
  if (!text.trim()) return emptyHistory();
  try {
    return coerceHistory(JSON.parse(text));
  } catch {
    throw new Error('El historial de aranceles no es un JSON válido. Revisalo en Drive antes de seguir.');
  }
}

async function resolveHistoryFileId(config: ArancelesDriveConfig, token: string): Promise<string | null> {
  if (config.historyFileId) return config.historyFileId;
  if (g.__arancelesCache?.fileId) return g.__arancelesCache.fileId;
  const found = await findFileInFolder(config.folderId, config.historyFilename, token);
  return found?.id ?? null;
}

async function loadFromDrive(config: ArancelesDriveConfig, token: string): Promise<Loaded> {
  const fileId = await resolveHistoryFileId(config, token);
  if (!fileId) return { history: emptyHistory(), fileId: null, modifiedTime: null };

  const meta = await getDriveFileMeta(fileId, token);
  const modifiedTime = meta.modifiedTime ?? null;
  const cached = g.__arancelesCache;
  if (cached && cached.fileId === fileId && cached.modifiedTime && cached.modifiedTime === modifiedTime) {
    return cached;
  }
  const text = await downloadFileText(fileId, token);
  const loaded = { history: parseHistoryText(text), fileId, modifiedTime };
  g.__arancelesCache = loaded;
  return loaded;
}

async function saveToDrive(
  config: ArancelesDriveConfig,
  token: string,
  fileId: string | null,
  history: ArancelesHistory
): Promise<Loaded> {
  const content = JSON.stringify(history);
  let meta;
  if (fileId) {
    meta = await updateFileContent(fileId, content, JSON_MIME, token);
  } else {
    try {
      meta = await createFileInFolder(config.folderId, config.historyFilename, content, JSON_MIME, token);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `No se pudo crear "${config.historyFilename}" en la carpeta de Drive. ` +
          'Las service accounts no pueden crear archivos en "Mi unidad": subí a esa carpeta un archivo vacío con ese nombre ' +
          `(o usá una unidad compartida) y volvé a intentar. Detalle: ${detail}`
      );
    }
  }
  const loaded = { history, fileId: meta.id, modifiedTime: meta.modifiedTime ?? null };
  g.__arancelesCache = loaded;
  return loaded;
}

async function loadFromLocal(): Promise<Loaded> {
  try {
    const text = await fs.readFile(LOCAL_HISTORY_FILE, 'utf8');
    return { history: parseHistoryText(text), fileId: null, modifiedTime: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { history: emptyHistory(), fileId: null, modifiedTime: null };
    }
    throw err;
  }
}

async function saveToLocal(history: ArancelesHistory): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_HISTORY_FILE), { recursive: true });
  await fs.writeFile(LOCAL_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

export async function loadHistory(): Promise<ArancelesHistory> {
  const cfg = getArancelesDriveConfig();
  if (!cfg.ok) return (await loadFromLocal()).history;
  const token = await getArancelesDriveToken(cfg.config);
  return (await loadFromDrive(cfg.config, token)).history;
}

export type BackupResult = BackupSummary & {
  content: string;
  storedIn: 'drive' | 'local' | null;
  storeError: string | null;
};

async function uniqueLocalPath(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? filename : `${base} (${n})${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

/**
 * Copia del historial completo con nombre "Backup aranceles - <última operación> - <N> operaciones.json".
 * Se serializa con las escrituras para que la copia nunca quede a mitad de una importación.
 */
export async function createHistoryBackup(): Promise<BackupResult> {
  const run = async (): Promise<BackupResult> => {
    const cfg = getArancelesDriveConfig();
    if (!cfg.ok) {
      const { history } = await loadFromLocal();
      const summary = summarizeBackup(history);
      const content = JSON.stringify(history, null, 2);
      await fs.mkdir(LOCAL_BACKUP_DIR, { recursive: true });
      const target = await uniqueLocalPath(LOCAL_BACKUP_DIR, summary.filename);
      await fs.writeFile(target, content, 'utf8');
      return { ...summary, filename: path.basename(target), content, storedIn: 'local', storeError: null };
    }

    const token = await getArancelesDriveToken(cfg.config);
    g.__arancelesCache = undefined;
    const { history } = await loadFromDrive(cfg.config, token);
    const summary = summarizeBackup(history);
    const content = JSON.stringify(history);
    try {
      await createFileInFolder(cfg.config.folderId, summary.filename, content, JSON_MIME, token);
      return { ...summary, content, storedIn: 'drive', storeError: null };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const storeError = /storageQuotaExceeded|do not have storage quota/i.test(detail)
        ? 'Google no deja que la cuenta de servicio cree archivos nuevos en una carpeta de "Mi unidad". ' +
          'El backup se descargó a tu PC: subilo a la carpeta de Drive (o mové la carpeta a una unidad compartida ' +
          'para que se guarde solo).'
        : `No se pudo guardar el backup en Drive (${detail.slice(0, 200)}). Se descargó a tu PC.`;
      return { ...summary, content, storedIn: null, storeError };
    }
  };

  const prev = g.__arancelesWriteChain ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__arancelesWriteChain = next.catch(() => undefined);
  return next;
}

/** Ningún cambio puede dejar operaciones repetidas: si aparecen, se aborta sin guardar. */
function assertNoNewDuplicates(before: ArancelesHistory, after: ArancelesHistory) {
  const sample = (groups: { op_number: string | null }[]) =>
    groups
      .slice(0, 5)
      .map((g) => g.op_number)
      .join(', ');
  const next = findDuplicateGroups(after.commissions);
  if (next.length > findDuplicateGroups(before.commissions).length) {
    throw new Error(
      `Se detectaron operaciones duplicadas (n° ${sample(next)}). No se guardó ningún cambio en el historial.`
    );
  }
  const shared = findSharedIdGroups(after.commissions);
  if (shared.length > findSharedIdGroups(before.commissions).length) {
    throw new Error(
      `Un mismo n° de operación quedaría asignado a operaciones distintas (n° ${sample(shared)}). ` +
        'No se guardó ningún cambio en el historial.'
    );
  }
}

/**
 * Lee el historial, aplica `fn` y lo guarda. Las escrituras se serializan por instancia;
 * si el archivo cambió en Drive entre la lectura y la escritura, se relee y se reaplica una vez.
 */
export async function mutateHistory<R>(
  fn: (history: ArancelesHistory) => { history: ArancelesHistory; result: R } | Promise<{ history: ArancelesHistory; result: R }>
): Promise<R> {
  const run = async (): Promise<R> => {
    const cfg = getArancelesDriveConfig();
    if (!cfg.ok) {
      const { history } = await loadFromLocal();
      const out = await fn(history);
      assertNoNewDuplicates(history, out.history);
      await saveToLocal({ ...out.history, updated_at: new Date().toISOString() });
      return out.result;
    }

    const token = await getArancelesDriveToken(cfg.config);
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = await loadFromDrive(cfg.config, token);
      const out = await fn(loaded.history);
      assertNoNewDuplicates(loaded.history, out.history);
      if (loaded.fileId && attempt === 0) {
        const meta = await getDriveFileMeta(loaded.fileId, token);
        if ((meta.modifiedTime ?? null) !== loaded.modifiedTime) {
          g.__arancelesCache = undefined;
          continue;
        }
      }
      await saveToDrive(cfg.config, token, loaded.fileId, {
        ...out.history,
        updated_at: new Date().toISOString(),
      });
      return out.result;
    }
    throw new Error('El historial cambió mientras se guardaba. Reintentá.');
  };

  const prev = g.__arancelesWriteChain ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__arancelesWriteChain = next.catch(() => undefined);
  return next;
}
