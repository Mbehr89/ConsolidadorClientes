import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listDrivePending, syncDriveAranceles } from '@/lib/aranceles/import-service';
import { getArancelesStorageInfo } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

/**
 * GET: estado de la conexión + archivos pendientes de la carpeta de aranceles.
 * GET ?mode=cron: procesa pendientes (Vercel Cron, requiere CRON_SECRET).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');
  const storage = getArancelesStorageInfo();

  if (mode === 'cron') {
    if (!isCronAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized cron request.' }, { status: 401 });
    }
    if (storage.backend !== 'drive') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Drive de aranceles no configurado.' });
    }
    try {
      const result = await syncDriveAranceles({ limit: 5 });
      return NextResponse.json({ ok: true, mode: 'cron', ...result });
    } catch (err) {
      console.error('[aranceles.drive] cron failed', err);
      const message = err instanceof Error ? err.message : 'Error desconocido';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (storage.backend !== 'drive') {
    return NextResponse.json({ storage, configured: false });
  }
  try {
    const force = url.searchParams.get('force') === '1';
    const status = await listDrivePending({ force });
    return NextResponse.json({ storage, configured: true, ...status });
  } catch (err) {
    console.error('[aranceles.drive] list failed', err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json(
      { storage, configured: true, error: `No se pudo leer la carpeta de Drive. ${message}` },
      { status: 500 }
    );
  }
}

const SyncBody = z.object({
  limit: z.number().int().min(1).max(10).optional(),
  force: z.boolean().optional(),
  ids: z.array(z.string()).max(10).optional(),
});

/** Procesa un lote de archivos pendientes y actualiza el historial JSON en Drive. */
export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => ({}));
    const body = SyncBody.parse(raw ?? {});
    const result = await syncDriveAranceles(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
    }
    console.error('[aranceles.drive] sync failed', err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json({ error: `No se pudo sincronizar. ${message}` }, { status: 500 });
  }
}
