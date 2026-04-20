import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MappingCuentasStoreSchema } from '@/lib/config-store/types';
import { getMappingCuentas, setMappingCuentas } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getMappingCuentas();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el mapping' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = MappingCuentasStoreSchema.parse(json);
    await setMappingCuentas(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    // No loguear cuerpo de request (PII)
    console.error('[mapping-cuentas] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
