import { createSign } from 'node:crypto';

export const DRIVE_SCOPE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
/** Necesario para actualizar archivos que no creó la service account (p. ej. el historial JSON). */
export const DRIVE_SCOPE_FULL = 'https://www.googleapis.com/auth/drive';

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);
export const GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveListFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

export type DriveListFileWithPath = DriveListFile & {
  /** Ruta de carpetas relativa a la raíz monitoreada (sin el nombre del archivo). */
  path: string[];
};

export type ServiceAccountCredentials = { clientEmail: string; privateKey: string };

export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

/** Lee GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY. */
export function getServiceAccountFromEnv():
  | { ok: true; creds: ServiceAccountCredentials }
  | { ok: false; missing: string[] } {
  const clientEmail = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const missing: string[] = [];
  if (!clientEmail) missing.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKeyRaw) missing.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    creds: { clientEmail: clientEmail!, privateKey: normalizePrivateKey(privateKeyRaw!) },
  };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function getServiceAccountAccessToken(
  clientEmail: string,
  privateKey: string,
  scope: string = DRIVE_SCOPE_READONLY
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
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

export async function driveFetch<T>(url: string, accessToken: string): Promise<T> {
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

export async function listFolderFiles(
  folderId: string,
  accessToken: string,
  extraQuery?: string
): Promise<DriveListFile[]> {
  const q = `'${folderId}' in parents and trashed=false${extraQuery ? ` and ${extraQuery}` : ''}`;
  const collected: DriveListFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await driveFetch<{ files?: DriveListFile[]; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      accessToken
    );
    collected.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return collected;
}

export async function listFolderFilesRecursive(
  rootFolderId: string,
  accessToken: string
): Promise<DriveListFile[]> {
  const withPath = await listFolderFilesRecursiveWithPath(rootFolderId, accessToken);
  return withPath.map(({ path: _path, ...f }) => f);
}

export async function listFolderFilesRecursiveWithPath(
  rootFolderId: string,
  accessToken: string
): Promise<DriveListFileWithPath[]> {
  const queue: { id: string; path: string[] }[] = [{ id: rootFolderId, path: [] }];
  const visited = new Set<string>();
  const collected: DriveListFileWithPath[] = [];
  const folderConcurrency = 4;

  while (queue.length > 0) {
    const batch: { id: string; path: string[] }[] = [];
    while (batch.length < folderConcurrency && queue.length > 0) {
      const folder = queue.shift()!;
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      batch.push(folder);
    }
    if (batch.length === 0) continue;

    const folderResults = await Promise.all(
      batch.map(async (folder) => ({
        folder,
        children: await listFolderFiles(folder.id, accessToken),
      }))
    );

    for (const { folder, children } of folderResults) {
      for (const child of children) {
        if (child.mimeType === GOOGLE_FOLDER_MIME) {
          if (!visited.has(child.id)) queue.push({ id: child.id, path: [...folder.path, child.name] });
          continue;
        }
        collected.push({ ...child, path: folder.path });
      }
    }
  }

  return collected;
}

export async function verifyFolderAccess(folderId: string, accessToken: string): Promise<void> {
  await driveFetch<{ id: string }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?` +
      new URLSearchParams({
        fields: 'id,name',
        supportsAllDrives: 'true',
      }).toString(),
    accessToken
  );
}

export async function getDriveFileMeta(fileId: string, accessToken: string): Promise<DriveListFile> {
  return driveFetch<DriveListFile>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?` +
      new URLSearchParams({
        fields: 'id,name,mimeType,modifiedTime',
        supportsAllDrives: 'true',
      }).toString(),
    accessToken
  );
}

export function isImportableSpreadsheet(file: DriveListFile): boolean {
  if (file.mimeType === GOOGLE_SHEETS_MIME) return true;
  if (EXCEL_MIME_TYPES.has(file.mimeType)) return true;
  return /\.(xlsx|xls|xlsm)$/i.test(file.name);
}

export function normalizeDownloadedFilename(file: DriveListFile): string {
  if (file.mimeType === GOOGLE_SHEETS_MIME && !/\.xlsx$/i.test(file.name)) {
    return `${file.name}.xlsx`;
  }
  return file.name;
}

export async function downloadSpreadsheetFile(
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

export async function downloadFileText(fileId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?` +
      new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' }).toString(),
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res.text();
}

/** Busca un archivo por nombre exacto dentro de una carpeta (no recursivo). */
export async function findFileInFolder(
  folderId: string,
  name: string,
  accessToken: string
): Promise<DriveListFile | null> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const files = await listFolderFiles(folderId, accessToken, `name='${escaped}'`);
  return files[0] ?? null;
}

/** Reemplaza el contenido de un archivo existente (mantiene id y dueño). */
export async function updateFileContent(
  fileId: string,
  content: string,
  mimeType: string,
  accessToken: string
): Promise<DriveListFile> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?` +
      new URLSearchParams({
        uploadType: 'media',
        supportsAllDrives: 'true',
        fields: 'id,name,mimeType,modifiedTime',
      }).toString(),
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
      body: content,
      cache: 'no-store',
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return (await res.json()) as DriveListFile;
}

/**
 * Crea un archivo en la carpeta. En "Mi unidad" las service accounts no tienen cuota,
 * así que esto sólo funciona en unidades compartidas; si falla, hay que crear el archivo a mano.
 */
export async function createFileInFolder(
  folderId: string,
  name: string,
  content: string,
  mimeType: string,
  accessToken: string
): Promise<DriveListFile> {
  const boundary = `----aranceles${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?' +
      new URLSearchParams({
        uploadType: 'multipart',
        supportsAllDrives: 'true',
        fields: 'id,name,mimeType,modifiedTime',
      }).toString(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: 'no-store',
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive API ${res.status}: ${txt}`);
  }
  return (await res.json()) as DriveListFile;
}
