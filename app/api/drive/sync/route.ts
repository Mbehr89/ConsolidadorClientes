import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDriveImported, setDriveImported } from '@/lib/config-store/accessors';
import { getConfigStorageBackend } from '@/lib/config-store';
import type { DriveImportedStore } from '@/lib/config-store/types';
import {
  downloadSpreadsheetFile,
  getDriveFileMeta,
  getServiceAccountAccessToken,
  isImportableSpreadsheet,
  listFolderFilesRecursive,
  normalizeDownloadedFilename,
  normalizePrivateKey,
  verifyFolderAccess,
} from '@/lib/drive/google-drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** LÃ­mite bajo para evitar FUNCTION_INVOCATION_TIMEOUT en Vercel (10â€“60s). */
const DEFAULT_SYNC_LIMIT = 2;
const MAX_SYNC_LIMIT = 4;

function parseSyncLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return DEFAULT_SYNC_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SYNC_LIMIT;
  return Math.min(n, MAX_SYNC_LIMIT);
}

function parseExcludeIds(url: URL): Set<string> {
  const raw = url.searchParams.get('exclude')?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function parseDownloadIds(url: URL): string[] {
  const raw = url.searchParams.get('ids')?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_SYNC_LIMIT);
}

const AckSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      modifiedTime: z.string().nullable(),
    })
  ),
});

function ensureDriveConfigured():
  | { ok: true; folderId: string; clientEmail: string; privateKey: string }
  | { ok: false; missing: string[] } {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  const clientEmail = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const missing: string[] = [];
  if (!folderId) missing.push('GOOGLE_DRIVE_FOLDER_ID');
  if (!clientEmail) missing.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKeyRaw) missing.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (missing.length > 0) return { ok: false as const, missing };
  const privateKey = normalizePrivateKey(privateKeyRaw!);
  return {
    ok: true as const,
    folderId: folderId!,
    clientEmail: clientEmail!,
    privateKey,
  };
}

function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

function buildProductionWarnings(): string[] {
  const warnings: string[] = [];
  if (process.env.NODE_ENV === 'production' && getConfigStorageBackend() === 'local') {
    warnings.push(
      'Sin Redis/KV en producciÃ³n: el registro de archivos importados de Drive no persiste entre requests.'
    );
  }
  if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET?.trim()) {
    warnings.push(
      'CRON_SECRET no configurado en Vercel: el cron diario /api/drive/sync?mode=cron responde 401.'
    );
  }
  return warnings;
}

