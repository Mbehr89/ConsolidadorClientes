import { NextResponse } from 'next/server';
import { loadUsers } from '@/lib/auth/user-store';

export const dynamic = 'force-dynamic';

/** Expone qué métodos de login están activos (sin secretos). */
export async function GET() {
  const { users } = await loadUsers();
  return NextResponse.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    local: users.length > 0,
  });
}
