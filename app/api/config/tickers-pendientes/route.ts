import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { TickersPendientesStoreSchema } from '@/lib/config-store/types';
import { getTickersPendientes, setTickersPendientes } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getTickersPendientes();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer tickers-pendientes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = TickersPendientesStoreSchema.parse(json);
    await setTickersPendientes(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    console.error('[tickers-pendientes] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
