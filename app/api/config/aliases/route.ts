import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AliasStoreSchema } from '@/lib/config-store/types';
import { getAliases, setAliases } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getAliases();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer aliases' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = AliasStoreSchema.parse(json);
    await setAliases(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    console.error('[aliases] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
