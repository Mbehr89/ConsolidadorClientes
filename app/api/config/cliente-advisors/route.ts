import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ClienteAdvisorStoreSchema } from '@/lib/config-store/types';
import { getClienteAdvisors, setClienteAdvisors } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getClienteAdvisors();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer cliente-advisors' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = ClienteAdvisorStoreSchema.parse(json);
    await setClienteAdvisors(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
