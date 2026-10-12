import { NextResponse } from 'next/server';
import { createHistoryBackup } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const backup = await createHistoryBackup();
    return NextResponse.json(backup);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo generar el backup.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
