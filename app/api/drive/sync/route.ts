import { createSign } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDriveImported, setDriveImported } from '@/lib/config-store/accessors';
import type { DriveImportedStore } from '@/lib/config-store/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);
const GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

const AckSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      modifiedTime: z.string().nullable(),
    })
  ),
});

type DriveListFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

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
  const privateKey = privateKeyRaw!.replace(/\\n/g, '\n');
  return {
    ok: true as const,
    folderId: folderId!,
    clientEmail: clientEmail!,
    privateKey,
  };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getServiceAccountAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`No se pudo obtener token de Service Account: ${txt}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('Respuesta inválida al pedir token de Service Account.');
  }
  return tokenJson.access_token;
}

async function driveFetch<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

async function listFolderFiles(folderId: string, accessToken: string): Promise<DriveListFile[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?` +
    new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }).toString();
  const payload = await driveFetch<{ files?: DriveListFile[] }>(url, accessToken);
  return payload.files ?? [];
}

async function listFolderFilesRecursive(
  rootFolderId: string,
  accessToken: string
): Promise<DriveListFile[]> {
  const queue = [rootFolderId];
  const visited = new Set<string>();
  const collected: DriveListFile[] = [];

  while (queue.length > 0) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);

    const children = await listFolderFiles(folderId, accessToken);
    for (const child of children) {
      if (child.mimeType === GOOGLE_FOLDER_MIME) {
        queue.push(child.id);
        continue;
      }
      collected.push(child);
    }
  }

  return collected;
}

function isImportableSpreadsheet(file: DriveListFile): boolean {
  if (file.mimeType === GOOGLE_SHEETS_MIME) return true;
  if (EXCEL_MIME_TYPES.has(file.mimeType)) return true;
  return /\.(xlsx|xls|xlsm)$/i.test(file.name);
}

function normalizeDownloadedFilename(file: DriveListFile): string {
  if (file.mimeType === GOOGLE_SHEETS_MIME && !/\.xlsx$/i.test(file.name)) {
    return `${file.name}.xlsx`;
  }
  return file.name;
}

async function downloadSpreadsheetFile(
  file: DriveListFile,
  accessToken: string
): Promise<Buffer> {
  const url =
    file.mimeType === GOOGLE_SHEETS_MIME
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?` +
        new URLSearchParams({
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          supportsAllDrives: 'true',
        }).toString()
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?` +
        new URLSearchParams({
          alt: 'media',
          supportsAllDrives: 'true',
        }).toString();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`No se pudo descargar ${file.name}`);
  return Buffer.from(await res.arrayBuffer());
}

function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
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
    const cronMode = mode === 'cron';
    if (cronMode && !isCronAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized cron request.' }, { status: 401 });
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
          // Reimportar cuando el archivo fue actualizado en Drive desde la última ingesta.
          if (currentModified && importedModified && currentModified !== importedModified) return true;
          return false;
        });

    if (cronMode) {
      return NextResponse.json({
        ok: true,
        mode: 'cron',
        force,
        folderId: cfg.folderId,
        totalInFolder: candidates.length,
        importedCount: Object.keys(imported).length,
        newCount: pending.length,
        pendingFiles: pending.map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime ?? null,
        })),
      });
    }

    const files = await Promise.all(
      pending.map(async (f) => {
        const buffer = await downloadSpreadsheetFile(f, accessToken);
        return {
          id: f.id,
          name: normalizeDownloadedFilename(f),
          modifiedTime: f.modifiedTime ?? null,
          contentBase64: buffer.toString('base64'),
        };
      })
    );

    return NextResponse.json({
      ok: true,
      mode: 'service-account',
      force,
      folderId: cfg.folderId,
      totalInFolder: candidates.length,
      importedCount: Object.keys(imported).length,
      newCount: files.length,
      files,
    });
  } catch (err) {
    console.error('[drive.sync] GET failed', err);
    return NextResponse.json(
      { error: 'No se pudieron sincronizar archivos de Drive.' },
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
      return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
    }
    console.error('[drive.sync] POST failed', err);
    return NextResponse.json({ error: 'No se pudo registrar importación.' }, { status: 500 });
  }
}

