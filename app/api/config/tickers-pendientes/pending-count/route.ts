import { NextResponse } from 'next/server';
import { getTickersPendientes } from '@/lib/config-store/accessors';

export const dynamic = 'force-dynamic';

/** Count de entradas con estado `pendiente` (para badge en sidebar). */
export async function GET() {
  try {
    const pend = await getTickersPendientes();
    const count = Object.values(pend).filter((p) => p.estado === 'pendiente').length;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}