export async function GET(req: Request) {
  const cfg = ensureDriveConfigured();
  if (!cfg.ok) {
    return NextResponse.json(
      {
        error: `Faltan variables de Drive: ${cfg.missing.join(', ')}.`,
      },
      { status: 400 }
    );
  }

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');
    const force = url.searchParams.get('force') === '1';
    const syncLimit = parseSyncLimit(url);
    const excludeIds = parseExcludeIds(url);
    const downloadIds = parseDownloadIds(url);
    const cronMode = mode === 'cron';
    const healthMode = mode === 'health';
    const listMode = mode === 'list';

    if (healthMode) {
      const accessToken = await getServiceAccountAccessToken(cfg.clientEmail, cfg.privateKey);
      await verifyFolderAccess(cfg.folderId, accessToken);
      return NextResponse.json({
        ok: true,
        mode: 'health',
        folderId: cfg.folderId,
        storageBackend: getConfigStorageBackend(),
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        warnings: buildProductionWarnings(),
      });
    }

    if (downloadIds.length > 0) {
      const accessToken = await getServiceAccountAccessToken(cfg.clientEmail, cfg.privateKey);
      const files: {
        id: string;
        name: string;
        modifiedTime: string | null;
        contentBase64: string;
      }[] = [];

      for (const fileId of downloadIds) {
        const meta = await getDriveFileMeta(fileId, accessToken);
        if (!isImportableSpreadsheet(meta)) continue;
        const buffer = await downloadSpreadsheetFile(meta, accessToken);
        files.push({
          id: meta.id,
          name: normalizeDownloadedFilename(meta),
          modifiedTime: meta.modifiedTime ?? null,
          contentBase64: buffer.toString('base64'),
        });
      }

      return NextResponse.json({
        ok: true,
        mode: 'download',
        folderId: cfg.folderId,
        newCount: files.length,
        syncLimit: downloadIds.length,
        storageBackend: getConfigStorageBackend(),
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        warnings: buildProductionWarnings(),
        files,
      });
    }
    if (cronMode && !isCronAuthorized(req)) {
      const missingCron = !process.env.CRON_SECRET?.trim();
      return NextResponse.json(
        {
          error: missingCron
            ? 'CRON_SECRET no configurado. AgregÃ¡ la variable en Vercel â†’ Settings â†’ Environment Variables (Production) y redeploy.'
            : 'Unauthorized cron request. VerificÃ¡ que CRON_SECRET en Vercel coincida con el valor enviado por el cron.',
        },
        { status: 401 }
      );
    }

    const accessToken = await getServiceAccountAccessToken(cfg.clientEmail, cfg.privateKey);
    const imported = await getDriveImported();
    const listed = await listFolderFilesRecursive(cfg.folderId, accessToken);
    const candidates = listed.filter(isImportableSpreadsheet);
    const pending = force
      ? candidates
      : candidates.filter((f) => {
          const prev = imported[f.id];
          if (!prev) return true;
          const currentModified = f.modifiedTime ?? null;
          const importedModified = prev.modified_time ?? null;
          // Reimportar cuando el archivo fue actualizado en Drive desde la Ãºltima ingesta.
          if (currentModified && importedModified && currentModified !== importedModified) return true;
          return false;
        });

    if (listMode) {
      return NextResponse.json({
        ok: true,
        mode: 'list',
        force,
        folderId: cfg.folderId,
        totalInFolder: candidates.length,
        importedCount: Object.keys(imported).length,
        pendingCount: pending.length,
        storageBackend: getConfigStorageBackend(),
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        warnings: buildProductionWarnings(),
        pendingFiles: pending.map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime ?? null,
        })),
      });
    }

    if (cronMode) {
      return NextResponse.json({
        ok: true,
        mode: 'cron',
        force,
        folderId: cfg.folderId,
        totalInFolder: candidates.length,
        importedCount: Object.keys(imported).length,
        newCount: pending.length,
        storageBackend: getConfigStorageBackend(),
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        warnings: buildProductionWarnings(),
        pendingFiles: pending.map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime ?? null,
        })),
      });
    }

    const pendingSorted = [...pending]
      .filter((f) => !excludeIds.has(f.id))
      .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
    const toDownload = pendingSorted.slice(0, syncLimit);
    const skippedCount = Math.max(0, pendingSorted.length - toDownload.length);

    const files: {
      id: string;
      name: string;
      modifiedTime: string | null;
      contentBase64: string;
    }[] = [];

    for (const f of toDownload) {
      const buffer = await downloadSpreadsheetFile(f, accessToken);
      files.push({
        id: f.id,
        name: normalizeDownloadedFilename(f),
        modifiedTime: f.modifiedTime ?? null,
        contentBase64: buffer.toString('base64'),
      });
    }

    return NextResponse.json({
      ok: true,
      mode: 'service-account',
      force,
      folderId: cfg.folderId,
      totalInFolder: candidates.length,
      importedCount: Object.keys(imported).length,
      newCount: files.length,
      pendingCount: pending.length,
      skippedCount,
      syncLimit,
      storageBackend: getConfigStorageBackend(),
      cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      warnings: buildProductionWarnings(),
      files,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[drive.sync] GET failed', err);
    return NextResponse.json(
      { error: `No se pudieron sincronizar archivos de Drive. ${detail}` },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const parsed = AckSchema.parse(body);
    const current = await getDriveImported();
    const next: DriveImportedStore = { ...current };
    const now = new Date().toISOString();
    for (const file of parsed.files) {
      next[file.id] = {
        file_id: file.id,
        name: file.name,
        modified_time: file.modifiedTime ?? now,
        imported_at: now,
      };
    }
    await setDriveImported(next);
    return NextResponse.json({ ok: true, importedCount: Object.keys(next).length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Body invÃ¡lido.' }, { status: 400 });
    }
    console.error('[drive.sync] POST failed', err);
    return NextResponse.json({ error: 'No se pudo registrar importaciÃ³n.' }, { status: 500 });
  }
}

