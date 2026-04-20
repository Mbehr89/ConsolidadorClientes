import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { GruposStoreSchema } from '@/lib/config-store/types';
import { getGrupos, setGrupos } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getGrupos();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer grupos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = GruposStoreSchema.parse(json);
    await setGrupos(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    console.error('[grupos] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
