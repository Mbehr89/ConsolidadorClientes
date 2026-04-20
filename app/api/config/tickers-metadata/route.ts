import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { TickersMetadataStoreSchema } from '@/lib/config-store/types';
import { getTickersMetadata, setTickersMetadata } from '@/lib/config-store/accessors';
import { TICKER_SEED } from '@/lib/config-store/ticker-seed';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    let data = await getTickersMetadata();
    if (Object.keys(data).length === 0) {
      data = { ...TICKER_SEED };
      await setTickersMetadata(data);
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer tickers-metadata' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json();
    const data = TickersMetadataStoreSchema.parse(json);
    await setTickersMetadata(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }
    console.error('[tickers-metadata] POST failed');
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
