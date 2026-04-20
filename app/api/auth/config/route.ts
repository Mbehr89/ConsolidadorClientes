import { NextResponse } from 'next/server';
import { isLocalAuthConfigured } from '@/lib/auth/local-users';

export const dynamic = 'force-dynamic';

/** Expone qué métodos de login están activos (sin secretos). */
export async function GET() {
  return NextResponse.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    local: isLocalAuthConfigured(),
  });
}
