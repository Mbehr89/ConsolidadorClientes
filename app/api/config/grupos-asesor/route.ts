import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { GruposAsesorStoreSchema } from '@/lib/config-store/types';
import { getGruposAsesor, setGruposAsesor } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getGruposAsesor());
  } catch {
    return NextResponse.json({ error: 'No se pudo leer los grupos asesores' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = GruposAsesorStoreSchema.parse(json);
    await setGruposAsesor(data);
    return NextResponse.json(await getGruposAsesor());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    console.error('[grupos-asesor] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
